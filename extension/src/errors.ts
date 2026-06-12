import { LlmProviderError, type LlmErrorCode } from "./llm/types";

// ─── Error codes ────────────────────────────────────────────────────────────

export type MindmapErrorCode =
  // --- LLM (mirrors LlmErrorCode for unified handling) ---
  | "llm:cli-missing"
  | "llm:cli-failed"
  | "llm:timeout"
  | "llm:cancelled"
  | "llm:bad-json"
  | "llm:bad-shape"
  | "llm:empty"
  // --- Store ---
  | "store:read-failed"
  | "store:write-failed"
  | "store:corrupt-record"
  // --- Transcript ---
  | "transcript:read-failed"
  | "transcript:parse-failed"
  | "transcript:empty"
  // --- Merge ---
  | "merge:failed"
  | "merge:ontology-failed"
  | "merge:reattach-failed"
  // --- Host ---
  | "host:unsupported"
  | "host:no-workspace"
  | "host:empty-transcripts";

// ─── Unified error class ────────────────────────────────────────────────────

/**
 * Base class for all Agent Mind Map business errors.
 * Carries a structured `code`, optional `context`, and an optional `cause`.
 */
export class AgentMindmapError extends Error {
  constructor(
    public readonly code: MindmapErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "AgentMindmapError";
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Map LlmErrorCode → MindmapErrorCode prefix. */
const LLM_CODE_MAP: Record<LlmErrorCode, MindmapErrorCode> = {
  "cli-missing": "llm:cli-missing",
  "cli-failed": "llm:cli-failed",
  timeout: "llm:timeout",
  cancelled: "llm:cancelled",
  "bad-json": "llm:bad-json",
  "bad-shape": "llm:bad-shape",
  empty: "llm:empty",
};

/** Convert any error to an AgentMindmapError. LlmProviderError is mapped; others are wrapped. */
export function toMindmapError(
  err: unknown,
  fallbackCode: MindmapErrorCode = "merge:failed"
): AgentMindmapError {
  if (err instanceof AgentMindmapError) {
    return err;
  }
  if (err instanceof LlmProviderError) {
    return new AgentMindmapError(
      LLM_CODE_MAP[err.code] ?? "llm:cli-failed",
      err.message,
      { cliCode: err.code },
      err
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return new AgentMindmapError(fallbackCode, message, undefined, err);
}

/** Whether the error is a structured, "expected" error that should be shown concisely. */
export function isUserFacingError(err: unknown): boolean {
  return err instanceof AgentMindmapError || err instanceof LlmProviderError;
}

/** Whether the error is retryable (timeout, CLI failure, bad JSON, bad shape). */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof AgentMindmapError) {
    return [
      "llm:timeout",
      "llm:cli-failed",
      "llm:bad-json",
      "llm:bad-shape",
      "store:write-failed",
    ].includes(err.code);
  }
  if (err instanceof LlmProviderError) {
    return (
      err.code === "timeout" ||
      err.code === "cli-failed" ||
      err.code === "bad-json" ||
      err.code === "bad-shape"
    );
  }
  return false;
}

/** Whether the error represents a user cancellation (should be silent). */
export function isCancellationError(err: unknown): boolean {
  if (err instanceof AgentMindmapError && err.code === "llm:cancelled") {
    return true;
  }
  if (err instanceof LlmProviderError && err.code === "cancelled") {
    return true;
  }
  return false;
}
