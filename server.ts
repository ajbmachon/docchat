import { basename, join, extname, relative, resolve } from "path";
import { readdir } from "node:fs/promises";
import { runExploration, type ExploreResult } from "./explore";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3333", 10);
const TARGET_DIR = resolve(process.argv[2] || process.cwd());
const CONTEXT_BUDGET = 80_000; // chars

const EXCLUDED_DIRS = new Set([
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

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const SYSTEM_PROMPT_SUFFIX = `
You are an expert on this codebase. Answer questions concisely using the documentation and file structure above.
When referencing files, use their relative paths. Use code examples when helpful.
If you're unsure about something, say so rather than guessing.
The user is trying to understand this codebase quickly.
`.trim();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocFile {
  path: string;  // relative
  size: number;
  absPath: string;
}

interface ContextTier {
  label: string;
  content: string;
  priority: number;
}

// ---------------------------------------------------------------------------
// File Discovery
// ---------------------------------------------------------------------------

async function discoverMarkdownFiles(rootDir: string): Promise<DocFile[]> {
  const results: DocFile[] = [];

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
        if (!EXCLUDED_DIRS.has(entry.name)) {
          await walk(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const file = Bun.file(fullPath);
          const size = file.size;
          results.push({
            path: relative(rootDir, fullPath),
            size: typeof size === "number" ? size : 0,
            absPath: fullPath,
          });
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await walk(rootDir);
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}

// ---------------------------------------------------------------------------
// File Tree Generation
// ---------------------------------------------------------------------------

function generateFileTree(files: DocFile[]): string {
  const lines: string[] = [];
  for (const f of files) {
    const parts = f.path.split("/");
    const indent = "  ".repeat(parts.length - 1);
    lines.push(`${indent}${parts[parts.length - 1]}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Context Assembly
// ---------------------------------------------------------------------------

async function readFileContent(absPath: string): Promise<string> {
  try {
    return await Bun.file(absPath).text();
  } catch {
    return "";
  }
}

async function readFileTruncated(absPath: string, maxChars: number, maxLines: number): Promise<string> {
  try {
    const content = await Bun.file(absPath).text();
    if (content.length <= maxChars) return content;

    const lines = content.split("\n");
    if (lines.length <= maxLines) return content;

    const truncated = lines.slice(0, maxLines).join("\n");
    const remainingLines = lines.length - maxLines;
    return `${truncated}\n\n[...truncated, ${remainingLines} more lines]`;
  } catch {
    return "";
  }
}

async function assembleContext(
  files: DocFile[],
  targetDir: string,
  fileTree: string,
): Promise<string> {
  let budget = CONTEXT_BUDGET;
  const tiers: ContextTier[] = [];

  // --- Tier 1: File tree + README + project config (priority 0, ~5K budget) ---
  {
    let tier1Content = `## File Tree\n\`\`\`\n${fileTree}\n\`\`\`\n\n`;

    // README.md
    const readmePath = join(targetDir, "README.md");
    const readme = await readFileContent(readmePath);
    if (readme) {
      tier1Content += `## README.md\n${readme}\n\n`;
    }

    // Project config files
    for (const configName of ["package.json", "Cargo.toml", "go.mod"]) {
      const configPath = join(targetDir, configName);
      const content = await readFileContent(configPath);
      if (content) {
        tier1Content += `## ${configName}\n\`\`\`\n${content}\n\`\`\`\n\n`;
      }
    }

    tiers.push({ label: "Tier 1: Structure & Config", content: tier1Content, priority: 0 });
    budget -= tier1Content.length;
  }

  // --- Tier 2: Existing explorations (priority 1) ---
  if (budget > 0) {
    const explorationsDir = join(targetDir, ".docchat", "explorations");
    let tier2Content = "";

    try {
      const entries = await readdir(explorationsDir);
      for (const name of entries) {
        if (!name.endsWith(".md")) continue;
        if (budget - tier2Content.length <= 0) break;
        const content = await readFileContent(join(explorationsDir, name));
        if (content) {
          const addition = `## Exploration: ${name}\n${content}\n\n`;
          if (tier2Content.length + addition.length <= budget) {
            tier2Content += addition;
          }
        }
      }
    } catch {
      // no explorations directory, that's fine
    }

    if (tier2Content) {
      tiers.push({ label: "Tier 2: Explorations", content: tier2Content, priority: 1 });
      budget -= tier2Content.length;
    }
  }

  // --- Tier 3: Other .md files (priority 2) ---
  if (budget > 0) {
    let tier3Content = "";

    for (const file of files) {
      if (budget - tier3Content.length <= 0) break;

      // Skip README (already in Tier 1)
      if (file.path === "README.md") continue;

      const content = await readFileTruncated(file.absPath, 5000, 200);
      if (content) {
        const addition = `## ${file.path}\n${content}\n\n`;
        if (tier3Content.length + addition.length <= budget) {
          tier3Content += addition;
        }
      }
    }

    if (tier3Content) {
      tiers.push({ label: "Tier 3: Documentation", content: tier3Content, priority: 2 });
    }
  }

  // Assemble final context
  const assembled = tiers
    .sort((a, b) => a.priority - b.priority)
    .map((t) => t.content)
    .join("");

  return assembled + "\n" + SYSTEM_PROMPT_SUFFIX;
}

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

const sessionMap = new Map<string, string>(); // clientSessionId -> claudeSessionId

// ---------------------------------------------------------------------------
// SSE Helpers
// ---------------------------------------------------------------------------

function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  };
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ---------------------------------------------------------------------------
// Exploration Info
// ---------------------------------------------------------------------------

interface ExplorationMeta {
  name: string;
  date: string;
  commit: string;
}

async function listExplorations(targetDir: string): Promise<ExplorationMeta[]> {
  const dir = join(targetDir, ".docchat", "explorations");
  const results: ExplorationMeta[] = [];

  try {
    const entries = await readdir(dir);
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;

      const content = await readFileContent(join(dir, name));
      let date = "";
      let commit = "";

      // Parse YAML frontmatter
      if (content.startsWith("---")) {
        const endIdx = content.indexOf("---", 3);
        if (endIdx > 0) {
          const frontmatter = content.slice(3, endIdx);
          const dateMatch = frontmatter.match(/^date:\s*(.+)$/m);
          const commitMatch = frontmatter.match(/^commit:\s*(.+)$/m);
          if (dateMatch) date = dateMatch[1].trim();
          if (commitMatch) commit = commitMatch[1].trim();
        }
      }

      results.push({ name, date, commit });
    }
  } catch {
    // no explorations directory
  }

  return results.sort((a, b) => b.name.localeCompare(a.name));
}

// ---------------------------------------------------------------------------
// Project Info
// ---------------------------------------------------------------------------

async function getProjectInfo(files: DocFile[], targetDir: string) {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  let hasGit = false;
  const hasClaude = await isClaudeAvailable();

  try {
    hasGit = await Bun.file(join(targetDir, ".git", "HEAD")).exists();
  } catch {
    hasGit = false;
  }

  const explorations = await listExplorations(targetDir);

  return {
    name: basename(targetDir),
    fileCount: files.length,
    totalSize,
    hasGit,
    hasClaude,
    explorationCount: explorations.length,
  };
}

// ---------------------------------------------------------------------------
// Claude CLI Check
// ---------------------------------------------------------------------------

async function isClaudeAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "claude"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function textResponse(text: string, contentType = "text/plain; charset=utf-8", status = 200): Response {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": contentType,
      ...corsHeaders(),
    },
  });
}

