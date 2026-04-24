import { basename, extname, join, resolve } from "node:path";
import { discoverMarkdownFiles, extractKeywords, readDocContent } from "../domain/doc-corpus";
import { buildAtlas } from "../domain/atlas-builder";
import { runCoherenceAudit } from "../domain/coherence-audit";
import { MediaService } from "../domain/media-service";
import { draftSynthesis, type SynthesisRequest } from "../domain/synthesis";
import { parseAssistantActions, validateUiActions } from "../domain/ui-actions";
import type { AtlasTopic, DocAtlas, DocFile, UiAction, ValidatedUiAction } from "../domain/types";
import { ArtifactStore, assertInside, safeFilename } from "../infra/artifact-store";

const CHAT_SNIPPET_BUDGET = 26_000;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export interface DocChatAppOptions {
  targetDir: string;
  publicDir?: string;
  enableAssistantCli?: boolean;
  loadEnvFiles?: boolean;
}

export interface DocChatApp {
  targetDir: string;
  fetch(req: Request): Promise<Response>;
  refreshAtlas(): Promise<DocAtlas>;
  getAtlas(): DocAtlas;
}

export async function createDocChatApp(options: DocChatAppOptions): Promise<DocChatApp> {
  const targetDir = resolve(options.targetDir);
  const publicDir = resolve(options.publicDir || join(import.meta.dir, "..", "..", "public"));
  const artifactStore = new ArtifactStore(targetDir);
  const mediaService = new MediaService({ targetDir, loadEnvFiles: options.loadEnvFiles });
  const sessionMap = new Map<string, string>();
  let atlas = await buildAndCacheAtlas(targetDir, artifactStore);

  async function refreshAtlas(): Promise<DocAtlas> {
    atlas = await buildAndCacheAtlas(targetDir, artifactStore);
    return atlas;
  }

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method;
    const pathname = url.pathname;

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    if (method === "GET" && pathname === "/") {
      return servePublicFile(publicDir, "index.html");
    }

    if (method === "GET" && pathname.startsWith("/public/")) {
      return servePublicFile(publicDir, decodeURIComponent(pathname.slice("/public/".length)));
    }

    if (method === "GET" && pathname === "/api/info") {
      const hasClaude = options.enableAssistantCli === false ? false : await isCommandAvailable("claude");
      const hasCodex = await isCommandAvailable("codex");
      return jsonResponse({
        name: basename(targetDir),
        targetDir,
        atlas: serializeAtlas(atlas).stats,
        hasClaude,
        hasCodex,
        assistantProvider: hasClaude ? "claude-cli" : "local-guide",
        media: mediaService.availability(),
      });
    }

    if (method === "GET" && pathname === "/api/atlas") {
      return jsonResponse(serializeAtlas(atlas));
    }

    if (method === "POST" && pathname === "/api/atlas/rebuild") {
      return jsonResponse(serializeAtlas(await refreshAtlas()));
    }

    if (method === "GET" && pathname === "/api/topics") {
      return jsonResponse(serializeAtlas(atlas).topics);
    }

    if (method === "GET" && pathname === "/api/paths") {
      return jsonResponse(serializeAtlas(atlas).readingPaths);
    }

    if (method === "GET" && pathname === "/api/docs") {
      return jsonResponse(serializeAtlas(atlas).docs);
    }

    if (method === "GET" && pathname.startsWith("/api/docs/")) {
      const docPath = decodeURIComponent(pathname.slice("/api/docs/".length));
      const doc = atlas.docs.find((item) => item.path === docPath);
      if (!doc) return jsonResponse({ error: "Document not found" }, 404);
      const content = await readDocContent(targetDir, doc.path);
      return textResponse(content || "", "text/markdown; charset=utf-8");
    }

    if (method === "POST" && (pathname === "/api/chat" || pathname === "/api/ask")) {
      return handleChat(req, atlas, targetDir, sessionMap, options.enableAssistantCli !== false);
    }

    if (method === "POST" && pathname === "/api/synthesis/draft") {
      const body = await parseJson<SynthesisRequest>(req);
      if (!body.ok) return body.response;
      return jsonResponse(draftSynthesis(atlas, body.data));
    }

    if (method === "POST" && pathname === "/api/synthesis/save") {
      const body = await parseJson<{ name?: string; markdown?: string }>(req);
      if (!body.ok) return body.response;
      if (!body.data.markdown || typeof body.data.markdown !== "string") {
        return jsonResponse({ error: "Missing markdown" }, 400);
      }
      const saved = await artifactStore.saveMarkdown("summaries", body.data.name || "summary", body.data.markdown);
      return jsonResponse(saved, 201);
    }

    if (method === "GET" && pathname === "/api/synthesis") {
      return jsonResponse(await artifactStore.list("summaries"));
    }

    if (method === "GET" && pathname === "/api/audit") {
      return jsonResponse(runCoherenceAudit(atlas));
    }

    if (method === "POST" && pathname === "/api/audit/run") {
      const audit = runCoherenceAudit(atlas);
      const saved = await artifactStore.saveMarkdown("audits", `audit-${Date.now()}`, audit.markdown);
      return jsonResponse({ ...audit, saved }, 201);
    }

    if (method === "POST" && pathname === "/api/explore") {
      return handleAuditStream(atlas, artifactStore);
    }

    if (method === "GET" && pathname === "/api/media") {
      return jsonResponse({
        availability: mediaService.availability(),
        jobs: mediaService.listJobs(),
        approved: await artifactStore.list("media"),
      });
    }

    if (method === "POST" && pathname === "/api/media/generate") {
      const body = await parseJson<{ prompt?: string; workflow?: string }>(req);
      if (!body.ok) return body.response;
      if (!body.data.prompt || typeof body.data.prompt !== "string") {
        return jsonResponse({ error: "Missing prompt" }, 400);
      }
      const job = await mediaService.generate(body.data.prompt, body.data.workflow || "technical-diagram");
      return jsonResponse(job, job.status === "unavailable" ? 202 : 201);
    }

    if (method === "POST" && pathname === "/api/media/promote") {
      const body = await parseJson<{ jobId?: string }>(req);
      if (!body.ok) return body.response;
      if (!body.data.jobId) return jsonResponse({ error: "Missing jobId" }, 400);
      const job = await mediaService.promote(body.data.jobId);
      return job ? jsonResponse(job) : jsonResponse({ error: "Media job is not promotable" }, 400);
    }

    return jsonResponse({ error: "Not found" }, 404);
  }

  return {
    targetDir,
    fetch,
    refreshAtlas,
    getAtlas: () => atlas,
  };
}

