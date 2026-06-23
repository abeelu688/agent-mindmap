/**
 * Extension adapter for refineSessionSynonyms — pre-binds the extension's
 * LlmDumpDeps so callers don't need to pass it every time.
 */
import {
  refineSessionSynonyms as coreRefineSessionSynonyms,
  type RefineSessionSynonymsOpts,
} from "@agent-mindmap/core";
import { extensionLlmDumpDeps } from "../../llm/llmIoDumpAdapter";
import type { LlmProvider, SessionSynonymRefine, ProgressReporter } from "@agent-mindmap/core";

export type { RefineSessionSynonymsOpts };

export async function refineSessionSynonyms(
  opts: RefineSessionSynonymsOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: ProgressReporter
): Promise<SessionSynonymRefine> {
  return coreRefineSessionSynonyms(opts, provider, signal, progress, extensionLlmDumpDeps);
}
