import type { AgentHostId } from "../host/types";
import type { SessionOutline, TopicGraph } from "../llm/types";
import type { MindMapRoot } from "../transcript/types";

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
   * Prompt schema version (see {@link PROMPT_VERSION}). Older records are
   * re-analysed on next open so newer fields (e.g. conceptPath) get filled.
   * Absent = pre-versioning (treated as v1).
   */
  promptVersion?: number;
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
