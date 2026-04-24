import type { DocAtlas, UiAction, UiActionType, ValidatedUiAction } from "./types";

const ALLOWED_ACTIONS: UiActionType[] = [
  "open_doc",
  "jump_to_heading",
  "show_topic",
  "compare_docs",
  "highlight_ranges",
  "pin_reading_path",
  "show_temporary_page",
  "set_focus",
];

const FOCUS_MODES = new Set(["files", "topics", "paths", "audit", "media", "chat"]);
const ACTION_PATTERN = /\[\[docchat-action:([\s\S]*?)\]\]/g;

export function parseAssistantActions(text: string): { cleanText: string; actions: UiAction[] } {
  const actions: UiAction[] = [];
  const cleanText = text.replace(ACTION_PATTERN, (_marker, json) => {
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed.type === "string" && parsed.payload && typeof parsed.payload === "object") {
        actions.push(parsed);
      }
    } catch {
      // Ignore malformed action markers; the raw marker is removed to avoid visual noise.
    }
    return "";
  }).trim();
  return { cleanText, actions };
}

export function validateUiAction(action: UiAction, atlas: DocAtlas): ValidatedUiAction | null {
  if (!ALLOWED_ACTIONS.includes(action.type)) return null;
  const docs = new Set(atlas.docs.map((doc) => doc.path));
  const topics = new Set(atlas.topics.map((topic) => topic.id));
  const paths = new Set(atlas.readingPaths.map((path) => path.id));
  const payload = action.payload || {};

  switch (action.type) {
    case "open_doc": {
      if (!isKnownDoc(payload.path, docs)) return null;
      return withId(action);
    }
    case "jump_to_heading": {
      if (!isKnownDoc(payload.path, docs) || typeof payload.heading !== "string") return null;
      return withId(action);
    }
    case "show_topic": {
      if (typeof payload.topicId !== "string" || !topics.has(payload.topicId)) return null;
      return withId(action);
    }
    case "compare_docs": {
      if (!Array.isArray(payload.paths) || payload.paths.length < 2 || payload.paths.length > 3) return null;
      if (!payload.paths.every((path) => isKnownDoc(path, docs))) return null;
      return withId(action);
    }
    case "highlight_ranges": {
      if (!isKnownDoc(payload.path, docs)) return null;
      if (!Array.isArray(payload.headings) && !Array.isArray(payload.lines)) return null;
      return withId(action);
    }
    case "pin_reading_path": {
      if (typeof payload.pathId === "string" && paths.has(payload.pathId)) return withId(action);
      if (typeof payload.title !== "string" || !Array.isArray(payload.items)) return null;
      return withId(action);
    }
    case "show_temporary_page": {
      if (typeof payload.markdown !== "string" || payload.markdown.length > 20_000) return null;
      return withId(action);
    }
    case "set_focus": {
      if (typeof payload.mode !== "string" || !FOCUS_MODES.has(payload.mode)) return null;
      return withId(action);
    }
  }
}

export function validateUiActions(actions: UiAction[], atlas: DocAtlas): ValidatedUiAction[] {
  return actions.map((action) => validateUiAction(action, atlas)).filter(Boolean) as ValidatedUiAction[];
}

function isKnownDoc(path: unknown, docs: Set<string>): path is string {
  return typeof path === "string" && docs.has(path);
}

function withId(action: UiAction): ValidatedUiAction {
  return {
    ...action,
    id: `${action.type}-${Math.random().toString(36).slice(2, 10)}`,
  };
}
