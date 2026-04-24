import { mkdir, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export type ArtifactKind = "summaries" | "audits" | "media";

export interface SavedArtifact {
  kind: ArtifactKind;
  name: string;
  path: string;
  createdAt: string;
}

export class ArtifactStore {
  private root: string;

  constructor(targetDir: string) {
    this.root = resolve(targetDir, ".docchat");
  }

  async saveMarkdown(kind: "summaries" | "audits", requestedName: string, content: string): Promise<SavedArtifact> {
    const name = safeFilename(requestedName, ".md");
    const dir = await this.ensureKindDir(kind);
    const path = join(dir, name);
    assertInside(path, dir);
    await Bun.write(path, content);
    return { kind, name, path, createdAt: new Date().toISOString() };
  }

  async saveJson(name: string, data: unknown): Promise<SavedArtifact> {
    const safeName = safeFilename(name, ".json");
    await mkdir(this.root, { recursive: true });
    const path = join(this.root, safeName);
    assertInside(path, this.root);
    await Bun.write(path, JSON.stringify(data, null, 2));
    return { kind: "summaries", name: safeName, path, createdAt: new Date().toISOString() };
  }

  async list(kind: ArtifactKind): Promise<SavedArtifact[]> {
    const dir = await this.ensureKindDir(kind);
    try {
      const names = await readdir(dir);
      return names.sort().map((name) => ({ kind, name, path: join(dir, name), createdAt: "" }));
    } catch {
      return [];
    }
  }

  pathFor(kind: ArtifactKind, name: string): string {
    const dir = resolve(this.root, kind);
    const path = join(dir, safeFilename(name));
    assertInside(path, dir);
    return path;
  }

  private async ensureKindDir(kind: ArtifactKind): Promise<string> {
    const dir = resolve(this.root, kind);
    assertInside(dir, this.root);
    await mkdir(dir, { recursive: true });
    return dir;
  }
}

export function safeFilename(input: string, ext?: string): string {
  const base = basename(input)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || `artifact-${Date.now()}`;
  if (!ext) return base;
  return base.toLowerCase().endsWith(ext) ? base : `${base}${ext}`;
}

export function assertInside(path: string, root: string): void {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
    throw new Error("Path escapes artifact root");
  }
}
