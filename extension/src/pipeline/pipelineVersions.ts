import { SESSION_ANALYSIS_PROMPT_VERSION } from "../llm/promptSessionAnalysis";
import type { PipelineVersions } from "../llm/types";

/** Aggregate pipeline version for library freshness. */
export const PIPELINE_VERSION = SESSION_ANALYSIS_PROMPT_VERSION;

export function currentPipelineVersions(): PipelineVersions {
  return {
    sessionAnalysis: SESSION_ANALYSIS_PROMPT_VERSION,
  };
}

export function pipelineVersionsMatch(
  record: PipelineVersions | undefined,
  current: PipelineVersions
): boolean {
  if (!record) {
    return false;
  }
  return record.sessionAnalysis === current.sessionAnalysis;
}