async function buildAndCacheAtlas(targetDir: string, artifactStore: ArtifactStore): Promise<DocAtlas> {
  const docs = await discoverMarkdownFiles(targetDir);
  const atlas = buildAtlas(basename(targetDir), docs);
  await artifactStore.saveJson("atlas.json", atlas);
  return atlas;
}

async function servePublicFile(publicDir: string, relPath: string): Promise<Response> {
  const filePath = resolve(publicDir, relPath || "index.html");
  try {
    assertInside(filePath, publicDir);
    const file = Bun.file(filePath);
    if (!(await file.exists())) return textResponse("Not found", "text/plain; charset=utf-8", 404);
    return new Response(file, {
      headers: {
        "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
        ...corsHeaders(),
      },
    });
  } catch {
    return textResponse("Not found", "text/plain; charset=utf-8", 404);
  }
}

async function handleChat(
  req: Request,
  atlas: DocAtlas,
  targetDir: string,
  sessionMap: Map<string, string>,
  enableAssistantCli: boolean,
): Promise<Response> {
  const body = await parseJson<{ prompt?: string; question?: string; sessionId?: string }>(req);
  if (!body.ok) return body.response;
  const prompt = body.data.prompt || body.data.question;
  if (!prompt || typeof prompt !== "string") return jsonResponse({ error: "Missing prompt" }, 400);

  const stream = new ReadableStream({
    async start(controller) {
      const send = makeSseSender(controller);
      const cliAvailable = enableAssistantCli && await isCommandAvailable("claude");
      const provider = cliAvailable ? "claude-cli" : "local-guide";
      send("meta", { provider, atlasGeneratedAt: atlas.generatedAt });

      try {
        const result = cliAvailable
          ? await askClaude(prompt, atlas, targetDir, body.data.sessionId ? sessionMap.get(body.data.sessionId) : undefined)
          : { text: generateLocalGuideAnswer(prompt, atlas), sessionId: "" };
        const parsed = parseAssistantActions(result.text);
        const actions = mergeActions([
          ...validateUiActions(parsed.actions, atlas),
          ...validateUiActions(suggestUiActions(prompt, atlas), atlas),
        ]);

        for (const chunk of chunkText(parsed.cleanText, 96)) {
          send("token", { text: chunk });
        }
        for (const action of actions) send("action", action);
        if (body.data.sessionId && result.sessionId) sessionMap.set(body.data.sessionId, result.sessionId);
        send("done", { fullText: parsed.cleanText, sessionId: result.sessionId, actions });
      } catch (err) {
        send("error", { error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

async function handleAuditStream(atlas: DocAtlas, artifactStore: ArtifactStore): Promise<Response> {
  const stream = new ReadableStream({
    async start(controller) {
      const send = makeSseSender(controller);
      try {
        send("progress", { text: "Building coherence audit" });
        const audit = runCoherenceAudit(atlas);
        const saved = await artifactStore.saveMarkdown("audits", `audit-${Date.now()}`, audit.markdown);
        send("done", { ...audit, saved });
      } catch (err) {
        send("error", { error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

async function askClaude(prompt: string, atlas: DocAtlas, targetDir: string, sessionId?: string): Promise<{ text: string; sessionId: string }> {
  const systemPrompt = await buildChatSystemPrompt(prompt, atlas, targetDir);
  const args = [
    "claude",
    "-p",
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
  if (sessionId) args.push("--resume", sessionId);

  const proc = Bun.spawn(args, { stdin: "pipe", stdout: "pipe", stderr: "pipe", cwd: targetDir });
  proc.stdin.write(prompt);
  proc.stdin.end();

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text().catch(() => ""),
    new Response(proc.stderr).text().catch(() => ""),
    proc.exited,
  ]);
  if (proc.exitCode !== 0) {
    throw new Error(stderr || `Claude CLI exited with code ${proc.exitCode}`);
  }

  let text = "";
  let resultSessionId = "";
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "stream_event") {
        const event = parsed.event;
        if (event?.type === "content_block_delta" && event?.delta?.type === "text_delta") {
          text += event.delta.text || "";
        }
      }
      if (parsed.type === "result") {
        if (parsed.result) text = parsed.result;
        if (parsed.session_id) resultSessionId = parsed.session_id;
      }
    } catch {
      // Ignore non-JSON CLI output.
    }
  }
  return { text: text || "I could not produce a response from the assistant provider.", sessionId: resultSessionId };
}

async function buildChatSystemPrompt(question: string, atlas: DocAtlas, targetDir: string): Promise<string> {
  const relevantDocs = selectRelevantDocs(question, atlas).slice(0, 7);
  const snippets: string[] = [];
  let remaining = CHAT_SNIPPET_BUDGET;
  for (const doc of relevantDocs) {
    const content = await readDocContent(targetDir, doc.path);
    if (!content || remaining <= 0) continue;
    const excerpt = content.slice(0, Math.min(remaining, 4_000));
    remaining -= excerpt.length;
    snippets.push(`## ${doc.path}\n${excerpt}`);
  }

  return [
    "You are DocChat, a documentation guide and synthesizer inside a local project.",
    "Your job is to help the reader understand scattered markdown docs in place, identify canonical sources, explain overlaps, and draft synthesis artifacts when useful.",
    "Do not ask to duplicate a docs tree. Do not claim to edit source markdown. Source-doc patches require explicit user approval outside the chat answer.",
    "",
    "When a visual UI action would help, append one or more exact action markers at the end of your answer.",
    "Allowed markers:",
    '- [[docchat-action:{"type":"open_doc","payload":{"path":"README.md"}}]]',
    '- [[docchat-action:{"type":"jump_to_heading","payload":{"path":"README.md","heading":"Usage"}}]]',
    '- [[docchat-action:{"type":"show_topic","payload":{"topicId":"rpc"}}]]',
    '- [[docchat-action:{"type":"compare_docs","payload":{"paths":["README.md","docs/rpc.md"]}}]]',
    '- [[docchat-action:{"type":"highlight_ranges","payload":{"path":"README.md","headings":["Usage"]}}]]',
    '- [[docchat-action:{"type":"pin_reading_path","payload":{"pathId":"start-here"}}]]',
    '- [[docchat-action:{"type":"show_temporary_page","payload":{"markdown":"# Draft\\n..."}}]]',
    '- [[docchat-action:{"type":"set_focus","payload":{"mode":"topics"}}]]',
    "Use only paths, topic IDs, and reading path IDs listed in the atlas below.",
    "",
    "Atlas summary:",
    JSON.stringify(summarizeAtlasForPrompt(atlas), null, 2),
    "",
    "Relevant source snippets:",
    snippets.join("\n\n") || "No direct snippets selected; answer from atlas metadata.",
  ].join("\n");
}

function generateLocalGuideAnswer(question: string, atlas: DocAtlas): string {
  const relevantDocs = selectRelevantDocs(question, atlas).slice(0, 4);
  const topic = selectRelevantTopic(question, atlas);
  const lower = question.toLowerCase();
  const actions: string[] = [];

  if (topic) actions.push(actionMarker("show_topic", { topicId: topic.id }));
  if (/\b(start|begin|onboard|orientation|overview)\b/.test(lower) && atlas.readingPaths[0]) {
    actions.push(actionMarker("pin_reading_path", { pathId: atlas.readingPaths[0].id }));
  }
  if (/\b(compare|overlap|duplicate|same|difference)\b/.test(lower)) {
    const comparePaths = atlas.duplicates[0]?.paths || relevantDocs.slice(0, 2).map((doc) => doc.path);
    if (comparePaths.length >= 2) actions.push(actionMarker("compare_docs", { paths: comparePaths.slice(0, 3) }));
  } else if (relevantDocs[0]) {
    actions.push(actionMarker("open_doc", { path: relevantDocs[0].path }));
  }

  const lines = [
    `I built this answer from the current ${atlas.rootName} documentation atlas.`,
    "",
    relevantDocs.length
      ? `The strongest source${relevantDocs.length === 1 ? "" : "s"} for this question: ${relevantDocs.map((doc) => doc.path).join(", ")}.`
      : "I did not find a strong direct source match, so I would start with the main reading path and the highest-signal topics.",
    topic ? `The nearest topic cluster is ${topic.label}, which spans ${topic.docPaths.length} document${topic.docPaths.length === 1 ? "" : "s"}.` : "",
    atlas.duplicates.length ? `There are ${atlas.duplicates.length} overlap candidate${atlas.duplicates.length === 1 ? "" : "s"} in the atlas, so I would check canonicality before turning this into source documentation.` : "",
    "",
    "A good next move is to open the source doc, compare overlaps if present, then save a `.docchat/summaries` draft only after the explanation feels coherent.",
    actions.join(""),
  ].filter(Boolean);
  return lines.join("\n");
}

function suggestUiActions(question: string, atlas: DocAtlas): UiAction[] {
  const lower = question.toLowerCase();
  const relevantDocs = selectRelevantDocs(question, atlas).slice(0, 4);
  const topic = selectRelevantTopic(question, atlas);
  const actions: UiAction[] = [];

  if (topic) actions.push({ type: "show_topic", payload: { topicId: topic.id } });
  if (/\b(start|begin|onboard|orientation|overview)\b/.test(lower) && atlas.readingPaths[0]) {
    actions.push({ type: "pin_reading_path", payload: { pathId: atlas.readingPaths[0].id } });
  }
  if (/\b(compare|overlap|duplicate|same|difference)\b/.test(lower)) {
    const duplicate = bestDuplicateForQuestion(question, atlas);
    const paths = duplicate?.paths || relevantDocs.slice(0, 2).map((doc) => doc.path);
    if (paths.length >= 2) actions.push({ type: "compare_docs", payload: { paths: paths.slice(0, 3) } });
  } else if (relevantDocs[0]) {
    actions.push({ type: "open_doc", payload: { path: relevantDocs[0].path } });
  }
  return actions.slice(0, 3);
}

function bestDuplicateForQuestion(question: string, atlas: DocAtlas) {
  const terms = extractKeywords(question);
  return atlas.duplicates
    .map((candidate) => {
      const haystack = candidate.paths.join(" ").toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term.toLowerCase()) ? 1 : 0), 0);
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score || b.candidate.confidence - a.candidate.confidence)[0]?.candidate;
}

function mergeActions(actions: ValidatedUiAction[]): ValidatedUiAction[] {
  const seen = new Set<string>();
  const merged: ValidatedUiAction[] = [];
  for (const action of actions) {
    const key = `${action.type}:${stablePayloadKey(action.payload)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(action);
  }
  return merged.slice(0, 4);
}

function stablePayloadKey(payload: Record<string, unknown>): string {
  if (Array.isArray(payload.paths)) {
    return JSON.stringify({ ...payload, paths: [...payload.paths].sort() });
  }
  return JSON.stringify(payload);
}

function selectRelevantDocs(question: string, atlas: DocAtlas): DocFile[] {
  const keywords = new Set(extractKeywords(question).concat(question.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)));
  const scored = atlas.docs.map((doc) => {
    const haystack = `${doc.path} ${doc.title} ${doc.role} ${doc.cluster} ${doc.headings.map((h) => h.text).join(" ")} ${doc.preview}`.toLowerCase();
    let score = doc.role === "overview" ? 1.5 : 0;
    for (const keyword of keywords) {
      if (keyword.length > 2 && haystack.includes(keyword)) score += keyword.length > 4 ? 2 : 1;
    }
    return { doc, score };
  });
  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.path.localeCompare(b.doc.path))
    .map((item) => item.doc);
}

function selectRelevantTopic(question: string, atlas: DocAtlas): AtlasTopic | undefined {
  const keywords = new Set(extractKeywords(question));
  return atlas.topics
    .map((topic) => {
      const terms = [topic.id, topic.label.toLowerCase(), ...topic.keywords];
      const score = terms.filter((term) => keywords.has(term.toLowerCase()) || question.toLowerCase().includes(term.toLowerCase())).length;
      return { topic, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.topic.docPaths.length - a.topic.docPaths.length)[0]?.topic;
}

function summarizeAtlasForPrompt(atlas: DocAtlas) {
  return {
    rootName: atlas.rootName,
    stats: atlas.stats,
    docs: atlas.docs.map((doc) => ({
      path: doc.path,
      title: doc.title,
      role: doc.role,
      cluster: doc.cluster,
      headings: doc.headings.slice(0, 8).map((heading) => heading.text),
      canonicalHints: atlas.canonicalHints[doc.path] || [],
    })),
    topics: atlas.topics.map((topic) => ({
      id: topic.id,
      label: topic.label,
      docPaths: topic.docPaths,
      keywords: topic.keywords,
    })),
    readingPaths: atlas.readingPaths,
    duplicates: atlas.duplicates,
  };
}

function serializeAtlas(atlas: DocAtlas): Omit<DocAtlas, "docs"> & { docs: Array<Omit<DocFile, "absPath">> } {
  return {
    ...atlas,
    docs: atlas.docs.map(({ absPath: _absPath, ...doc }) => doc),
  };
}

function actionMarker(type: ValidatedUiAction["type"], payload: Record<string, unknown>): string {
  return `[[docchat-action:${JSON.stringify({ type, payload })}]]`;
}

function makeSseSender(controller: ReadableStreamDefaultController): (event: string, data: unknown) => void {
  const encoder = new TextEncoder();
  return (event: string, data: unknown) => {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };
}

function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxChars) chunks.push(text.slice(index, index + maxChars));
  return chunks.length ? chunks : [""];
}

async function parseJson<T>(req: Request): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  try {
    return { ok: true, data: await req.json() as T };
  } catch {
    return { ok: false, response: jsonResponse({ error: "Invalid JSON body" }, 400) };
  }
}

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", command], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    ...corsHeaders(),
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
