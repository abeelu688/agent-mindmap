import { runLlmStage } from "../llmStage";
import {
  buildSessionExtractPrompt,
  EXTRACT_PROMPT_VERSION,
  type SessionExtractPromptOptions,
} from "../../llm/promptSessionExtract";
import { validateSessionConceptExtract } from "../../llm/pipelineValidate";
import type { LlmProvider, SessionConceptExtract } from "../../llm/types";
import type { AgentHostId } from "../../host/types";
import type { ChatEvent } from "../../transcript/types";
import type { MindMapProgress } from "../../progress";
import type { StageTimingOpts } from "../stageTimingOpts";

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
  progress?: MindMapProgress
): Promise<SessionConceptExtract> {
  const prompt = buildSessionExtractPrompt(
    opts.events,
    opts.prompt,
    opts.hostId ?? "cursor"
  );
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
    progress
  );
}
