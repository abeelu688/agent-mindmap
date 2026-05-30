import { runLlmStage } from "../llmStage";
import {
  buildSessionSynonymsPrompt,
  SESSION_SYNONYM_PROMPT_VERSION,
} from "../../llm/promptSessionSynonyms";
import { validateSessionSynonymRefine } from "../../llm/pipelineValidate";
import type {
  LlmProvider,
  SessionConceptExtract,
  SessionSynonymRefine,
} from "../../llm/types";
import type { AgentHostId } from "../../host/types";
import type { ChatEvent } from "../../transcript/types";
import type { MindMapProgress } from "../../progress";
import type { StageTimingOpts } from "../stageTimingOpts";

export type RefineSessionSynonymsOpts = StageTimingOpts & {
  events: ChatEvent[];
  extract: SessionConceptExtract;
  modelHint?: string;
  cacheDir?: string;
  cache: boolean;
  hostId?: AgentHostId;
};

export async function refineSessionSynonyms(
  opts: RefineSessionSynonymsOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<SessionSynonymRefine> {
  const prompt = buildSessionSynonymsPrompt(
    opts.extract,
    opts.hostId ?? "cursor"
  );
  return runLlmStage(
    {
      stageId: "session-synonym-refine",
      promptVersion: SESSION_SYNONYM_PROMPT_VERSION,
      events: opts.events,
      prompt,
      modelHint: opts.modelHint,
      cacheDir: opts.cacheDir,
      cache: opts.cache,
      hostId: opts.hostId,
      responseSchema: "session-synonym-refine",
      maxTopics: 8,
      maxItemsPerTopic: 8,
      heartbeatMessage: "Refining session synonyms…",
      validate: validateSessionSynonymRefine,
      timingRunId: opts.timingRunId,
      timingOut: opts.timingOut,
    },
    provider,
    signal,
    progress
  );
}
