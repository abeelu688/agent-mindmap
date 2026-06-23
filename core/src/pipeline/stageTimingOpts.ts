import type { LlmStageTimingOut } from "../llm/llmStage";

/** Optional timing hooks passed from pipeline collectors into LLM stages. */
export type StageTimingOpts = {
  timingRunId?: string;
  timingOut?: LlmStageTimingOut;
};
