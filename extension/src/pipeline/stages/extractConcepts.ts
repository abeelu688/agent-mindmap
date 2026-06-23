import { runLlmStage } from "../llmStage";
import {
  buildSessionExtractPrompt,
  EXTRACT_PROMPT_VERSION,
  type SessionExtractPromptOptions,
} from "@agent-mindmap/core";
import { validateSessionConceptExtract } from "@agent-mindmap/core";
import type { LlmProvider, SessionConceptExtract } from "@agent-mindmap/core";
import type { AgentHostId } from "@agent-mindmap/core";
import type { ChatEvent } from "@agent-mindmap/core";
import type { MindMapProgress } from "../../progress";
import type { StageTimingOpts } from "@agent-mindmap/core";

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
    progress
  );
}
