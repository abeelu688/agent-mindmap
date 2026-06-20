export type ConceptContextForMerge = {
  key: string;
  label: string;
  aliases?: string[];
  domainKeys: string[];
  parentKeys: string[];
  childKeys: string[];
  evidence: string[];
  sessionId: string;
  projectSlug: string;
};

export type OutlineDetail = {
  text: string;
  sourceTurnIndices?: number[];
};

export type OutlineNode = {
  title: string;
  summary?: string;
  conceptPath?: string[];
  children?: OutlineNode[];
  details?: OutlineDetail[];
};

export type SessionOutline = {
  title?: string;
  summary?: string;
  outline: OutlineNode[];
};

export type SessionRecordMeta = {
  sessionId: string;
  projectSlug: string;
  projectPath?: string;
  transcriptPath: string;
  transcriptMtimeMs: number;
  transcriptFreshnessToken?: string;
  transcriptSha256?: string;
  analyzedAt: number;
  llm: { provider: string; model?: string };
  promptParams: { maxTopics: number; maxItemsPerTopic: number };
  sessionLabel: string;
  hostId?: string;
  outputLanguage?: string;
};

export type SessionRecord = {
  schemaVersion: 1;
  meta: SessionRecordMeta;
  outline: SessionOutline;
  conceptContexts?: ConceptContextForMerge[];
};

export type MindMapNodeData = {
  data: {
    text: string;
    expand?: boolean;
  };
  children?: MindMapNodeData[];
  nodeData?: MindMapNodeData["data"];
};

export type MindMapRoot = MindMapNodeData;

export type MergeRecord = {
  schemaVersion: 1;
  meta: {
    kind: "deterministic" | "llm-refined";
    builtAt: number;
    sessionIds: string[];
    projectSlugs: string[];
    title?: string;
  };
  mindMap: MindMapRoot;
};

export type ProjectSummary = {
  projectSlug: string;
  projectPath?: string;
  sessionCount: number;
  lastAnalyzedAt: number;
};

export type McpIndexProjectEntry = {
  lastBuiltAt: number;
  recordCount: number;
  revision: number;
};

export type McpIndexFile = {
  schemaVersion: 1;
  updatedAt: number;
  projects: Record<string, McpIndexProjectEntry>;
};

export type SearchHitKind = "session" | "concept" | "evidence";

export type SearchHit = {
  kind: SearchHitKind;
  projectSlug: string;
  sessionId: string;
  sessionLabel: string;
  analyzedAt: number;
  conceptKey?: string;
  conceptLabel?: string;
  evidenceIndex?: number;
  score: number;
  snippet: string;
  evidence: string[];
};
