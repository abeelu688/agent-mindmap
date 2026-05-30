import type { LlmStageTimingOut } from "./llmStage";

/** Optional timing hooks passed from pipeline collectors into LLM stages. */
export type StageTimingOpts = {
  timingRunId?: string;
  timingOut?: LlmStageTimingOut;
};
