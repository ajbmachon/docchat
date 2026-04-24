import { dirname, join } from "node:path";
import { normalizeRelPath, resolveLocalLink } from "./doc-corpus";
import type { AuditFinding, CoherenceAudit, DocAtlas, DocFile } from "./types";

export function runCoherenceAudit(atlas: DocAtlas): CoherenceAudit {
  const findings: AuditFinding[] = [
    ...duplicateFindings(atlas),
    ...prototypeFindings(atlas.docs),
    ...brokenLinkFindings(atlas),
    ...gapFindings(atlas.docs),
    ...contradictionFindings(atlas.docs),
  ];
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    findings,
    markdown: renderAuditMarkdown(generatedAt, findings),
  };
}

export function renderAuditMarkdown(generatedAt: string, findings: AuditFinding[]): string {
  const lines = [`# DocChat Coherence Audit`, "", `Generated: ${generatedAt}`, "", `Findings: ${findings.length}`, ""];
  for (const finding of findings) {
    lines.push(`## ${finding.title}`, "");
    lines.push(`- Type: ${finding.type}`);
    lines.push(`- Severity: ${finding.severity}`);
    lines.push(`- Confidence: ${Math.round(finding.confidence * 100)}%`);
    lines.push(`- Paths: ${finding.paths.join(", ") || "n/a"}`);
    lines.push("");
    lines.push(finding.detail);
    lines.push("");
    lines.push(`Recommendation: ${finding.recommendation}`);
    lines.push("");
  }
  return lines.join("\n");
}

function duplicateFindings(atlas: DocAtlas): AuditFinding[] {
  return atlas.duplicates.map((candidate, index) => ({
    id: `duplicate-${index + 1}`,
    type: candidate.reason.includes("mirror") ? "overlap" : "duplicate",
    severity: candidate.confidence > 0.8 ? "warning" : "info",
    title: candidate.reason,
    paths: candidate.paths,
    detail: `These documents appear to overlap and should be treated carefully before creating new synthesis docs.`,
    recommendation: "Choose a canonical source or link between the documents rather than duplicating content.",
    confidence: candidate.confidence,
  }));
}

function prototypeFindings(docs: DocFile[]): AuditFinding[] {
  return docs
    .filter((doc) => doc.role === "generated" || /understanding-|prototype|generated/i.test(doc.path))
    .slice(0, 12)
    .map((doc, index) => ({
      id: `generated-${index + 1}`,
      type: "stale",
      severity: "info",
      title: "Generated or prototype documentation detected",
      paths: [doc.path],
      detail: `${doc.path} looks like synthesis material rather than a canonical source document.`,
      recommendation: "Use it as an aid, but verify against canonical package/root docs before saving new summaries.",
      confidence: 0.7,
    }));
}

function brokenLinkFindings(atlas: DocAtlas): AuditFinding[] {
  const docPaths = new Set(atlas.docs.map((doc) => doc.path));
  const findings: AuditFinding[] = [];
  for (const doc of atlas.docs) {
    for (const link of doc.links) {
      if (!link.isLocal) continue;
      const resolved = normalizeRelPath(join(dirname(doc.path), link.target.split("#")[0]));
      const direct = resolveLocalLink(doc.path, link.target);
      if (resolved && !docPaths.has(resolved) && !docPaths.has(direct)) {
        findings.push({
          id: `broken-link-${findings.length + 1}`,
          type: "broken_link",
          severity: "warning",
          title: "Possible broken local markdown link",
          paths: [doc.path],
          detail: `Line ${link.line} links to ${link.target}, but no matching markdown file was found in the corpus.`,
          recommendation: "Fix the link target or add a bridge to the correct canonical document.",
          confidence: 0.65,
        });
      }
    }
  }
  return findings.slice(0, 30);
}

function gapFindings(docs: DocFile[]): AuditFinding[] {
  const byCluster = new Map<string, DocFile[]>();
  for (const doc of docs) {
    if (!byCluster.has(doc.cluster)) byCluster.set(doc.cluster, []);
    byCluster.get(doc.cluster)!.push(doc);
  }
  const findings: AuditFinding[] = [];
  for (const [cluster, clusterDocs] of byCluster) {
    if (cluster === "root") continue;
    const hasOverview = clusterDocs.some((doc) => doc.role === "overview");
    const hasReference = clusterDocs.some((doc) => doc.role === "reference");
    if (!hasOverview && hasReference) {
      findings.push({
        id: `gap-${findings.length + 1}`,
        type: "gap",
        severity: "info",
        title: `Missing overview for ${cluster}`,
        paths: clusterDocs.slice(0, 4).map((doc) => doc.path),
        detail: `${cluster} has reference-style material but no obvious README or overview document.`,
        recommendation: "Ask DocChat to draft a short overview that links to existing docs, then decide whether to save it.",
        confidence: 0.6,
      });
    }
  }
  return findings;
}

function contradictionFindings(docs: DocFile[]): AuditFinding[] {
  const installDocs = docs.filter((doc) => /install|npm|bun|setup/i.test(`${doc.title} ${doc.preview}`));
  const commands = new Map<string, string[]>();
  for (const doc of installDocs) {
    for (const command of doc.preview.match(/\b(npm|bun|pnpm|yarn)\s+(install|add|run)\b[^.]{0,80}/gi) || []) {
      const normalized = command.toLowerCase().replace(/\s+/g, " ").trim();
      if (!commands.has(normalized)) commands.set(normalized, []);
      commands.get(normalized)!.push(doc.path);
    }
  }
  if (commands.size <= 1) return [];
  return [{
    id: "contradiction-install-1",
    type: "contradiction",
    severity: "info",
    title: "Multiple setup command patterns detected",
    paths: [...new Set([...commands.values()].flat())].slice(0, 8),
    detail: "The documentation appears to mention multiple package-manager/setup commands. This may be fine, but it is worth checking for stale instructions.",
    recommendation: "Ask DocChat to compare the setup instructions and propose a canonical install section.",
    confidence: 0.45,
  }];
}
