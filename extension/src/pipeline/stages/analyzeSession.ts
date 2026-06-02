import { runLlmStage } from "../llmStage";
import {
  buildSessionAnalysisPrompt,
  SESSION_ANALYSIS_PROMPT_VERSION,
  type SessionAnalysisPromptOptions,
} from "../../llm/promptSessionAnalysis";
import { validateSessionAnalysis } from "../../llm/pipelineValidate";
import type { LlmProvider, SessionAnalysis } from "../../llm/types";
import type { AgentHostId } from "../../host/types";
import type { ChatEvent } from "../../transcript/types";
import type { MindMapProgress } from "../../progress";
import type { StageTimingOpts } from "../stageTimingOpts";

export type AnalyzeSessionOpts = StageTimingOpts & {
  events: ChatEvent[];
  prompt: SessionAnalysisPromptOptions;
  modelHint?: string;
  cacheDir?: string;
  cache: boolean;
  hostId?: AgentHostId;
  sessionId?: string;
  projectSlug?: string;
};

export async function analyzeSession(
  opts: AnalyzeSessionOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<SessionAnalysis> {
  const prompt = buildSessionAnalysisPrompt(
    opts.events,
    opts.prompt,
    opts.hostId ?? "cursor"
  );
  return runLlmStage(
    {
      stageId: "session-analysis",
      promptVersion: SESSION_ANALYSIS_PROMPT_VERSION,
      events: opts.events,
      prompt,
      modelHint: opts.modelHint,
      cacheDir: opts.cacheDir,
      cache: opts.cache,
      hostId: opts.hostId,
      sessionId: opts.sessionId,
      projectSlug: opts.projectSlug,
      responseSchema: "session-analysis",
      maxTopics: opts.prompt.maxNodes,
      maxItemsPerTopic: opts.prompt.maxDetailsPerNode,
      heartbeatMessage: "Analyzing session (domain, terms, outline)…",
      validate: validateSessionAnalysis,
      timingRunId: opts.timingRunId,
      timingOut: opts.timingOut,
    },
    provider,
    signal,
    progress
  );
}
