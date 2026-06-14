import { countUserQueries } from "../llm/sanitizeTopicGraph";
import { analyzeSession } from "./stages/analyzeSession";
import { finalizeSessionAnalysis } from "./stages/finalizeSessionAnalysis";
import { currentPipelineVersions } from "./pipelineVersions";
import { createPipelineTimingCollector } from "./pipelineTiming";
import type { AgentHostId } from "../host/types";
import type { CodeReference, LlmProvider, SessionAnalysis } from "../llm/types";
import type { MindMapProgress } from "../progress";
import type { ChatEvent } from "../transcript/types";
import type {
  SessionConceptExtract,
  SessionOutline,
  SessionSynonymRefine,
  SessionTreeSnapshot,
} from "../llm/types";
import type { ConceptContextForMerge } from "../store/storeTypes";
import type { LlmStageTimingOut } from "./llmStage";
import type { OutputLanguage } from "../llm/promptLanguage";

export type SessionPipelinePromptOpts = {
  maxDomains: number;
  maxTerms: number;
  maxEvidencePerTerm: number;
  maxBranches: number;
  maxDetailsPerNode: number;
};

export type SessionPipelineOpts = {
  events: ChatEvent[];
  sessionId: string;
  projectSlug: string;
  projectPath?: string;
  prompt: SessionPipelinePromptOpts;
  modelHint?: string;
  cacheDir?: string;
  cache: boolean;
  hostId?: AgentHostId;
  storeDir?: string;
  skipTiming?: boolean;
  outputLanguage?: OutputLanguage;
  /** Skip LLM when full analysis already available (tests). */
  preloaded?: SessionAnalysis;
};

export type SessionPipelineResult = {
  sessionAnalysis: SessionAnalysis;
  conceptExtract: SessionConceptExtract;
  sessionSynonyms: SessionSynonymRefine;
  treeSnapshot: SessionTreeSnapshot;
  conceptContexts: ConceptContextForMerge[];
  outline: SessionOutline;
  pipelineVersions: ReturnType<typeof currentPipelineVersions>;
  /** Pending placeholder references written immediately; queue fills in real descriptions. */
  initialCodeReferences?: CodeReference[];
};

export async function runSessionPipeline(
  opts: SessionPipelineOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<SessionPipelineResult> {
  const timing = opts.skipTiming
    ? undefined
    : createPipelineTimingCollector(
        "session",
        { sessionId: opts.sessionId, projectSlug: opts.projectSlug },
        opts.storeDir
      );

  const runStage = async <T>(
    stage: string,
    fn: () => Promise<T>,
    metaFn?: () => Record<string, unknown>
  ): Promise<T> => {
    if (timing) {
      return timing.time(stage, fn, metaFn);
    }
    return fn();
  };

  let analysis = opts.preloaded;
  let initialCodeReferences: CodeReference[] | undefined;
  if (!analysis) {
    progress?.report("S1: Analyzing session (one-shot LLM)…");
    const s1Timing: LlmStageTimingOut = {};
    const s1Result = await runStage(
      "S1 analyze",
      () =>
        analyzeSession(
          {
            events: opts.events,
            prompt: {
              maxDomains: opts.prompt.maxDomains,
              maxNodes: opts.prompt.maxTerms,
              maxBranches: opts.prompt.maxBranches,
              maxDetailsPerNode: opts.prompt.maxDetailsPerNode,
            },
            modelHint: opts.modelHint,
            cacheDir: opts.cacheDir,
            cache: opts.cache,
            hostId: opts.hostId,
            sessionId: opts.sessionId,
            projectSlug: opts.projectSlug,
            projectPath: opts.projectPath,
            outputLanguage: opts.outputLanguage,
            timingRunId: timing?.runId,
            timingOut: s1Timing,
          },
          provider,
          signal,
          progress
        ),
      () => ({ kind: "llm", ...s1Timing })
    );
    analysis = s1Result.analysis;
    initialCodeReferences = s1Result.initialCodeReferences;
  } else {
    await runStage(
      "S1 analyze",
      async () => analysis!,
      () => ({
        kind: "llm",
        skipped: true,
      })
    );
  }

  progress?.report("S2: Finalizing tree and outline…");
  const userQueryCount = countUserQueries(opts.events);
  const finalized = await runStage(
    "S2 finalize",
    async () =>
      finalizeSessionAnalysis(analysis!, {
        sessionId: opts.sessionId,
        projectSlug: opts.projectSlug,
        userQueryCount,
      }),
    () => ({ kind: "det" })
  );

  await timing?.finish();

  return {
    sessionAnalysis: finalized.sessionAnalysis,
    conceptExtract: finalized.conceptExtract,
    sessionSynonyms: finalized.sessionSynonyms,
    treeSnapshot: finalized.treeSnapshot,
    conceptContexts: finalized.conceptContexts,
    outline: finalized.outline,
    pipelineVersions: currentPipelineVersions(),
    initialCodeReferences,
  };
}
