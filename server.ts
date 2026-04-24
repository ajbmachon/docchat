import { resolve } from "node:path";
import { createDocChatApp } from "./src/api/app";

const PORT = Number.parseInt(process.env.PORT || "3333", 10);
const HOST = process.env.HOST || "127.0.0.1";
const TARGET_DIR = resolve(process.argv[2] || process.cwd());

const app = await createDocChatApp({ targetDir: TARGET_DIR });
const atlas = app.getAtlas();

console.log(`
docchat — visual documentation cockpit
Target: ${TARGET_DIR}
Docs: ${atlas.stats.docs} markdown files (${Math.round(atlas.stats.totalBytes / 1024)}KB)
Topics: ${atlas.stats.topics}
Server: http://${HOST}:${PORT}
`);

Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 120,
  fetch: app.fetch,
});
