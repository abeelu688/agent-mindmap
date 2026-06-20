import type { AgentHostId, ConceptContextForMerge } from "@agent-mindmap/shared";
import type {
  ReattachMove,
  ReattachStep,
  SegmentEquivalence,
  SessionAnalysis,
  SessionTreeSnapshot,
} from "../llm/types";
import type { TopicConceptPathDecision } from "./ontologyTypes";

// SessionRecord, SessionRecordMeta, ConceptContextForMerge, MergeRecord, and
// the LLM payload types are canonical in `@agent-mindmap/shared`. Re-export
// them so existing extension imports (`from "./storeTypes"`) keep working.
export type {
  ConceptContextForMerge,
  MergeRecord,
  SessionRecord,
  SessionRecordMeta,
} from "@agent-mindmap/shared";

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

// Re-export the shared MindMapRoot so extension code that imports it from
// storeTypes keeps compiling.
export type { MindMapRoot } from "@agent-mindmap/shared";
