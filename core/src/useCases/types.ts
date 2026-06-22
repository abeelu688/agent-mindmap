/**
 * Shared types for core use case orchestrators.
 *
 * These types are used by `analyzeSession`, `analyzeProject`, and the
 * extension / CLI adapters that call them.
 */
import type { MindMapRoot, TranscriptSession, LlmErrorCode, LeafAction } from "../index";

// ────────────────────────────────────────────────────────────────────────────
// AnalysisHandle — the completed() pattern
// ────────────────────────────────────────────────────────────────────────────

/**
 * Handle returned by `analyzeSession` / `analyzeProject`.
 *
 * - `result` is available immediately after the foreground pipeline completes.
 * - `completed()` resolves when ALL background work (code-ref queue drain,
 *   deterministic/concept merge rebuild) finishes.
 *
 * The extension adapter ignores `completed()` (fire-and-forget) so the panel
 * stays open while the queue drains in the background. The CLI adapter awaits
 * `completed()` before returning so the persisted artifact is the post-drain
 * version.
 */
export interface AnalysisHandle<T> {
  /** Primary result available immediately after foreground work. */
  result: T;
  /** Resolves when ALL background work completes. */
  completed(): Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────
// LoadedSession — single-session analysis result
// ────────────────────────────────────────────────────────────────────────────

export type LoadedSession = {
  session: TranscriptSession & { hostId?: string; projectSlug?: string; projectPath?: string };
  mindMap: MindMapRoot;
  /** Which renderer produced `mindMap`. */
  source: "topic" | "turn";
  /** True when the topic graph came from the on-disk library (no LLM call). */
  fromLibrary?: boolean;
  /** Set when source is turn after an LLM failure. */
  llmErrorCode?: LlmErrorCode;
};

// ────────────────────────────────────────────────────────────────────────────
// LoadSessionOptions
// ────────────────────────────────────────────────────────────────────────────

export type LoadSessionOptions = {
  /** Force re-analysis even if the library has a fresh record. */
  forceRefresh?: boolean;
  /** Skip background deterministic/concept merge rebuild after writeRecord. */
  skipAutoMerge?: boolean;
  /** Suppress per-session LLM failure toasts (batch shows one summary). */
  quietLlmErrors?: boolean;
};

// ────────────────────────────────────────────────────────────────────────────
// AnalyzeProjectResult
// ────────────────────────────────────────────────────────────────────────────

export type AnalyzeProjectResult = {
  projectSlug: string;
  total: number;
  analyzed: number;
  skippedFresh: number;
  /** Sessions that fell back to chronological turn view (no library write). */
  turnFallbacks: number;
  /** Turn fallbacks caused by missing CLI binary. */
  cliMissingCount: number;
  /** Turn fallbacks caused by unparseable LLM JSON. */
  jsonParseFailures: number;
  failed: number;
  failures: { sessionId: string; label: string; message: string }[];
};

// ────────────────────────────────────────────────────────────────────────────
// AnalyzeProjectBatchInfo
// ────────────────────────────────────────────────────────────────────────────

export type AnalyzeProjectBatchInfo = AnalyzeProjectResult & {
  /** 1-based batch number. */
  batchNo: number;
  /** Number of sessions processed so far (analyzed + failed). */
  processed: number;
  /** Session ids processed in this batch (success or failure). */
  batchSessionIds: string[];
  /**
   * Subset of `batchSessionIds` that were actually re-analyzed by the LLM in
   * this batch (i.e. NOT a library cache hit). When empty, the batch is a
   * pure cache hit and the caller can skip merge work entirely.
   */
  freshlyAnalyzedSessionIds: string[];
  /**
   * Snapshot hierarchy leaf id this batch maps to (e.g. "l1-0003").
   * Undefined when not using stable partition (legacy mode).
   */
  leafId?: string;
  /**
   * What to do with this leaf after batch analysis:
   * - "reuse": leaf is stable on disk, no merge needed
   * - "rebuild": leaf needs rebuilding (orphaned or appended sessions)
   * - "new": brand-new leaf to create
   * Undefined when not using stable partition (legacy mode).
   */
  leafAction?: LeafAction;
};

// ────────────────────────────────────────────────────────────────────────────
// AnalyzeProjectOptions
// ────────────────────────────────────────────────────────────────────────────

export type AnalyzeProjectOptions = {
  forceRefresh?: boolean;
  /** Default true for batch analyze. */
  skipAutoMerge?: boolean;
  batchSize?: number;
  onBatchDone?: (info: AnalyzeProjectBatchInfo) => Promise<void> | void;
  /**
   * Existing snapshot manifest for stable partition. When provided (and not
   * force-refresh), `runProjectSessionBatches` uses stable batch partition
   * to avoid re-merging unchanged leaves.
   */
  snapshotManifest?: import("../store/storeTypes").SnapshotManifest;
};
