/**
 * Extension adapter for mergeSessionAnalysis — pre-binds the extension's
 * LlmDumpDeps so callers don't need to pass it every time.
 */
import {
  mergeSessionAnalysis as coreMergeSessionAnalysis,
  MERGE_SESSION_ANALYSIS_PROMPT_VERSION,
  type MergeSessionAnalysisOpts,
} from "@agent-mindmap/core";
import { extensionLlmDumpDeps } from "../../llm/llmIoDumpAdapter";
import type { LlmProvider, FinalizedSessionAnalysis, ProgressReporter } from "@agent-mindmap/core";

export type { MergeSessionAnalysisOpts };
export { MERGE_SESSION_ANALYSIS_PROMPT_VERSION };

export async function mergeSessionAnalysis(
  opts: MergeSessionAnalysisOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: ProgressReporter
): Promise<FinalizedSessionAnalysis | undefined> {
  return coreMergeSessionAnalysis(opts, provider, signal, progress, extensionLlmDumpDeps);
}
