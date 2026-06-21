/**
 * Extension-local re-export of LLM error types from @agent-mindmap/shared.
 *
 * Policy: extension code should import from this wrapper rather than directly
 * from @agent-mindmap/shared, so that the extension's API boundary is explicit.
 * If shared's error types change, only this file needs updating.
 */
export { LlmProviderError, type LlmErrorCode } from "@agent-mindmap/shared";
