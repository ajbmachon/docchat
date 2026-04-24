# DocChat Review and Improvement Proposals

Date: 2026-04-24

## Updated Understanding

DocChat should not become another coding agent. You already have Codex and Claude Code for code inspection, file editing, citations, and implementation work.

The magic of DocChat is different:

> Drop it into a project with scattered markdown docs, then chat with those docs until the project becomes coherent.

`pi-mono` is the right example. It has many useful markdown files spread across root docs, package READMEs, package docs, changelogs, plans, examples, agent instructions, and the handmade `Understanding-PI` prototype. The duplication in `Understanding-PI/guides` exists because that prototype manually gathered and rewrote docs. DocChat should not require that. It should read the existing markdown in place and build a virtual coherence layer over it.

So the center of the product is not "source code understanding." It is "visual, conversational documentation understanding."

This matters because Codex and Claude Code can already search and explain markdown in a terminal. DocChat needs to be more than "Codex, but pointed at docs." Its advantage is the combination of a visual map, a focused chat interface, and an assistant that can move the UI while explaining.

The agent should still use its intelligence to synthesize. The boundary is not "never generate docs." The boundary is "do not silently create a duplicate documentation tree." Good generated artifacts are intentional: high-level overviews, start-here pages, topic summaries, glossary pages, doc gap reports, and bridge sections that connect scattered source docs.

## Thinking Method Used

I re-ran the analysis with the imported `thinking` and `be-creative` methods:

- First principles: identify the real job DocChat should do.
- Iterative depth: view the product through reader, maintainer, documentation, chat, and tooling lenses.
- Red team: attack the earlier code-index/citation framing.
- Science: define testable improvement milestones.
- Be creative: generate several non-obvious product directions, then select three that fit the clarified goal.

## First-Principles Diagnosis

The fundamental job is:

> Turn a pile of existing markdown into an explorable, conversational understanding layer without duplicating the source docs.

Hard requirements:

1. Do not copy or fork the docs into a second docs folder.
2. Keep every explanation traceable to the original markdown file.
3. Let chat be the primary interaction, not a decorative side panel.
4. Help users find the right reading path through messy docs.
5. Detect overlap, contradiction, stale material, and missing connective tissue.
6. Let the assistant control the visual workspace through safe UI actions.
7. Let the agent create deliberate synthesis artifacts when they add real understanding.
8. Keep generated material separate, ephemeral, or explicitly saved under `.docchat`, not mixed into source docs unless the user asks.

Soft constraints to challenge:

- "Exploration must generate a big markdown report." Maybe it should first generate a map, guide, and chat memory.
- "The sidebar should list files." Maybe it should list topics, questions, reading paths, and doc clusters.
- "The assistant needs code access." For this product, docs are the corpus. Code access is optional background context, not the main act.
- "Chat answers should only be text." In DocChat, a good answer may also drive the UI: open the right file, select headings, compare pages, or create a temporary explainer view.
- "Generated docs are bad." Duplicated docs are bad. Deliberate, clearly-labeled synthesis docs can be great.

## pi-mono Observations

From a quick corpus scan of `/Users/andremachon/Projects/pi-mono`:

