import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { DocFile, DocHeading, DocLink, DocRole } from "./types";

export const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".docchat",
  "vendor",
  "__pycache__",
  ".venv",
]);

const ROLE_PATTERNS: Array<[DocRole, RegExp]> = [
  ["changelog", /(^|\/)(change(log)?|history)\.md$/i],
  ["agent", /(^|\/)(agents|claude|codex|instructions)\.md$/i],
  ["plan", /(^|\/)(plans?|roadmap|proposal|implementation).*\.md$/i],
  ["generated", /(^|\/)(understanding-[^/]*|generated|synthesized|summaries?)\//i],
  ["example", /(^|\/)(examples?|fixtures?)\//i],
  ["tutorial", /(^|\/)(guides?|tutorials?|quick-?starts?)\//i],
  ["reference", /(^|\/)(docs?|reference|api)\//i],
  ["overview", /(^|\/)readme\.md$/i],
];

const STOPWORDS = new Set([
  "the",
  "and",
  "are",
  "for",
  "not",
  "but",
  "with",
  "from",
  "this",
  "that",
  "these",
  "those",
  "into",
  "your",
  "you",
  "our",
  "all",
  "any",
  "can",
  "will",
  "should",
  "must",
  "have",
  "has",
  "had",
  "was",
  "were",
  "what",
  "when",
  "where",
  "why",
  "how",
  "use",
  "using",
  "about",
  "guide",
  "docs",
  "documentation",
  "readme",
  "overview",
]);

export async function discoverMarkdownFiles(rootDir: string): Promise<DocFile[]> {
  const docs: DocFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      const doc = await readMarkdownDoc(rootDir, fullPath);
      if (doc) docs.push(doc);
    }
  }

  await walk(rootDir);
  return docs.sort(compareDocPaths);
}

export async function readMarkdownDoc(rootDir: string, absPath: string): Promise<DocFile | null> {
  try {
    const file = Bun.file(absPath);
    const content = await file.text();
    const info = await stat(absPath);
    const relPath = normalizeRelPath(relative(rootDir, absPath));
    const headings = extractHeadings(content);
    const title = headings[0]?.text || basename(relPath).replace(/\.md$/i, "");
    return {
      path: relPath,
      absPath,
      size: info.size,
      mtimeMs: info.mtimeMs,
      hash: createHash("sha256").update(content).digest("hex").slice(0, 16),
      title,
      role: classifyDocRole(relPath, title),
      cluster: inferCluster(relPath),
      headings,
      links: extractLinks(content),
      preview: buildPreview(content),
    };
  } catch {
    return null;
  }
}

export async function readDocContent(rootDir: string, docPath: string): Promise<string | null> {
  const normalized = normalizeRelPath(docPath);
  if (normalized.startsWith("../") || normalized.includes("/../")) return null;
  try {
    return await Bun.file(join(rootDir, normalized)).text();
  } catch {
    return null;
  }
}

export function classifyDocRole(path: string, title = ""): DocRole {
  for (const [role, pattern] of ROLE_PATTERNS) {
    if (pattern.test(path) || pattern.test(title)) return role;
  }
  return "other";
}

export function compareDocPaths(a: DocFile, b: DocFile): number {
  const aIsRootReadme = /^readme\.md$/i.test(a.path);
  const bIsRootReadme = /^readme\.md$/i.test(b.path);
  if (aIsRootReadme !== bIsRootReadme) return aIsRootReadme ? -1 : 1;
  return a.path === b.path ? 0 : a.path < b.path ? -1 : 1;
}

export function inferCluster(path: string): string {
  const parts = normalizeRelPath(path).split("/");
  if (parts[0] === "packages" && parts[1]) return `packages/${parts[1]}`;
  if (parts[0] === "Plans") return "plans";
  if (parts[0] === "Understanding-PI") return "Understanding-PI";
  if (parts.length === 1) return "root";
  return parts[0];
}

export function extractHeadings(markdown: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (!match) continue;
    const text = match[2].replace(/<[^>]+>/g, "").trim();
    headings.push({ level: match[1].length, text, slug: slugify(text), line: i + 1 });
  }
  return headings;
}

export function extractLinks(markdown: string): DocLink[] {
  const links: DocLink[] = [];
  const lines = markdown.split(/\r?\n/);
  const linkPattern = /!?\[([^\]]+)\]\(([^)]+)\)/g;
  for (let i = 0; i < lines.length; i++) {
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(lines[i]))) {
      const target = match[2].trim();
      links.push({
        text: match[1].trim(),
        target,
        line: i + 1,
        isLocal: !/^(https?:|mailto:|#)/i.test(target),
      });
    }
  }
  return links;
}

export function extractKeywords(text: string): string[] {
  const counts = new Map<string, number>();
  const normalized = text
    .toLowerCase()
    .replace(/[`*_~#[\]().,:/\\-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
  for (const word of normalized) counts.set(word, (counts.get(word) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([word]) => word);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";
}

export function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function resolveLocalLink(fromPath: string, target: string): string {
  const cleanTarget = target.split("#")[0].split("?")[0];
  if (!cleanTarget) return "";
  return normalizeRelPath(join(dirname(fromPath), cleanTarget));
}

function buildPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
}
