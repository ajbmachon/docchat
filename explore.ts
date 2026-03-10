import { basename, join } from "path";

export interface ExploreOptions {
  targetDir: string;
  fileTree: string;
  readmeContent: string;
  onProgress: (message: string) => void;
  onComplete: (result: ExploreResult) => void;
  onError: (error: string) => void;
}

export interface ExploreResult {
  filename: string;
  content: string;
  duration: number;
}

async function getGitHash(dir: string): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--short", "HEAD"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return text.trim() || "no-git";
  } catch {
    return "no-git";
  }
}

function countFilesInTree(fileTree: string): number {
  return fileTree.split("\n").filter((line) => line.trim() && !line.trim().endsWith("/")).length;
}

function buildExplorationPrompt(repoName: string, fileTree: string, readmeContent: string): string {
  return `You are analyzing a codebase to help someone understand it quickly.

Here is the file tree:
${fileTree}

Here is the README:
${readmeContent}

Produce a comprehensive codebase exploration document in this exact format:

# Codebase Exploration: ${repoName}

## Overview
A 2-3 paragraph executive summary.

## Architecture
Directory structure, organization patterns (monorepo, MVC, etc).

## Key Components
Most important files/modules — what each does and why it matters.

## Data Flow
Entry points → processing → output.

## Dependencies & Stack
Technologies, frameworks, versions.

## Configuration
Env vars, config files, build system.

## Notable Patterns
Architectural decisions, coding conventions.

## Getting Started
Setup and run instructions.

Be specific, reference actual file paths.`;
}

function buildPartialPrompt(
  repoName: string,
  fileTree: string,
  readmeContent: string,
  sections: string[],
): string {
  return `You are analyzing a codebase to help someone understand it quickly.

Here is the file tree:
${fileTree}

Here is the README:
${readmeContent}

Produce ONLY the following sections for a codebase exploration of "${repoName}":

${sections.map((s) => `## ${s}\nWrite comprehensive content for this section.`).join("\n\n")}

Be specific, reference actual file paths. Do NOT include a title or any sections not listed above.`;
}

function spawnClaudeAgent(systemPrompt: string, userPrompt: string): ReturnType<typeof Bun.spawn> {
  const args = [
    "claude",
    "-p",
    "--model",
    "claude-haiku-4-5",
    "--tools",
    "",
    "--setting-sources",
    "",
    "--append-system-prompt",
    systemPrompt,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
  ];

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;

  const proc = Bun.spawn(args, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: "/tmp",
    env,
  });

  proc.stdin.write(userPrompt);
  proc.stdin.end();

  return proc;
}

async function drainStderr(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
  try {
    await new Response(proc.stderr).text();
  } catch {
    // stderr drained, ignore errors
  }
}

async function collectAgentOutput(
  proc: ReturnType<typeof Bun.spawn>,
  onProgress: (message: string) => void,
): Promise<string> {
  const stderrDrain = drainStderr(proc);
  let fullText = "";

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);

          if (parsed.type === "stream_event") {
            const event = parsed.event;
            if (
              event?.type === "content_block_delta" &&
              event?.delta?.type === "text_delta" &&
              event?.delta?.text
            ) {
              fullText += event.delta.text;
              onProgress(event.delta.text);
            }
          } else if (parsed.type === "result" && parsed.result) {
            fullText = parsed.result;
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }

    // process remaining buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        if (parsed.type === "result" && parsed.result) {
          fullText = parsed.result;
        }
      } catch {
        // skip
      }
    }
  } finally {
    reader.releaseLock();
  }

  await proc.exited;
  await stderrDrain;

  return fullText;
}

function buildFrontmatter(opts: {
  date: string;
  commit: string;
  repo: string;
  filesAnalyzed: number;
  durationSeconds: number;
}): string {
  return `---
date: ${opts.date}
commit: ${opts.commit}
repo: ${opts.repo}
files_analyzed: ${opts.filesAnalyzed}
model: claude-haiku-4-5
duration_seconds: ${opts.durationSeconds}
---

`;
}

export async function runExploration(opts: ExploreOptions): Promise<void> {
  const startTime = Date.now();
  const repoName = basename(opts.targetDir);
  const commit = await getGitHash(opts.targetDir);
  const totalFiles = countFilesInTree(opts.fileTree);

  try {
    let explorationContent: string;

    if (totalFiles > 100) {
      // Parallel 2-agent strategy
      opts.onProgress("Large repo detected — using parallel analysis agents...\n");

      const agent1Sections = ["Overview", "Architecture", "Key Components", "Dependencies & Stack"];
      const agent2Sections = ["Data Flow", "Configuration", "Notable Patterns", "Getting Started"];

      const systemPrompt1 = buildPartialPrompt(repoName, opts.fileTree, opts.readmeContent, agent1Sections);
      const systemPrompt2 = buildPartialPrompt(repoName, opts.fileTree, opts.readmeContent, agent2Sections);

      const proc1 = spawnClaudeAgent(systemPrompt1, "Analyze this codebase thoroughly.");
      const proc2 = spawnClaudeAgent(systemPrompt2, "Analyze this codebase thoroughly.");

      const [result1, result2] = await Promise.all([
        collectAgentOutput(proc1, (text) => opts.onProgress(text)),
        collectAgentOutput(proc2, (text) => opts.onProgress(text)),
      ]);

      explorationContent = `# Codebase Exploration: ${repoName}\n\n${result1}\n\n${result2}`;
    } else {
      // Single agent strategy
      const systemPrompt = buildExplorationPrompt(repoName, opts.fileTree, opts.readmeContent);
      const proc = spawnClaudeAgent(systemPrompt, "Analyze this codebase thoroughly.");
      explorationContent = await collectAgentOutput(proc, (text) => opts.onProgress(text));
    }

    const durationSeconds = Math.round((Date.now() - startTime) / 1000);
    const date = new Date().toISOString();

    const frontmatter = buildFrontmatter({
      date,
      commit,
      repo: repoName,
      filesAnalyzed: totalFiles,
      durationSeconds,
    });

    const fullContent = frontmatter + explorationContent;

    // Save to .docchat/explorations/
    const explorationDir = join(opts.targetDir, ".docchat", "explorations");
    await Bun.spawn(["mkdir", "-p", explorationDir], { stdout: "ignore", stderr: "ignore" }).exited;

    const timestamp = new Date().toISOString().replace(/[T:]/g, (m) => (m === "T" ? "_" : "")).slice(0, 15);
    const filename = `${timestamp}.md`;
    const filePath = join(explorationDir, filename);

    await Bun.write(filePath, fullContent);

    opts.onComplete({
      filename,
      content: fullContent,
      duration: durationSeconds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.onError(message);
  }
}
