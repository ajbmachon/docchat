import type { AtlasTopic, DocAtlas, DocFile, ReadingPath } from "./types";

export type SynthesisType = "overview" | "start-here" | "topic-summary" | "glossary";

export interface SynthesisRequest {
  type: SynthesisType;
  topicId?: string;
  pathId?: string;
  title?: string;
}

export interface SynthesisDraft {
  type: SynthesisType;
  title: string;
  markdown: string;
  sources: string[];
}

export function draftSynthesis(atlas: DocAtlas, request: SynthesisRequest): SynthesisDraft {
  switch (request.type) {
    case "overview":
      return draftOverview(atlas);
    case "start-here":
      return draftStartHere(atlas, request.pathId);
    case "topic-summary":
      return draftTopicSummary(atlas, request.topicId);
    case "glossary":
      return draftGlossary(atlas);
  }
}

function draftOverview(atlas: DocAtlas): SynthesisDraft {
  const overviewDocs = atlas.docs.filter((doc) => doc.role === "overview").slice(0, 4);
  const canonicalDocs = [...overviewDocs, ...atlas.docs.filter((doc) => doc.role === "reference").slice(0, 8)];
  const sources = unique(canonicalDocs.map((doc) => doc.path));
  const lines = [
    `# ${atlas.rootName} Documentation Overview`,
    "",
    "This draft is generated from the current markdown corpus. It is meant as an orientation layer, not a replacement for canonical source docs.",
    "",
    "## Corpus Shape",
    "",
    `- Markdown files: ${atlas.stats.docs}`,
    `- Source clusters: ${atlas.stats.clusters}`,
    `- Topics detected: ${atlas.stats.topics}`,
    `- Overlap candidates: ${atlas.stats.duplicates}`,
    "",
    "## Primary Entry Points",
    "",
    ...sources.slice(0, 8).map((path) => {
      const doc = atlas.docs.find((item) => item.path === path);
      return `- [${doc?.title || path}](${path}) - ${doc?.role || "doc"}${doc?.preview ? `; ${trimSentence(doc.preview)}` : ""}`;
    }),
    "",
    "## Strongest Topics",
    "",
    ...atlas.topics.slice(0, 8).map((topic) => `- ${topic.label}: ${topic.docPaths.slice(0, 4).join(", ")}`),
    "",
    "## Watch Points",
    "",
    ...watchPoints(atlas),
    "",
  ];
  return { type: "overview", title: "Project Overview", markdown: lines.join("\n"), sources };
}

function draftStartHere(atlas: DocAtlas, pathId?: string): SynthesisDraft {
  const readingPath = atlas.readingPaths.find((path) => path.id === pathId) || atlas.readingPaths[0];
  const sources = readingPath?.items.map((item) => item.path) || atlas.docs.slice(0, 5).map((doc) => doc.path);
  const lines = [
    "# Start Here",
    "",
    "This draft turns the current documentation corpus into a short reading path. It links to existing source docs instead of copying them.",
    "",
    readingPath ? `Audience: ${readingPath.audience}` : "Audience: A reader trying to orient quickly.",
    "",
    "## Reading Path",
    "",
    ...sources.map((path, index) => {
      const item = readingPath?.items.find((candidate) => candidate.path === path);
      const doc = atlas.docs.find((candidate) => candidate.path === path);
      return `${index + 1}. [${doc?.title || path}](${path}) - ${item?.reason || doc?.role || "Read for context."}`;
    }),
    "",
    "## After Reading",
    "",
    "- Ask DocChat to compare overlapping docs before editing canonical documentation.",
    "- Save focused summaries under `.docchat/summaries` until a source-doc patch is explicitly approved.",
    "",
  ];
  return { type: "start-here", title: "Start Here", markdown: lines.join("\n"), sources };
}

function draftTopicSummary(atlas: DocAtlas, topicId?: string): SynthesisDraft {
  const topic = topicId ? atlas.topics.find((item) => item.id === topicId) : atlas.topics[0];
  if (!topic) {
    return {
      type: "topic-summary",
      title: "Topic Summary",
      markdown: "# Topic Summary\n\nNo topic is available in the current atlas yet.\n",
      sources: [],
    };
  }

  const docs = topic.docPaths.map((path) => atlas.docs.find((doc) => doc.path === path)).filter(Boolean) as DocFile[];
  const lines = [
    `# ${topic.label} Summary`,
    "",
    topic.summary,
    "",
    "## Source Map",
    "",
    ...docs.map((doc) => `- [${doc.title}](${doc.path}) - ${doc.role}; ${trimSentence(doc.preview)}`),
    "",
    "## Synthesis Notes",
    "",
    ...topic.keywords.slice(0, 8).map((keyword) => `- ${keyword}: appears in the topic neighborhood and may deserve a canonical definition.`),
    "",
    "## Follow-Up Questions",
    "",
    "- Which source document should be treated as canonical for this topic?",
    "- Are any generated or prototype documents repeating canonical content?",
    "",
  ];
  return { type: "topic-summary", title: `${topic.label} Summary`, markdown: lines.join("\n"), sources: topic.docPaths };
}

function draftGlossary(atlas: DocAtlas): SynthesisDraft {
  const topicSources = new Map<string, AtlasTopic>();
  for (const topic of atlas.topics) {
    for (const keyword of topic.keywords) {
      if (!topicSources.has(keyword)) topicSources.set(keyword, topic);
    }
  }
  const entries = [...topicSources.entries()].slice(0, 30);
  const sources = unique(entries.flatMap(([, topic]) => topic.docPaths.slice(0, 3)));
  const lines = [
    "# Glossary Draft",
    "",
    "Definitions are intentionally cautious. Treat them as prompts for review against canonical docs.",
    "",
    ...entries.map(([keyword, topic]) => `- **${keyword}**: Term related to ${topic.label}. Sources: ${topic.docPaths.slice(0, 3).join(", ")}.`),
    "",
  ];
  return { type: "glossary", title: "Glossary Draft", markdown: lines.join("\n"), sources };
}

function watchPoints(atlas: DocAtlas): string[] {
  const points: string[] = [];
  if (atlas.duplicates.length) {
    points.push(`- ${atlas.duplicates.length} possible duplicate or overlapping document pair${atlas.duplicates.length === 1 ? "" : "s"} should be reviewed before creating new canonical docs.`);
  }
  const generated = atlas.docs.filter((doc) => doc.role === "generated").length;
  if (generated) points.push(`- ${generated} generated/prototype document${generated === 1 ? "" : "s"} should be treated as secondary evidence.`);
  if (!points.length) points.push("- No major deterministic watch points were detected in the atlas.");
  return points;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function trimSentence(text: string): string {
  return text.length > 110 ? `${text.slice(0, 107).trim()}...` : text;
}
