import type {
  AgentHostId,
  PipelineVersions,
  ReattachMove,
  ReattachStep,
  SegmentEquivalence,
  SessionAnalysis,
  SessionConceptExtract,
  SessionSynonymRefine,
  SessionTreeSnapshot,
  Staleness,
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
  Staleness,
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

/**
 * A persistent, cross-session concept memory used to reduce future LLM calls.
 *
 * Intentionally decoupled from `SessionRecord` so the ontology schema can
 * evolve without rewriting every session file. The extension writes the full
 * record via `Store.writeOntologyRecord`; `SqliteStore` stores it as opaque
 * JSON in the `kv` table.
 *
 * `schemaVersion === 1` is the only field validated on read — callers that
 * need a complete record (nodes/mappings/topicPaths populated) apply their
 * own `isCompleteOntologyRecord` check on top.
 */
export type OntologyRecord = {
  schemaVersion: 1;
  meta: {
    builtAt: number;
    /** Hash key of the selection/prompt/provider inputs. */
    cacheKey: string;
    /** Session ids participating in the build input. */
    sessionIds: string[];
    /** Distinct project slugs covered. */
    projectSlugs: string[];
    /** LLM details used to produce this record. */
    llm: { provider: string; model?: string };
    /** Prompt schema versions folded into cacheKey (for debugging). */
    promptVersions: {
      ontology: number;
      topicPaths: number;
      reattach: number;
      refine: number;
      outlineSchema: number;
      sessionAnalysis?: number;
      /** M-merge virtual combined session prompt version. */
      mergeSessionAnalysis?: number;
      /** @deprecated legacy session pipeline */
      extract?: number;
      /** @deprecated legacy session pipeline */
      sessionSynonyms?: number;
      /** @deprecated legacy session pipeline */
      organize?: number;
    };
    hostId?: AgentHostId;
  };
  /**
   * Canonical concepts + lightweight relationships. Treat as a DAG:
   * - nodes are unique by `key`
   * - edges are stored as parentKeys on each node
   */
  nodes: OntologyRecordNode[];
  /**
   * Mention/alias map. Consumers should canonicalize mentions before lookup.
   */
  mappings: OntologyRecordMapping[];
  /**
   * Per-topic conceptPath decisions (the most important "memory" to reduce
   * LLM pressure). Applied to SessionRecords on-demand.
   */
  topicPaths: OntologyRecordTopicPath[];
  /** Optional patch-style tree reattachments (post-merge structural fixes). */
  reattachMoves?: ReattachMove[];
  /** Ordered M2.5 plan (preferred over reattachMoves when applying M3). */
  reattachSteps?: ReattachStep[];
  /**
   * Contextual segment aliases produced by the refine pass (e.g. reactjs →
   * react under frontend + React evidence).
   */
  segmentEquivalences?: SegmentEquivalence[];
  /** M-merge LLM2 output — one virtual combined session (Part I schema). */
  mergeSessionAnalysis?: SessionAnalysis;
};

export type OntologyRecordNode = {
  /** Canonical key used for merging across sessions (lowercase). */
  key: string;
  /** Human-friendly label (can be non-English). */
  label: string;
  aliases?: string[];
  parentKeys?: string[];
  confidence?: number;
  evidence?: string[];
};

export type OntologyRecordMapping = {
  mention: string;
  key: string;
  confidence?: number;
};

export type OntologyRecordTopicPath = {
  /** Stable identifier for the topic/leaf being classified. */
  topicId: string;
  sessionId: string;
  projectSlug: string;
  /** The inferred/normalized concept path. */
  conceptPath: string[];
  confidence?: number;
  evidence?: string[];
};

export type SearchHitKind = "session" | "concept" | "evidence" | "code";

export type SearchHit = {
  kind: SearchHitKind;
  projectSlug: string;
  sessionId: string;
  sessionLabel: string;
  analyzedAt: number;
  conceptKey?: string;
  conceptLabel?: string;
  evidenceIndex?: number;
  /** Populated when `kind === "code"`: the matched code reference. */
  codePath?: string;
  codeLines?: string;
  codeDescription?: string;
  codeSourceTurnIndices?: number[];
  /** Populated when `kind === "code"`: verbatim effective lines for staleness verification. */
  codeMarkCode?: string[];
  /**
   * On-read staleness verdict for code hits (Q4). Computed by the MCP server
   * on its response path in BOTH modes; the team service does NOT populate
   * this field. Missing on non-code hits.
   */
  staleness?: Staleness;
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