// ---------------------------------------------------------------------------
// Main Server
// ---------------------------------------------------------------------------

async function main() {
  // Discover files
  const files = await discoverMarkdownFiles(TARGET_DIR);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  // Generate file tree
  const fileTree = generateFileTree(files);

  // Read README for explorations
  const readmeContent = await readFileContent(join(TARGET_DIR, "README.md"));

  // Assemble context
  const systemPrompt = await assembleContext(files, TARGET_DIR, fileTree);

  // Check claude availability
  const claudeAvailable = await isClaudeAvailable();

  // Startup banner
  console.log(`
  docchat — codebase understanding tool
  Target: ${TARGET_DIR}
  Docs: ${files.length} markdown files (${Math.round(totalSize / 1024)}KB)
  Claude: ${claudeAvailable ? "available" : "not found"}
  Server: http://localhost:${PORT}
`);

  // Log file count and total size
  console.log(`Discovered ${files.length} markdown files, total size: ${totalSize} bytes`);

  Bun.serve({
    port: PORT,
    idleTimeout: 120,

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const { pathname } = url;
      const method = req.method;

      // OPTIONS — CORS preflight
      if (method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders(),
        });
      }

      // GET / — serve index.html
      if (method === "GET" && pathname === "/") {
        const indexPath = join(import.meta.dir, "public", "index.html");
        try {
          const file = Bun.file(indexPath);
          if (await file.exists()) {
            return new Response(file, {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                ...corsHeaders(),
              },
            });
          }
        } catch {
          // fall through
        }
        return textResponse("index.html not found", "text/plain", 404);
      }

      // GET /api/info
      if (method === "GET" && pathname === "/api/info") {
        const info = await getProjectInfo(files, TARGET_DIR);
        return jsonResponse(info);
      }

      // GET /api/docs
      if (method === "GET" && pathname === "/api/docs") {
        const docs = files.map((f) => ({ path: f.path, size: f.size }));
        return jsonResponse(docs);
      }

      // GET /api/docs/*
      if (method === "GET" && pathname.startsWith("/api/docs/")) {
        const docPath = decodeURIComponent(pathname.slice("/api/docs/".length));
        const file = files.find((f) => f.path === docPath);
        if (!file) {
          return jsonResponse({ error: "File not found" }, 404);
        }
        const content = await readFileContent(file.absPath);
        return textResponse(content, "text/markdown; charset=utf-8");
      }

      // GET /api/explorations
      if (method === "GET" && pathname === "/api/explorations") {
        const explorations = await listExplorations(TARGET_DIR);
        return jsonResponse(explorations);
      }

      // GET /api/explorations/:name
      if (method === "GET" && pathname.startsWith("/api/explorations/")) {
        const name = decodeURIComponent(pathname.slice("/api/explorations/".length));
        const filePath = join(TARGET_DIR, ".docchat", "explorations", name);
        try {
          const file = Bun.file(filePath);
          if (await file.exists()) {
            const content = await file.text();
            return textResponse(content, "text/markdown; charset=utf-8");
          }
        } catch {
          // fall through
        }
        return jsonResponse({ error: "Exploration not found" }, 404);
      }

      // POST /api/ask — SSE streaming chat
      if (method === "POST" && pathname === "/api/ask") {
        let body: { question?: string; prompt?: string; sessionId?: string };
        try {
          body = await req.json();
        } catch {
          return jsonResponse({ error: "Invalid JSON body" }, 400);
        }

        const prompt = body.question || body.prompt;
        if (!prompt || typeof prompt !== "string") {
          return jsonResponse({ error: "Missing question" }, 400);
        }

        const clientSessionId = body.sessionId || undefined;
        const claudeSessionId = clientSessionId ? sessionMap.get(clientSessionId) : undefined;

        const args = [
          "claude",
          "-p",
          "--model",
          "claude-haiku-4-5",
          "--tools",
          "",
          "--append-system-prompt",
          systemPrompt,
          "--output-format",
          "stream-json",
          "--include-partial-messages",
          "--setting-sources",
          "",
        ];

        if (claudeSessionId) {
          args.push("--resume", claudeSessionId);
        }

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

        proc.stdin.write(prompt);
        proc.stdin.end();

        // Drain stderr async
        const stderrDrain = new Response(proc.stderr).text().catch(() => "");

        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            const reader = proc.stdout.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let fullText = "";
            let resultSessionId = "";

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

                    if (parsed.type === "system") {
                      // Skip system messages
                      continue;
                    }

                    if (parsed.type === "stream_event") {
                      const event = parsed.event;
                      if (
                        event?.type === "content_block_delta" &&
                        event?.delta?.type === "text_delta" &&
                        event?.delta?.text
                      ) {
                        fullText += event.delta.text;
                        controller.enqueue(
                          encoder.encode(sseEvent("token", { text: event.delta.text })),
                        );
                      }
                    }

                    if (parsed.type === "result") {
                      if (parsed.result) fullText = parsed.result;
                      if (parsed.session_id) resultSessionId = parsed.session_id;
                    }
                  } catch {
                    // skip malformed JSON
                  }
                }
              }

              // Process remaining buffer
              if (buffer.trim()) {
                try {
                  const parsed = JSON.parse(buffer);
                  if (parsed.type === "result") {
                    if (parsed.result) fullText = parsed.result;
                    if (parsed.session_id) resultSessionId = parsed.session_id;
                  }
                } catch {
                  // skip
                }
              }

              // Store session mapping
              if (clientSessionId && resultSessionId) {
                sessionMap.set(clientSessionId, resultSessionId);
              }

              controller.enqueue(
                encoder.encode(sseEvent("done", { fullText, sessionId: resultSessionId })),
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              controller.enqueue(
                encoder.encode(sseEvent("error", { error: msg })),
              );
            } finally {
              reader.releaseLock();
              controller.close();
              await stderrDrain;
            }
          },
        });

        return new Response(stream, {
          headers: sseHeaders(),
        });
      }

      // POST /api/explore — trigger exploration with SSE progress
      if (method === "POST" && pathname === "/api/explore") {
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();

            runExploration({
              targetDir: TARGET_DIR,
              fileTree,
              readmeContent,
              onProgress(message: string) {
                controller.enqueue(
                  encoder.encode(sseEvent("progress", { text: message })),
                );
              },
              onComplete(result: ExploreResult) {
                controller.enqueue(
                  encoder.encode(
                    sseEvent("done", {
                      filename: result.filename,
                      duration: result.duration,
                      content: result.content,
                    }),
                  ),
                );
                controller.close();
              },
              onError(error: string) {
                controller.enqueue(
                  encoder.encode(sseEvent("error", { error })),
                );
                controller.close();
              },
            });
          },
        });

        return new Response(stream, {
          headers: sseHeaders(),
        });
      }

      // GET /public/* — static files
      if (method === "GET" && pathname.startsWith("/public/")) {
        const filePath = join(import.meta.dir, pathname);
        try {
          const file = Bun.file(filePath);
          if (await file.exists()) {
            const ext = extname(filePath);
            const contentType = MIME_TYPES[ext] || "application/octet-stream";
            return new Response(file, {
              headers: {
                "Content-Type": contentType,
                ...corsHeaders(),
              },
            });
          }
        } catch {
          // fall through
        }
        return textResponse("Not found", "text/plain", 404);
      }

      // 404
      return jsonResponse({ error: "Not found" }, 404);
    },
  });
}

main();
