import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createDocChatApp } from "../../src/api/app";

const fixtureRoot = join(import.meta.dir, "..", "fixtures", "docs");

describe("DocChat API", () => {
  test("serves atlas and docs from fixture corpus", async () => {
    const app = await createDocChatApp({ targetDir: fixtureRoot, enableAssistantCli: false });
    const atlasRes = await app.fetch(new Request("http://docchat.test/api/atlas"));
    expect(atlasRes.status).toBe(200);
    const atlas = await atlasRes.json();
    expect(atlas.stats.docs).toBe(4);
    expect(atlas.docs[0].absPath).toBeUndefined();

    const docRes = await app.fetch(new Request("http://docchat.test/api/docs/README.md"));
    expect(docRes.status).toBe(200);
    expect(await docRes.text()).toContain("# Fixture Project");
  });

  test("streams validated chat actions over SSE", async () => {
    const app = await createDocChatApp({ targetDir: fixtureRoot, enableAssistantCli: false });
    const res = await app.fetch(new Request("http://docchat.test/api/chat", {
      method: "POST",
      body: JSON.stringify({ prompt: "Compare the RPC docs" }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(res.status).toBe(200);
    const events = parseSse(await res.text());
    expect(events.some((event) => event.event === "meta")).toBe(true);
    expect(events.some((event) => event.event === "action" && event.data.type === "show_topic")).toBe(true);
    expect(events.some((event) => event.event === "done" && event.data.actions.length > 0)).toBe(true);
  });

  test("drafts and saves synthesis artifacts", async () => {
    const app = await createDocChatApp({ targetDir: fixtureRoot, enableAssistantCli: false });
    const draftRes = await app.fetch(new Request("http://docchat.test/api/synthesis/draft", {
      method: "POST",
      body: JSON.stringify({ type: "start-here" }),
      headers: { "Content-Type": "application/json" },
    }));
    const draft = await draftRes.json();
    expect(draft.markdown).toContain("# Start Here");

    const saveRes = await app.fetch(new Request("http://docchat.test/api/synthesis/save", {
      method: "POST",
      body: JSON.stringify({ name: "../start-here", markdown: draft.markdown }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(saveRes.status).toBe(201);
    const saved = await saveRes.json();
    expect(saved.path).toContain("/.docchat/summaries/");
  });

  test("runs audits and reports media unavailable state without an API key", async () => {
    const previousKey = process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const app = await createDocChatApp({ targetDir: fixtureRoot, enableAssistantCli: false });

    const auditRes = await app.fetch(new Request("http://docchat.test/api/audit/run", { method: "POST" }));
    expect(auditRes.status).toBe(201);
    const audit = await auditRes.json();
    expect(audit.findings.length).toBeGreaterThan(0);

    const mediaRes = await app.fetch(new Request("http://docchat.test/api/media/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "Diagram the RPC flow", workflow: "technical-diagram" }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(mediaRes.status).toBe(202);
    const job = await mediaRes.json();
    expect(job.status).toBe("unavailable");
    if (previousKey) process.env.GOOGLE_API_KEY = previousKey;
  });
});

function parseSse(text: string): Array<{ event: string; data: any }> {
  return text
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1] || "message";
      const dataRaw = block.match(/^data: (.+)$/m)?.[1] || "{}";
      return { event, data: JSON.parse(dataRaw) };
    });
}
