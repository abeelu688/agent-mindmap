/**
 * S1.5: Extract concept domains and terms from a single session transcript.
 *
 * Moved from extension/src/pipeline/stages/extractConcepts.ts in R2.2.
 * Uses ProgressReporter (core port) instead of MindMapProgress.
 * Accepts optional LlmDumpDeps for IO dump operations.
 */
import { runLlmStage } from "../../llm/llmStage";
import {
  buildSessionExtractPrompt,
  EXTRACT_PROMPT_VERSION,
  type SessionExtractPromptOptions,
} from "../../llm/promptSessionExtract";
import { validateSessionConceptExtract } from "../../llm/pipelineValidate";
import type { LlmProvider, SessionConceptExtract } from "../../llm/types";
import type { AgentHostId } from "../../host/types";
import type { ChatEvent } from "../../transcript/types";
import type { ProgressReporter } from "../../ports/ProgressReporter";
import type { StageTimingOpts } from "../stageTimingOpts";
import type { LlmDumpDeps } from "../../ports/LlmDumpDeps";

export type ExtractConceptsOpts = StageTimingOpts & {
  events: ChatEvent[];
  prompt: SessionExtractPromptOptions;
  modelHint?: string;
  cacheDir?: string;
  cache: boolean;
  hostId?: AgentHostId;
};

export async function extractConcepts(
  opts: ExtractConceptsOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: ProgressReporter,
  dumpDeps?: LlmDumpDeps
): Promise<SessionConceptExtract> {
  const prompt = buildSessionExtractPrompt(opts.events, opts.prompt, opts.hostId ?? "cursor");
  return runLlmStage(
    {
      stageId: "session-concept-extract",
      promptVersion: EXTRACT_PROMPT_VERSION,
      events: opts.events,
      prompt,
      modelHint: opts.modelHint,
      cacheDir: opts.cacheDir,
      cache: opts.cache,
      hostId: opts.hostId,
      responseSchema: "session-concept-extract",
      maxTopics: opts.prompt.maxTerms,
      maxItemsPerTopic: opts.prompt.maxEvidencePerTerm,
      heartbeatMessage: "Extracting domains and terms…",
      validate: validateSessionConceptExtract,
      timingRunId: opts.timingRunId,
      timingOut: opts.timingOut,
    },
    provider,
    signal,
    progress,
    dumpDeps
  );
}
