import { runLlmStage } from "../llmStage";
import {
  buildSessionAnalysisPrompt,
  SESSION_ANALYSIS_PROMPT_VERSION,
  type SessionAnalysisPromptOptions,
} from "../../llm/promptSessionAnalysis";
import { validateSessionAnalysis } from "../../llm/pipelineValidate";
import type { CodeReference, LlmProvider, SessionAnalysis } from "../../llm/types";
import type { AgentHostId } from "../../host/types";
import type { ChatEvent } from "../../transcript/types";
import type { MindMapProgress } from "../../progress";
import type { StageTimingOpts } from "../stageTimingOpts";
import { extractCodeReferencesFromEvents } from "../../llm/extractCodeReferences";

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
};

export type AnalyzeSessionResult = {
  analysis: SessionAnalysis;
  /** Background promise for codeReferences extraction (resolves when done). */
  codeRefsPromise: Promise<CodeReference[] | undefined>;
};

export async function analyzeSession(
  opts: AnalyzeSessionOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<AnalyzeSessionResult> {
  const prompt = buildSessionAnalysisPrompt(
    opts.events,
    opts.prompt,
    opts.hostId ?? "cursor",
    opts.projectPath
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
      validate: (v: unknown) =>
        validateSessionAnalysis(v, { requireCodeReferences: false }),
      timingRunId: opts.timingRunId,
      timingOut: opts.timingOut,
    },
    provider,
    signal,
    progress
  );

  // Fire codeReferences extraction in the background — caller awaits when needed
  const codeRefsPromise = analysis.codeReferences?.length
    ? Promise.resolve(analysis.codeReferences)
    : opts.events.length
      ? extractCodeReferencesFromEvents(
          opts.events,
          provider,
          signal,
          {
            projectPath: opts.projectPath,
            model: opts.modelHint,
            cacheDir: opts.cacheDir,
            cache: opts.cache,
          }
        ).catch(() => undefined)
      : Promise.resolve(undefined);

  return { analysis, codeRefsPromise };
}
