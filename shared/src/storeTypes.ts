import type {
  AgentHostId,
  PipelineVersions,
  SegmentEquivalence,
  SessionAnalysis,
  SessionConceptExtract,
  SessionSynonymRefine,
  SessionTreeSnapshot,
  TopicGraph,
} from "./llmTypes";

export type {
  AgentHostId,
  CodeReference,
  ConceptOntology,
  ConceptOntologyMapping,
  ConceptOntologyNode,
  LlmProviderId,
  MergedOutline,
  MergedOutlineDetail,
  MergedOutlineNode,
  MergedOutlineSource,
  OntologyRefineResult,
  PipelineVersions,
  ReattachMove,
  ReattachParseResult,
  ReattachStep,
  ReattachStepKind,
  SegmentEquivalence,
  SegmentEquivalenceScope,
  SessionAnalysis,
  SessionConceptExtract,
  SessionSynonymRefine,
  SessionTermAlias,
  SessionTreeSnapshot,
  TermWithContext,
  Topic,
  TopicGraph,
  TopicItem,
  TopicPathDecision,
} from "./llmTypes";

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
  /** Transcript directory uuid (also the file basename). */
  sessionId: string;
  /** `workspaceToSlug(projectPath)` — stable across renames of basename only. */
  projectSlug: string;
  /** Best-effort original filesystem path of the project, for display. */
  projectPath?: string;
  /** Absolute path to the transcript jsonl. */
  transcriptPath: string;
  /** Filesystem mtime when the analysis was performed. */
  transcriptMtimeMs: number;
  /**
   * Token used to decide whether the cached analysis is still fresh for the
   * current transcript. Currently the count of user/assistant/tool events
   * returned by `parseTranscript()` (as a decimal string) — monotonically
   * grows with real conversation, ignoring metadata-only appends like
   * `mode` / `ai-title` / `file-history-snapshot` that Claude Code writes
   * on session resume.
   *
   * Stored as a string to leave room for future composite tokens (e.g.
   * `count:lastTimestamp`).
   */
  transcriptFreshnessToken: string;
  /** @deprecated legacy freshness token, superseded by `transcriptFreshnessToken`. */
  transcriptSha256?: string;
  /** Unix epoch ms the analysis was produced. */
  analyzedAt: number;
  /** LLM provider id + model used for analysis. */
  llm: { provider: string; model?: string };
  /** Prompt parameters used; if these change we re-analyze. */
  promptParams: { maxTopics: number; maxItemsPerTopic: number };
  /**
   * Prompt schema version (legacy aggregate). Prefer {@link pipelineVersions}.
   * Absent = pre-versioning (treated as v1).
   */
  promptVersion?: number;
  /** Per-stage pipeline prompt versions for incremental cache invalidation. */
  pipelineVersions?: PipelineVersions;
  /** Same `label` produced by `listSessions`, kept for UI. */
  sessionLabel: string;
  /** AI product that produced this transcript; absent = cursor (legacy). */
  hostId?: AgentHostId;
  /** User-query turn count in transcriptPath when analyzed (for jump validation). */
  userQueryCount?: number;
  /** Natural language requested for user-visible LLM output fields. */
  outputLanguage?: string;
};

/**
 * Persisted analysis of a single agent session.
 *
 * Lives at `<storeDir>/sessions/<projectSlug>/<sessionId>.json`.
 *
 * `outline` is the primary LLM translation (hierarchical outline + leaf
 * details). `graph` is derived via `outlineToTopicGraph` for legacy merges.
 * Optional pipeline artifacts (`sessionAnalysis`, `conceptExtract`,
 * `sessionSynonyms`, `treeSnapshot`, `conceptContexts`) are present once the
 * corresponding pipeline stages have run; legacy records may be missing them.
 */
export type SessionRecord = {
  schemaVersion: 1;
  meta: SessionRecordMeta;
  outline: SessionOutline;
  /** Derived from `outline` via `outlineToTopicGraph`. */
  graph: TopicGraph;
  /** Derived from `sessionAnalysis` for merge pipeline M1. */
  conceptExtract?: SessionConceptExtract;
  /** Derived session-scoped synonym refine. */
  sessionSynonyms?: SessionSynonymRefine;
  /** S3 deterministic tree snapshot before organize. */
  treeSnapshot?: SessionTreeSnapshot;
  /** S1 one-shot LLM analysis (primary artifact). */
  sessionAnalysis?: SessionAnalysis;
  /** S2: merge-ready concept context (domain, parent, child, evidence). */
  conceptContexts?: ConceptContextForMerge[];
};

export type MindMapNodeData = {
  data: {
    text: string;
    expand?: boolean;
  };
  children?: MindMapNodeData[];
  /**
   * Legacy / mind-elixir `NodeObj` wrapper shape. Some merge roots are stored
   * as `{ nodeData: { ... } }`; readers fall back to `children` when absent.
   * Recursive to match the extension's runtime shape.
   */
  nodeData?: MindMapNodeData;
};

export type MindMapRoot = MindMapNodeData;

export type MergeRecord = {
  schemaVersion: 1;
  meta: {
    kind: "deterministic" | "llm-refined";
    builtAt: number;
    sessionIds: string[];
    projectSlugs: string[];
    /** LLM details — only set when `kind === "llm-refined"`. */
    llm?: { provider: string; model?: string };
    /** Human-readable title shown as the root node. */
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
  lastAnalyzedAt?: number;
  projectPath?: string;
};

export type McpIndexFile = {
  schemaVersion: 1;
  updatedAt: number;
  projects: Record<string, McpIndexProjectEntry>;
};

export type OntologyIndex = {
  schemaVersion: 1;
  updatedAt: number;
  entries: {
    cacheKey: string;
    builtAt: number;
    sessionIds: string[];
    projectSlugs: string[];
  }[];
};

export type OntologyRecord = {
  schemaVersion: 1;
  meta?: {
    builtAt?: number;
    sessionIds?: string[];
    projectSlugs?: string[];
  };
  segmentEquivalences?: SegmentEquivalence[];
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
  scoreBreakdown?: {
    base: number;
    kindRank: number;
    phraseBoost: number;
    coverage: number;
    recency: number;
    total: number;
  };
};
