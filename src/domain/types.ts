export type DocRole =
  | "overview"
  | "tutorial"
  | "reference"
  | "changelog"
  | "plan"
  | "agent"
  | "example"
  | "generated"
  | "other";

export interface DocHeading {
  level: number;
  text: string;
  slug: string;
  line: number;
}

export interface DocLink {
  text: string;
  target: string;
  line: number;
  isLocal: boolean;
}

export interface DocFile {
  path: string;
  absPath: string;
  size: number;
  mtimeMs: number;
  hash: string;
  title: string;
  role: DocRole;
  cluster: string;
  headings: DocHeading[];
  links: DocLink[];
  preview: string;
}

export interface AtlasTopic {
  id: string;
  label: string;
  keywords: string[];
  docPaths: string[];
  summary: string;
}

export interface ReadingPathItem {
  path: string;
  reason: string;
}

export interface ReadingPath {
  id: string;
  title: string;
  audience: string;
  items: ReadingPathItem[];
}

export interface DuplicateCandidate {
  paths: string[];
  reason: string;
  confidence: number;
}

export interface DocAtlas {
  generatedAt: string;
  rootName: string;
  stats: {
    docs: number;
    topics: number;
    clusters: number;
    duplicates: number;
    totalBytes: number;
  };
  docs: DocFile[];
  topics: AtlasTopic[];
  readingPaths: ReadingPath[];
  duplicates: DuplicateCandidate[];
  canonicalHints: Record<string, string[]>;
}

export type UiActionType =
  | "open_doc"
  | "jump_to_heading"
  | "show_topic"
  | "compare_docs"
  | "highlight_ranges"
  | "pin_reading_path"
  | "show_temporary_page"
  | "set_focus";

export interface UiAction {
  type: UiActionType;
  payload: Record<string, unknown>;
}

export interface ValidatedUiAction extends UiAction {
  id: string;
}

export interface AuditFinding {
  id: string;
  type: "duplicate" | "overlap" | "stale" | "contradiction" | "gap" | "broken_link";
  severity: "info" | "warning" | "critical";
  title: string;
  paths: string[];
  detail: string;
  recommendation: string;
  confidence: number;
}

export interface CoherenceAudit {
  generatedAt: string;
  findings: AuditFinding[];
  markdown: string;
}

export interface MediaJob {
  id: string;
  status: "unavailable" | "queued" | "running" | "complete" | "failed" | "approved";
  prompt: string;
  workflow: string;
  outputPath?: string;
  promotedPath?: string;
  error?: string;
  createdAt: string;
}
