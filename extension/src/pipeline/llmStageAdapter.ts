/**
 * Extension adapter for runLlmStage — pre-binds the LlmDumpDeps
 * so extension callers don't need to pass it every time.
 */
import { runLlmStage as coreRunLlmStage, type LlmStageOptions } from "@agent-mindmap/core";
import { extensionLlmDumpDeps } from "../llm/llmIoDumpAdapter";
import type { LlmProvider, ProgressReporter } from "@agent-mindmap/core";

/**
 * Run an LLM stage with the extension's dump deps pre-bound.
 * This is the drop-in replacement for the old extension/src/pipeline/llmStage.ts.
 */
export function runLlmStage<T>(
  opts: LlmStageOptions<T>,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: ProgressReporter
): Promise<T> {
  return coreRunLlmStage(opts, provider, signal, progress, extensionLlmDumpDeps);
}

export { type LlmStageOptions, type LlmStageTimingOut } from "@agent-mindmap/core";
