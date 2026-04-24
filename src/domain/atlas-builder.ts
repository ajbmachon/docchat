import { basename } from "node:path";
import { extractKeywords } from "./doc-corpus";
import type { AtlasTopic, DocAtlas, DocFile, DuplicateCandidate, ReadingPath } from "./types";

const TOPIC_LABELS: Record<string, string> = {
  rpc: "RPC",
  sdk: "SDK",
  api: "API",
  cli: "CLI",
  ui: "UI",
  tui: "TUI",
  docs: "Docs",
};

export function buildAtlas(rootName: string, docs: DocFile[], now = new Date()): DocAtlas {
  const topics = buildTopics(docs);
  const duplicates = findDuplicateCandidates(docs);
  const readingPaths = buildReadingPaths(docs, topics);
  const clusters = new Set(docs.map((doc) => doc.cluster));
  return {
    generatedAt: now.toISOString(),
    rootName,
    stats: {
      docs: docs.length,
      topics: topics.length,
      clusters: clusters.size,
      duplicates: duplicates.length,
      totalBytes: docs.reduce((sum, doc) => sum + doc.size, 0),
    },
    docs,
    topics,
    readingPaths,
    duplicates,
    canonicalHints: buildCanonicalHints(docs, duplicates),
  };
}

export function buildTopics(docs: DocFile[]): AtlasTopic[] {
  const buckets = new Map<string, { score: number; docPaths: Set<string>; keywords: Set<string> }>();

  for (const doc of docs) {
    const seed = [
      doc.title,
      doc.path,
      doc.headings.map((h) => h.text).join(" "),
      doc.preview,
    ].join(" ");
    const keywords = extractKeywords(seed).slice(0, 8);
    for (const keyword of keywords) {
      if (!buckets.has(keyword)) {
        buckets.set(keyword, { score: 0, docPaths: new Set(), keywords: new Set() });
      }
      const bucket = buckets.get(keyword)!;
      bucket.score += doc.role === "overview" ? 3 : doc.role === "reference" ? 2 : 1;
      bucket.docPaths.add(doc.path);
      keywords.slice(0, 4).forEach((k) => bucket.keywords.add(k));
    }
  }

  return [...buckets.entries()]
    .filter(([, bucket]) => bucket.docPaths.size > 1 || bucket.score > 2)
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, 24)
    .map(([id, bucket]) => ({
      id,
      label: TOPIC_LABELS[id] || titleCase(id),
      keywords: [...bucket.keywords].slice(0, 8),
      docPaths: [...bucket.docPaths].sort(),
      summary: `Found across ${bucket.docPaths.size} document${bucket.docPaths.size === 1 ? "" : "s"}.`,
    }));
}

export function buildReadingPaths(docs: DocFile[], topics: AtlasTopic[]): ReadingPath[] {
  const byRole = (role: DocFile["role"]) => docs.filter((doc) => doc.role === role);
  const overview = byRole("overview");
  const tutorials = byRole("tutorial");
  const references = byRole("reference");
  const agentDocs = byRole("agent");
  const plans = byRole("plan");

  const startItems = [...overview, ...tutorials].slice(0, 6).map((doc) => ({
    path: doc.path,
    reason: doc.role === "overview" ? "Orientation and package map." : "Hands-on learning path.",
  }));

  const maintainerItems = [...overview, ...agentDocs, ...plans, ...references].slice(0, 7).map((doc) => ({
    path: doc.path,
    reason: doc.role === "agent" ? "Project rules and workflow expectations." : "Maintainer context.",
  }));

  const referenceTopic = topics.find((topic) => /api|rpc|sdk|extensions?|settings?/i.test(topic.label));
  const referenceItems = [
    ...references.filter((doc) => referenceTopic?.docPaths.includes(doc.path)),
    ...references.filter((doc) => !referenceTopic?.docPaths.includes(doc.path)),
  ].slice(0, 8).map((doc) => ({ path: doc.path, reason: "Reference material for detailed lookup." }));

  return [
    {
      id: "start-here",
      title: "Start Here",
      audience: "A newcomer who wants the shortest useful path.",
      items: uniqueItems(startItems),
    },
    {
      id: "maintainer",
      title: "Maintainer Briefing",
      audience: "A contributor or maintainer trying to understand the project quickly.",
      items: uniqueItems(maintainerItems),
    },
    {
      id: "reference-dive",
      title: "Reference Deep Dive",
      audience: "A reader looking for APIs, settings, protocol details, or extension points.",
      items: uniqueItems(referenceItems),
    },
  ].filter((path) => path.items.length > 0);
}

export function findDuplicateCandidates(docs: DocFile[]): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i];
      const b = docs[j];
      const titleMatch = normalizeTitle(a.title) && normalizeTitle(a.title) === normalizeTitle(b.title);
      const basenameMatch = basename(a.path).toLowerCase() === basename(b.path).toLowerCase();
      const headingOverlap = overlapRatio(a.headings.map((h) => h.slug), b.headings.map((h) => h.slug));
      const mirroredRef = a.path.includes("/ref-") && b.path.includes("/docs/") && basename(a.path).replace(/^ref-/, "") === basename(b.path);
      if (titleMatch || mirroredRef || (basenameMatch && headingOverlap >= 0.4)) {
        candidates.push({
          paths: [a.path, b.path],
          reason: mirroredRef ? "Prototype/reference mirror detected." : titleMatch ? "Matching document titles." : "Matching file name and overlapping headings.",
          confidence: mirroredRef ? 0.9 : titleMatch ? 0.75 : 0.62,
        });
      }
    }
  }
  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 50);
}

function buildCanonicalHints(docs: DocFile[], duplicates: DuplicateCandidate[]): Record<string, string[]> {
  const hints: Record<string, string[]> = {};
  for (const doc of docs) {
    const docHints: string[] = [];
    if (doc.role === "overview") docHints.push("Likely orientation or canonical entry point.");
    if (doc.role === "reference") docHints.push("Likely reference material.");
    if (doc.role === "generated") docHints.push("Likely generated or prototype synthesis; verify before treating as canonical.");
    if (doc.role === "changelog") docHints.push("Chronological record, not a stable guide.");
    if (duplicates.some((dup) => dup.paths.includes(doc.path))) docHints.push("Overlaps with another document.");
    hints[doc.path] = docHints;
  }
  return hints;
}

function uniqueItems(items: Array<{ path: string; reason: string }>): Array<{ path: string; reason: string }> {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  });
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function overlapRatio(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let overlap = 0;
  for (const item of setA) if (setB.has(item)) overlap++;
  return overlap / Math.min(setA.size, setB.size);
}

function titleCase(word: string): string {
  return word.replace(/\b\w/g, (ch) => ch.toUpperCase());
}