- Around 118 markdown files.
- Major doc clusters:
  - Root docs: `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, plans.
  - `packages/coding-agent/docs`: deep reference docs such as `extensions.md`, `rpc.md`, `sdk.md`, `settings.md`.
  - Package READMEs and changelogs.
  - `packages/mom/docs`, `packages/pods/docs`, examples, skills fixtures.
  - `Understanding-PI/guides`: handmade synthesized docs from the prototype.
- The real pain is not "where is implementation X?" It is:
  - Which docs are canonical?
  - What should I read first?
  - Which docs repeat each other?
  - Which docs are reference docs versus tutorials?
  - Which docs are stale, generated, examples, or agent-only instructions?
  - How do these separate markdown files add up to one coherent story?

That is the opportunity.

## What Is Right In Current DocChat

- It already focuses on markdown files, which is closer to the clarified goal than the earlier code-index idea.
- The three-panel UI is a good starting shape: docs, reading surface, chat.
- The chat affordance is already there and streaming.
- Explorations are saved as markdown, which is useful if treated as generated synthesis, not source-of-truth replacement.
- It is small, local, and drop-in.

## What Needs To Change

- Reframe copy and prompts away from "codebase expert" toward "documentation guide."
- Stop treating file tree plus README as enough context. Build a doc corpus model.
- Add topic and relationship extraction across markdown files.
- Make chat the main product surface.
- Make the UI agent-controllable through structured actions.
- Make generated synthesis non-duplicating by default.
- Add an explicit "save synthesis" flow for high-level overviews and summaries.
- Add corpus health analysis: duplicates, overlaps, contradictions, stale docs, missing intro docs.
- Make `Exploration` less like a static report and more like a "Doc Map" the chat can use.

## Core Differentiator: Visual Chat

DocChat should win because the answer is not trapped in a terminal transcript. The explanation should happen in a workspace:

- The assistant says "there are three docs about RPC" and opens the topic cluster.
- It compares two docs side by side and highlights the repeated sections.
- It builds a short reading path and pins it in the sidebar.
- It answers a follow-up while keeping the relevant heading visible.
- It creates a temporary "Start Here" page from existing docs without writing a duplicate guide.
- It drafts a high-level overview and asks whether to save it as `.docchat/summaries/overview.md` or propose a patch to an existing README.
- It can mark a doc as "reference", "tutorial", "agent instruction", or "possibly stale" in the atlas view.

This is the gap between "I asked Codex to search the docs" and "I understand the docs now."

## Proposal 1: Virtual Doc Atlas

### Thesis

DocChat should build a non-duplicating map of the existing docs, then let the user navigate that map through chat.

No copied `guides/` folder. No rewritten shadow docs. Just an atlas over the markdown already in the repo.

### What It Adds

- Markdown corpus scanner:
  - Finds markdown files in place.
  - Classifies docs by role: overview, tutorial, reference, changelog, plan, agent instructions, example, generated artifact.
  - Extracts headings, links, title, summary, size, modified date, and likely audience.
- Topic map:
  - Groups docs by concepts, not just folders.
  - Shows clusters such as "extensions", "RPC", "sessions", "providers", "themes", "release process".
  - Detects docs that belong to multiple topics.
- Reading paths:
  - "New maintainer path."
  - "User trying to install and use the project."
  - "Extension author path."
  - "Architecture deep dive."
  - "What changed recently?"
- Canonicality hints:
  - Which doc looks like the main entry point.
  - Which docs appear to duplicate or summarize others.
  - Which docs are likely reference material rather than narrative material.
- UI changes:
  - Sidebar can switch between Files, Topics, Reading Paths, and Questions.
  - The center panel can show a virtual topic page assembled from summaries and links, not copied content.
  - Chat can open or highlight relevant docs as it explains.
- Agent-controlled atlas:
  - The assistant can call UI actions such as `openDoc`, `jumpToHeading`, `showTopic`, `compareDocs`, `pinReadingPath`, and `highlightOverlap`.
  - These actions mutate the visible workspace, not the source repo.
  - Every action is reversible from the UI.

### Generated Artifacts

By default, generated data lives under `.docchat/atlas.json` or `.docchat/cache`, not in the docs tree. If the user wants a permanent doc, DocChat can propose an edit to the original docs rather than creating a duplicate parallel guide.

### Why Pick This

This directly solves the `pi-mono` problem: many markdown files, unclear relationships, and no desire to maintain a duplicate documentation site by hand.

### Success Criteria

- Running DocChat on `pi-mono` produces a useful topic map without creating duplicate guide files.
- The app can answer "where should I start?" with a reading path.
- The app can answer "which docs explain RPC?" by grouping all relevant docs and explaining their differences.
- The user can distinguish canonical docs from examples, changelogs, and generated/prototype docs.

## Proposal 2: Chat-First Visual Documentation Explainer

### Thesis

The main surface should feel like chatting with a patient documentation expert who has read the whole repo.

The chat should not merely answer isolated questions. It should guide, explain, compare, and ask clarifying questions when the docs are ambiguous.

### What It Adds

- Explanation modes:
  - "Explain the project."
  - "Explain this doc."
  - "Explain this topic across all docs."
  - "Explain the difference between these two docs."
  - "Give me the shortest useful reading path."
  - "Teach me this as a newcomer."
  - "Give me maintainer-level context."
- Context-aware chat:
  - The assistant knows the currently open doc/topic/path.
  - The assistant can say "this is covered in three places" and explain how they relate.
  - The assistant can expose uncertainty: "the docs disagree here" or "this looks stale."
- Conversational navigation:
  - Answers can include lightweight action markers such as open doc, jump heading, show related topic, compare docs.
  - The UI follows the conversation instead of making the user hunt manually.
- UI tools for the assistant:
  - `open_doc(path, heading?)`
  - `show_topic(topicId)`
  - `compare_docs(paths)`
  - `highlight_ranges(path, headingsOrLines)`
  - `pin_reading_path(title, items)`
  - `show_temporary_page(markdown, sources)`
  - `set_focus(mode)` for Files, Topics, Reading Path, Audit, or Chat.
- Curated synthesis:
  - Generate a high-level project overview.
  - Generate a "Start Here" summary from existing docs.
  - Generate topic summaries such as "RPC in this project" or "How extensions fit together."
  - Save summaries only when the user asks, preferably under `.docchat/summaries` or as proposed patches to existing canonical docs.
- Persistent understanding:
  - Save useful chat explanations as `.docchat/notes`, if requested.
  - Pin a "current understanding" summary for the session.
  - Let the user ask follow-ups against that session memory.
- Better prompts:
  - System prompt becomes "documentation guide and synthesizer."
  - The assistant is instructed not to pretend docs are complete.
  - The assistant distinguishes source-doc facts from synthesis.

### Backend Choice

Claude CLI, Codex CLI, or Codex App Server can all be providers, but they are backend choices. The product should not be organized around a coding agent protocol. It should be organized around chat-assisted documentation comprehension.

Codex App Server could still help later for long-lived sessions, interrupts, and cleaner tool calling, but it should not pull the product back into code-agent territory.

The important provider capability is not "can edit code." It is "can produce structured UI actions and useful synthesis while explaining." A simple Claude subprocess can do this with action markers. A richer Codex/Pi-style RPC integration could do it more cleanly with real tools.

### Why Pick This

This protects the magic: DocChat feels useful because it explains, not because it indexes.

### Success Criteria

- A user can open `pi-mono`, ask "what is this project?", and get a coherent explanation from existing docs.
- A user can ask "what should I read next?" and get a reasoned path.
- A user can ask "how do extensions work?" and get a synthesis across README, reference docs, examples, and prototype docs.
- Chat responses help navigate the app, not just emit prose.
- The assistant can visually open, compare, and highlight docs during the explanation.
- The assistant can draft a high-level overview and ask where, or whether, to save it.

## Proposal 3: Doc Librarian And Coherence Audit

### Thesis

DocChat should help maintainers understand the state of their documentation corpus: what overlaps, what conflicts, what is stale, and what is missing.

This is not duplicate-doc generation. It is a librarian that tells you how the existing library is organized and where it is unhealthy.

### What It Adds

- Duplicate and overlap detection:
  - "These two docs explain the same topic."
  - "This guide appears to be a synthesized copy of this reference doc."
  - "This README section repeats content from package docs."
- Contradiction checks:
  - Install commands that differ.
  - Provider/model names that differ.
  - Feature descriptions that conflict.
  - Old docs that still mention removed workflows.
- Freshness signals:
  - Changelog-heavy docs separated from stable docs.
  - Old generated docs marked as possibly stale.
  - Files with many broken internal links or orphaned headings.
- Gap detection:
  - Important topic appears in references but lacks an overview.
  - Package has README but no quick start.
  - There is no clear "start here" path.
- Optional repair proposals:
  - "Move this paragraph to the canonical README."
  - "Delete or archive this duplicate."
  - "Add a short bridge section to this existing doc."
  - "Generate a PR-style patch only after user approval."
- Optional synthesis proposals:
  - "Create a one-page project overview from these canonical docs."
  - "Create a maintainer onboarding summary."
  - "Create a glossary from repeated terms."
  - "Create a high-level map that links out to existing docs instead of copying them."

### Generated Artifacts

The audit report can live in `.docchat/audits/*.md`. It should describe the current docs and propose changes. It should not silently create new public docs that fork the original content.

### Why Pick This

It turns DocChat into a documentation maintenance and synthesis assistant without becoming a coding agent. It gives maintainers leverage over messy docs while still using agent intelligence where it helps.

### Success Criteria

- Running on `pi-mono` identifies `Understanding-PI/guides` as a prototype/synthesis cluster, not canonical source docs.
- It finds overlaps between `Understanding-PI/guides/ref-rpc.md` and `packages/coding-agent/docs/rpc.md`.
- It can recommend which doc should remain canonical.
- It proposes changes to original docs only when asked.
- It can produce a useful high-level overview without duplicating source docs.

## Recommended Direction

The best path is a blend of Proposal 1 and Proposal 2 first:

1. Build the virtual doc atlas.
2. Make chat the primary explanation interface.
3. Add a small assistant UI-action protocol.
4. Add topic, reading-path, and doc-role awareness.
5. Add explicit save flows for high-level summaries and overviews.
6. Keep all generated data in `.docchat` by default unless the user asks to patch source docs.
7. Add the coherence audit after the chat experience feels magical.

The new product promise should be closer to:

> Drop DocChat into any repo. It reads the markdown where it is, builds a visual map of the documentation, and lets an assistant guide the UI while you chat your way to understanding.

## Immediate Product Changes

- Change "codebase understanding" wording to "documentation understanding" or "project docs explainer."
- Change "Run Exploration" to "Build Doc Map" or "Map Docs."
- Change the startup stats from "docs only" into corpus stats: markdown files, topics, clusters, possible duplicates.
- Add a "Start Here" generated view.
- Add "Ask about these docs" as the central first-screen action.
- Add assistant-driven UI actions: open, highlight, compare, pin, and show temporary page.
- Add "Save as overview" and "Propose README patch" actions for good summaries.
- Treat source code indexing as optional future context, not the core.
- Keep Codex/Claude provider abstraction, but do not let provider mechanics define the product.

## Implementation Slice

A good first build slice:

1. Add a `DocCorpus` scanner for markdown metadata, headings, links, and summaries.
2. Add `.docchat/atlas.json` cache with file hashes, doc roles, topics, and relationships.
3. Replace markdown-only file tree prompt with doc-atlas context.
4. Add chat prompts for documentation synthesis.
5. Add UI tabs: Files, Topics, Reading Paths.
6. Add a simple UI action marker parser and renderer.
7. Add a "Start Here" virtual page generated from the atlas.
8. Add a "draft high-level overview" flow with explicit save/apply choices.
9. Add an audit command that only reports duplication, without writing replacement docs.

## What Not To Build First

- Do not build a full code index.
- Do not make citations the dominant UI.
- Do not generate a duplicate `docs/` or `guides/` tree by default.
- Do not try to replace Codex or Claude Code.
- Do not make the product depend on Codex RPC before the docs-chat experience is right.
- Do not treat generated summaries as canonical unless the user promotes them.
- Do not let agent-written code or docs modify the user's repo by default.
