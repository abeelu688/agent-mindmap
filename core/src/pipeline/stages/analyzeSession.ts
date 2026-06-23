import { runLlmStage } from "../../llm/llmStage";
import {
  buildSessionAnalysisPrompt,
  SESSION_ANALYSIS_PROMPT_VERSION,
  type SessionAnalysisPromptOptions,
} from "../../llm/barrel";
import { validateSessionAnalysis } from "../../llm/barrel";
import { buildPendingCodeReferencesFromEvents } from "../../llm/barrel";
import type { CodeReference, LlmProvider, SessionAnalysis } from "../../llm/barrel";
import type { AgentHostId } from "../../host/types";
import type { ChatEvent } from "../../transcript/types";
import type { ProgressReporter } from "../../ports/ProgressReporter";
import type { StageTimingOpts } from "../stageTimingOpts";
import type { OutputLanguage } from "../../llm/barrel";

export type AnalyzeSessionOpts = StageTimingOpts & {
  events: ChatEvent[];
  prompt: SessionAnalysisPromptOptions;
  modelHint?: string;
  cacheDir?: string;
  cache: boolean;
  hostId?: AgentHostId;
  sessionId?: string;
  projectSlug?: string;
  projectPath?: string;
  outputLanguage?: OutputLanguage;
};

export type AnalyzeSessionResult = {
  analysis: SessionAnalysis;
  /** Pending placeholder references written immediately; queue fills in real descriptions. */
  initialCodeReferences?: CodeReference[];
};

export async function analyzeSession(
  opts: AnalyzeSessionOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: ProgressReporter
): Promise<AnalyzeSessionResult> {
  const prompt = buildSessionAnalysisPrompt(
    opts.events,
    opts.prompt,
    opts.hostId ?? "cursor",
    opts.projectPath,
    opts.outputLanguage
  );
  const analysis = await runLlmStage(
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
      validate: (v: unknown) => validateSessionAnalysis(v, { requireCodeReferences: false }),
      timingRunId: opts.timingRunId,
      timingOut: opts.timingOut,
    },
    provider,
    signal,
    progress
  );

  const initialCodeReferences = analysis.codeReferences?.length
    ? analysis.codeReferences.map((ref) => ({
        ...ref,
        llmStatus: ref.llmStatus ?? ("done" as const),
        llmUpdatedAt: ref.llmUpdatedAt ?? Date.now(),
      }))
    : buildPendingCodeReferencesFromEvents(opts.events, opts.projectPath, analysis.outline);

  return { analysis, initialCodeReferences };
}
