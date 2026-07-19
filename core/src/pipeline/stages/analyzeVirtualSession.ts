/**
 * Virtual session analysis stage.
 *
 * Mirrors {@link analyzeSession} but uses {@link buildVirtualSessionAnalysisPrompt}
 * with a context primer so the LLM can keep concept paths consistent with the
 * frozen prior analysis. The output schema is identical to `session-analysis`;
 * the only differences are:
 *
 * - Prompt includes prior topics / concept paths / code refs as context.
 * - `responseSchema: "virtual-session-analysis"` (separate case in
 *   `parseBySchema` so dump logs distinguish the two call types).
 * - `sourceTurnIndices` in the resulting outline are remapped by
 *   `startTurnIndex` so they point to the correct turn in the parent
 *   transcript (the LLM sees new turns starting from [Q1] = index 0).
 *
 * See `plans/virtual-session-incremental-analysis.md` (Phase 2 / O4).
 */
import { runLlmStage } from "../../llm/llmStage";
import {
  buildVirtualSessionAnalysisPrompt,
  VIRTUAL_SESSION_ANALYSIS_PROMPT_VERSION,
  validateSessionAnalysis,
  buildPendingCodeReferencesFromEvents,
  type SessionAnalysisPromptOptions,
  type VirtualSessionContextPrimer,
  type CodeReference,
  type LlmProvider,
  type SessionAnalysis,
  type AgentHostId,
  type OutputLanguage,
} from "../../llm/barrel";
import { remapOutlineTurnIndices } from "./analyzeSessionChunked";
import type { ChatEvent } from "../../transcript/types";
import type { ProgressReporter } from "../../ports/ProgressReporter";
import type { StageTimingOpts } from "../stageTimingOpts";

export type AnalyzeVirtualSessionOpts = StageTimingOpts & {
  events: ChatEvent[];
  prompt: SessionAnalysisPromptOptions;
  contextPrimer: VirtualSessionContextPrimer;
  /** 0-based turn index in the parent transcript where this virtual session starts. */
  startTurnIndex: number;
  modelHint?: string;
  cacheDir?: string;
  cache: boolean;
  hostId?: AgentHostId;
  sessionId?: string;
  projectSlug?: string;
  projectPath?: string;
  outputLanguage?: OutputLanguage;
};

export type AnalyzeVirtualSessionResult = {
  analysis: SessionAnalysis;
  /** Pending placeholder references written immediately; queue fills in real descriptions. */
  initialCodeReferences?: CodeReference[];
};

export async function analyzeVirtualSession(
  opts: AnalyzeVirtualSessionOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: ProgressReporter
): Promise<AnalyzeVirtualSessionResult> {
  const prompt = buildVirtualSessionAnalysisPrompt(
    opts.events,
    opts.prompt,
    opts.contextPrimer,
    opts.hostId ?? "cursor",
    opts.projectPath,
    opts.outputLanguage
  );
  const analysis = await runLlmStage(
    {
      stageId: "virtual-session-analysis",
      promptVersion: VIRTUAL_SESSION_ANALYSIS_PROMPT_VERSION,
      events: opts.events,
      prompt,
      modelHint: opts.modelHint,
      cacheDir: opts.cacheDir,
      cache: opts.cache,
      hostId: opts.hostId,
      sessionId: opts.sessionId,
      projectSlug: opts.projectSlug,
      responseSchema: "virtual-session-analysis",
      maxTopics: opts.prompt.maxNodes,
      maxItemsPerTopic: opts.prompt.maxDetailsPerNode,
      heartbeatMessage: "Analyzing virtual session (delta turns)…",
      validate: (v: unknown) => validateSessionAnalysis(v, { requireCodeReferences: false }),
      timingRunId: opts.timingRunId,
      timingOut: opts.timingOut,
    },
    provider,
    signal,
    progress
  );

  // The LLM saw new turns starting from [Q1] (index 0). Remap sourceTurnIndices
  // so they point to the correct turn in the parent transcript.
  if (analysis.outline && opts.startTurnIndex > 0) {
    analysis.outline = remapOutlineTurnIndices(analysis.outline, opts.startTurnIndex);
  }

  const initialCodeReferences = analysis.codeReferences?.length
    ? analysis.codeReferences.map((ref) => ({
        ...ref,
        llmStatus: ref.llmStatus ?? ("done" as const),
        llmUpdatedAt: ref.llmUpdatedAt ?? Date.now(),
      }))
    : buildPendingCodeReferencesFromEvents(opts.events, opts.projectPath, analysis.outline);

  return { analysis, initialCodeReferences };
}
