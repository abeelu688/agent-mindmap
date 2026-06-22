/**
 * Re-export LLM stage runner from the adapter (which pre-binds LlmDumpDeps).
 *
 * The core runLlmStage now requires a LlmDumpDeps parameter; the adapter
 * injects extensionLlmDumpDeps automatically.
 */
export { runLlmStage, type LlmStageOptions, type LlmStageTimingOut } from "./llmStageAdapter";
export { __testingLlmStage as __testing } from "@agent-mindmap/core";
