/** Max per settings `agentMindmap.llm.timeoutMs`. */
export const REATTACH_TIMEOUT_CAP_MS = 600_000;

/** Chains per base timeout slot before scaling up (11 chains → 2× base). */
export const REATTACH_TIMEOUT_CHAINS_PER_SLOT = 6;

/** Scale M-merge CLI timeout by draft chain count (full reconcile batch 1 often needs >90s). */
export function scaleReattachTimeoutMs(
  baseTimeoutMs: number,
  chainCount: number
): number {
  const base = Math.max(1000, baseTimeoutMs);
  const slots = Math.max(1, Math.ceil(chainCount / REATTACH_TIMEOUT_CHAINS_PER_SLOT));
  return Math.min(REATTACH_TIMEOUT_CAP_MS, base * slots);
}

/** Sessions per base timeout slot for virtual-session M-merge. */
export const MERGE_SESSION_TIMEOUT_SESSIONS_PER_SLOT = 3;

/** Prompt size (bytes) above which an extra timeout slot is added. */
export const MERGE_SESSION_TIMEOUT_PROMPT_SLOT_BYTES = 80_000;

/** Scale M-merge session-analysis timeout by input size (delta snapshot+batch needs more). */
export function scaleMergeSessionAnalysisTimeoutMs(
  baseTimeoutMs: number,
  sessionCount: number,
  opts?: { promptBytes?: number; mergeMode?: "full" | "delta" }
): number {
  const base = Math.max(1000, baseTimeoutMs);
  let slots = Math.max(
    1,
    Math.ceil(sessionCount / MERGE_SESSION_TIMEOUT_SESSIONS_PER_SLOT)
  );
  if (opts?.mergeMode === "delta") {
    slots += 1;
  }
  const bytes = opts?.promptBytes ?? 0;
  if (bytes > MERGE_SESSION_TIMEOUT_PROMPT_SLOT_BYTES) {
    slots += 1;
  }
  if (bytes > MERGE_SESSION_TIMEOUT_PROMPT_SLOT_BYTES * 2) {
    slots += 1;
  }
  return Math.min(REATTACH_TIMEOUT_CAP_MS, base * slots);
}
