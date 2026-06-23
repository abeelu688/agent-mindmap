/**
 * Extension adapter for extractConcepts — pre-binds the extension's
 * LlmDumpDeps so callers don't need to pass it every time.
 */
import {
  extractConcepts as coreExtractConcepts,
  type ExtractConceptsOpts,
} from "@agent-mindmap/core";
import { extensionLlmDumpDeps } from "../../llm/llmIoDumpAdapter";
import type { LlmProvider, SessionConceptExtract, ProgressReporter } from "@agent-mindmap/core";

export type { ExtractConceptsOpts };

export async function extractConcepts(
  opts: ExtractConceptsOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: ProgressReporter
): Promise<SessionConceptExtract> {
  return coreExtractConcepts(opts, provider, signal, progress, extensionLlmDumpDeps);
}
