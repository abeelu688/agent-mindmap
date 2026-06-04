import type { AgentHostId } from "../host/types";
import type {
  PipelineVersions,
  ReattachMove,
  ReattachStep,
  SegmentEquivalence,
  SessionAnalysis,
  SessionConceptExtract,
  SessionOutline,
  SessionSynonymRefine,
  SessionTreeSnapshot,
  TopicGraph,
} from "../llm/types";
import type { TopicConceptPathDecision } from "./ontologyTypes";
import type { MindMapRoot } from "../transcript/types";

/** S2 DET: per-node context for Part II concept-merge LLM. */
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

/**
 * Persisted analysis of a single agent session.
 *
 * Lives at `<storeDir>/sessions/<projectSlug>/<sessionId>.json`.
 *
 * `outline` is the primary LLM translation (hierarchical outline + leaf
 * details). `graph` is derived via `outlineToTopicGraph` for legacy merges.
 */
export type SessionRecord = {
  schemaVersion: 1;
  meta: SessionRecordMeta;
  outline: SessionOutline;
  graph: TopicGraph;
  /** Derived from sessionAnalysis for merge pipeline M1. */
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
  /** SHA-256 of transcript file content; primary "freshness" key. */
  transcriptSha256: string;
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
};

/**
 * A compact projection of `SessionRecordMeta` cached at
 * `<storeDir>/index.json` for fast UI listing without reading every record.
 */
export type SessionIndex = {
  schemaVersion: 1;
  updatedAt: number;
  entries: SessionIndexEntry[];
};

export type SessionIndexEntry = {
  sessionId: string;
  projectSlug: string;
  projectPath?: string;
  sessionLabel: string;
  analyzedAt: number;
  transcriptMtimeMs: number;
  topicCount: number;
  rootTitle?: string;
};

/**
 * A merge result — either deterministic stitch or LLM-refined.
 * Stored as a ready-to-render `MindMapRoot` so opening the merged view
 * never needs to re-merge.
 */
export type MergeRecord = {
  schemaVersion: 1;
  meta: MergeRecordMeta;
  mindMap: MindMapRoot;
};

export type MergeRecordMeta = {
  kind: "deterministic" | "llm-refined";
  /** Unix epoch ms when this merge was built. */
  builtAt: number;
  /** Session ids participating in this merge. */
  sessionIds: string[];
  /** Distinct project slugs covered. */
  projectSlugs: string[];
  /** LLM details — only set when `kind === "llm-refined"`. */
  llm?: { provider: string; model?: string };
  /** Human-readable title shown as the root node. */
  title?: string;
};

/**
 * Stable project mind-map projection for delta M-merge (one virtual session).
 * Lives at `<storeDir>/merges/<projectSlug>/merge-snapshot.json`.
 */
export type MergeSnapshot = {
  schemaVersion: 1;
  meta: MergeSnapshotMeta;
  treeSnapshot: SessionTreeSnapshot;
  sessionAnalysis: SessionAnalysis;
  conceptContexts: ConceptContextForMerge[];
  segmentEquivalences: SegmentEquivalence[];
  reattachSteps?: ReattachStep[];
  reattachMoves?: ReattachMove[];
  topicPaths: TopicConceptPathDecision[];
};

export type MergeSnapshotMeta = {
  builtAt: number;
  projectSlug: string;
  /** Real session ids covered by this snapshot (excludes virtual id). */
  sessionIds: string[];
  /** Hierarchy node id, e.g. `l1-0001`. */
  snapshotId?: string;
  /** 1 = leaf batch, 2+ = merged child snapshots. Root uses level 0. */
  level?: number;
  /** Child snapshot ids when level > 1. */
  childSnapshotIds?: string[];
  hostId?: AgentHostId;
  promptVersions: {
    sessionAnalysis: number;
    mergeSessionAnalysis: number;
    /** @deprecated legacy reattach-moves path */
    reattach?: number;
  };
};

/** Index for multi-level snapshot pyramid under `merges/<projectSlug>/`. */
export type SnapshotManifest = {
  schemaVersion: 2;
  projectSlug: string;
  /** Sessions per L1 batch and snapshots per promotion group. */
  groupSize: number;
  nodes: SnapshotNode[];
  /** Snapshot ids not yet absorbed into a parent. */
  topLevelIds: string[];
  /** Real session id → L1 snapshot id. */
  sessionToLeafId: Record<string, string>;
  rootSnapshotId?: string;
};

export type SnapshotNode = {
  id: string;
  level: number;
  childIds: string[];
  sessionIds: string[];
  builtAt: number;
  /** Relative to `merges/<projectSlug>/`, e.g. `snapshots/l1-0001.json`. */
  path: string;
};
