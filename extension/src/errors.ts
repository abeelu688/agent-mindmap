/**
 * Re-export errors from @agent-mindmap/core.
 * The error types and helpers were moved to core in P1.10 so the code-ref
 * queue can use them without importing the extension.
 */
export {
  AgentMindmapError,
  isRetryableError,
  isCancellationError,
  isUserFacingError,
  toMindmapError,
  type MindmapErrorCode,
} from "@agent-mindmap/core";
