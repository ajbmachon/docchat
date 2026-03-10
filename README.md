# docchat

Drop-in codebase understanding tool. Point it at any repo, get an AI-powered chat and deep exploration — zero config, zero dependencies.

## What it does

**Two modes:**

1. **Chat** — Ask questions about any codebase. Uses `claude -p` with Haiku for fast, cheap answers with your full project docs as context.

2. **Explore** — Run a deep codebase analysis that produces a structured markdown document covering architecture, key components, data flow, and more. Saved with date and git commit hash for historical reference.

**How it works:**

- Recursively discovers all `.md` files in your repo
- Assembles them into a smart context budget (80K chars, tiered by priority)
- Serves a three-panel web app: docs sidebar, content viewer, persistent chat
- Spawns `claude -p` subprocesses for both chat and exploration
- Explorations saved to `.docchat/explorations/` with YAML frontmatter

## Requirements

- [Bun](https://bun.sh) runtime
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`)

## Usage

### Quick start

```bash
# Clone
git clone https://github.com/andremachon/docchat.git

# Run against any repo
bun run ~/path/to/docchat/server.ts /path/to/your/repo

# Or use the setup script
~/path/to/docchat/setup.sh /path/to/your/repo
```

### From the repo directory

```bash
cd your-project
bun run /path/to/docchat/server.ts .
```

Then open **http://localhost:3333**

### Custom port

```bash
PORT=8080 bun run server.ts /path/to/repo
```

## What you see

```
  docchat — codebase understanding tool
  Target: /Users/you/Projects/my-app
  Docs: 47 markdown files (312KB)
  Claude: available
  Server: http://localhost:3333
```

Three-panel interface:
- **Left sidebar** — browsable list of all markdown files + past explorations
- **Center panel** — rendered markdown content viewer
- **Right panel** — persistent chat powered by Claude Haiku

## Exploration

Click **"Run Exploration"** in the sidebar. The tool:

1. Sends your file tree + README to Claude
2. Generates a structured analysis document
3. Saves it to `.docchat/explorations/YYYY-MM-DD_HHMMSS.md`
4. Includes git commit hash in frontmatter for traceability

For repos with 100+ files, two parallel agents analyze different aspects and merge results.

Each exploration is browsable in the web app and persists across sessions.

## Context Assembly

Smart progressive budget management:

| Tier | Priority | Content | Budget |
|------|----------|---------|--------|
| 1 | Always | File tree + README + package.json | ~5K |
| 2 | High | Existing explorations | Variable |
| 3 | Fill | Other .md files (truncated if >5K chars) | Remaining |

Total budget: 80,000 characters. Files are included by priority until budget is exhausted.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Web app |
| `/api/info` | GET | Repo metadata (name, file count, size) |
| `/api/docs` | GET | List of discovered markdown files |
| `/api/docs/:path` | GET | Raw markdown content |
| `/api/explorations` | GET | List of saved explorations |
| `/api/explorations/:name` | GET | Specific exploration content |
| `/api/ask` | POST | Chat via SSE streaming |
| `/api/explore` | POST | Trigger exploration via SSE streaming |

## Architecture

```
docchat/
  server.ts      — Bun HTTP server, routing, context assembly
  explore.ts     — Exploration agent orchestration
  setup.sh       — Idempotent launcher with dependency checks
  public/
    index.html   — Three-panel layout
    css/styles.css — Dark editorial design system
    js/app.js    — Navigation and content loading
    js/chat.js   — SSE streaming chat
    js/explore.js — Exploration trigger and progress
    js/markdown.js — Zero-dep markdown renderer
```

Zero npm dependencies. Vanilla JS frontend. Bun-native backend.

## License

MIT
