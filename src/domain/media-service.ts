import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { MediaJob } from "./types";
import { assertInside, safeFilename } from "../infra/artifact-store";

export interface MediaServiceOptions {
  targetDir: string;
  skillGeneratePath?: string;
  loadEnvFiles?: boolean;
}

export class MediaService {
  private jobs: MediaJob[] = [];
  private targetDir: string;
  private skillGeneratePath: string;

  constructor(opts: MediaServiceOptions) {
    this.targetDir = opts.targetDir;
    this.skillGeneratePath = opts.skillGeneratePath || `${process.env.HOME}/.codex/skills/media/Art/Tools/Generate.ts`;
    if (opts.loadEnvFiles !== false) loadMediaEnvFiles();
  }

  availability() {
    return {
      available: Boolean(process.env.GOOGLE_API_KEY),
      model: "nano-banana-pro",
      skillGeneratePath: this.skillGeneratePath,
      outputPolicy: "preview-first",
    };
  }

  listJobs(): MediaJob[] {
    return [...this.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async generate(prompt: string, workflow = "technical-diagram"): Promise<MediaJob> {
    const id = `media-${Date.now()}`;
    const createdAt = new Date().toISOString();
    if (!process.env.GOOGLE_API_KEY) {
      const job: MediaJob = {
        id,
        status: "unavailable",
        prompt,
        workflow,
        error: "GOOGLE_API_KEY is not configured. Live nano-banana-pro generation is unavailable.",
        createdAt,
      };
      this.jobs.push(job);
      return job;
    }

    const outputPath = resolve(process.env.HOME || ".", "Downloads", `docchat-${safeFilename(workflow)}-${Date.now()}.png`);
    const job: MediaJob = { id, status: "running", prompt, workflow, outputPath, createdAt };
    this.jobs.push(job);

    const args = [
      "bun",
      "run",
      this.skillGeneratePath,
      "--model",
      "nano-banana-pro",
      "--prompt",
      prompt,
      "--size",
      "2K",
      "--aspect-ratio",
      "16:9",
      "--output",
      outputPath,
    ];

    try {
      const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text().catch(() => ""),
        new Response(proc.stderr).text().catch(() => ""),
        proc.exited,
      ]);
      if (proc.exitCode !== 0) {
        job.status = "failed";
        job.error = stderr || stdout || `Media generation failed with exit code ${proc.exitCode}`;
      } else {
        job.status = "complete";
      }
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
    }
    return job;
  }

  async promote(jobId: string): Promise<MediaJob | null> {
    const job = this.jobs.find((item) => item.id === jobId);
    if (!job?.outputPath || job.status !== "complete") return null;
    const mediaDir = resolve(this.targetDir, ".docchat", "media");
    await mkdir(mediaDir, { recursive: true });
    const promotedPath = join(mediaDir, basename(job.outputPath));
    assertInside(promotedPath, mediaDir);
    const bytes = await readFile(job.outputPath);
    await writeFile(promotedPath, bytes);
    job.promotedPath = promotedPath;
    job.status = "approved";
    return job;
  }
}

function loadMediaEnvFiles(): void {
  const home = process.env.HOME || "";
  const envPaths = [
    `${process.env.CODEX_HOME || `${home}/.codex`}/.env`,
    `${process.env.PAI_DIR || `${home}/.claude`}/.env`,
  ];

  for (const path of envPaths) {
    try {
      if (!existsSync(path)) continue;
      applyEnvContent(readFileSync(path, "utf8"));
    } catch {
      // Missing or unreadable env files should not break DocChat startup.
    }
  }
}

function applyEnvContent(content: string): void {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
