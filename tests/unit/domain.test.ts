import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildAtlas } from "../../src/domain/atlas-builder";
import { classifyDocRole, discoverMarkdownFiles, extractHeadings, extractLinks } from "../../src/domain/doc-corpus";
import { runCoherenceAudit } from "../../src/domain/coherence-audit";
import { draftSynthesis } from "../../src/domain/synthesis";
import { parseAssistantActions, validateUiActions } from "../../src/domain/ui-actions";
import { ArtifactStore, safeFilename } from "../../src/infra/artifact-store";

const fixtureRoot = join(import.meta.dir, "..", "fixtures", "docs");

describe("DocCorpus", () => {
  test("discovers markdown while excluding .docchat", async () => {
    const docs = await discoverMarkdownFiles(fixtureRoot);
    expect(docs.map((doc) => doc.path)).toEqual([
      "README.md",
      "Understanding-PI/guides/ref-rpc.md",
      "docs/rpc.md",
      "packages/tool/CHANGELOG.md",
    ]);
  });

  test("extracts headings and links", () => {
    const headings = extractHeadings("# Title\n\n## Part A\nText");
    expect(headings[0]).toMatchObject({ level: 1, text: "Title", slug: "title", line: 1 });
    expect(extractLinks("[Docs](docs/rpc.md)\n[Web](https://example.com)")).toEqual([
      { text: "Docs", target: "docs/rpc.md", line: 1, isLocal: true },
      { text: "Web", target: "https://example.com", line: 2, isLocal: false },
    ]);
  });

  test("classifies documentation roles", () => {
    expect(classifyDocRole("README.md")).toBe("overview");
    expect(classifyDocRole("packages/tool/CHANGELOG.md")).toBe("changelog");
    expect(classifyDocRole("Understanding-PI/guides/ref-rpc.md")).toBe("generated");
    expect(classifyDocRole("docs/rpc.md")).toBe("reference");
  });
});

describe("AtlasBuilder and audit", () => {
  test("builds topics, reading paths, and duplicate candidates", async () => {
    const docs = await discoverMarkdownFiles(fixtureRoot);
    const atlas = buildAtlas("fixture", docs, new Date("2026-04-24T00:00:00Z"));
    expect(atlas.stats.docs).toBe(4);
    expect(atlas.topics.some((topic) => topic.id === "rpc")).toBe(true);
    expect(atlas.readingPaths.some((path) => path.id === "start-here")).toBe(true);
    expect(atlas.duplicates.some((dup) => dup.paths.includes("Understanding-PI/guides/ref-rpc.md"))).toBe(true);
  });

  test("finds overlap, prototype docs, and broken links", async () => {
    const atlas = buildAtlas("fixture", await discoverMarkdownFiles(fixtureRoot));
    const audit = runCoherenceAudit(atlas);
    expect(audit.findings.some((finding) => finding.type === "overlap" || finding.type === "duplicate")).toBe(true);
    expect(audit.findings.some((finding) => finding.type === "stale")).toBe(true);
    expect(audit.findings.some((finding) => finding.type === "broken_link")).toBe(true);
  });
});

describe("UI actions", () => {
  test("parses and validates safe assistant actions", async () => {
    const atlas = buildAtlas("fixture", await discoverMarkdownFiles(fixtureRoot));
    const marker = '[[docchat-action:{"type":"open_doc","payload":{"path":"README.md"}}]]';
    const parsed = parseAssistantActions(`Open this.${marker}`);
    expect(parsed.cleanText).toBe("Open this.");
    const valid = validateUiActions(parsed.actions, atlas);
    expect(valid).toHaveLength(1);
    expect(valid[0].type).toBe("open_doc");
  });

  test("rejects unsafe unknown docs", async () => {
    const atlas = buildAtlas("fixture", await discoverMarkdownFiles(fixtureRoot));
    const parsed = parseAssistantActions('[[docchat-action:{"type":"open_doc","payload":{"path":"../secret.md"}}]]');
    expect(validateUiActions(parsed.actions, atlas)).toHaveLength(0);
  });
});

describe("ArtifactStore", () => {
  test("sanitizes filenames", () => {
    expect(safeFilename("../My Overview!.md", ".md")).toBe("My-Overview-.md");
  });

  test("saves markdown under .docchat", async () => {
    const dir = join(import.meta.dir, "..", "tmp-artifacts");
    const store = new ArtifactStore(dir);
    const saved = await store.saveMarkdown("summaries", "../overview", "# Overview");
    expect(saved.path.includes("/.docchat/summaries/")).toBe(true);
    expect(await Bun.file(saved.path).text()).toBe("# Overview");
  });
});

describe("Synthesis", () => {
  test("drafts overview and topic summaries without copying source docs", async () => {
    const atlas = buildAtlas("fixture", await discoverMarkdownFiles(fixtureRoot));
    const overview = draftSynthesis(atlas, { type: "overview" });
    expect(overview.markdown).toContain("# fixture Documentation Overview");
    expect(overview.sources).toContain("README.md");

    const topic = draftSynthesis(atlas, { type: "topic-summary", topicId: "rpc" });
    expect(topic.markdown).toContain("# RPC Summary");
    expect(topic.sources).toContain("docs/rpc.md");
  });
});
