/**
 * M-merge LLM: produce one virtual combined session (same schema as Part I).
 *
 * Moved from extension/src/pipeline/stages/mergeSessionAnalysis.ts in R2.2.
 * Uses ProgressReporter (core port) instead of MindMapProgress.
 * Accepts optional LlmDumpDeps for IO dump operations.
 */
import { runLlmStage } from "../../llm/llmStage";
import { buildMergeSessionAnalysisInput } from "../../llm/mergeSessionAnalysisInput";
import {
  buildMergeSessionAnalysisPrompt,
  MERGE_SESSION_ANALYSIS_PROMPT_VERSION,
} from "../../llm/promptMergeSessionAnalysis";
import { validateSessionAnalysis } from "../../llm/pipelineValidate";
import { buildOutlineFromConceptTrie } from "../../store/mergeConceptTrie";
import { MERGE_SNAPSHOT_SESSION_ID, isMergeSnapshotSessionId } from "../../store/mergeSnapshot";
import { scaleMergeSessionAnalysisTimeoutMs } from "../../llm/reattachTimeout";
import { outputLanguageFromRecords } from "../../llm/outputLanguageFromRecords";
import { finalizeSessionAnalysis, type FinalizedSessionAnalysis } from "./finalizeSessionAnalysis";
import { prepareRecordsBeforeReattach } from "./updateConceptTrie";
import type { AgentHostId } from "../../host/types";
import type { LlmProvider } from "../../llm/types";
import type {
  ConceptOntologyMapping,
  ConceptOntologyNode,
  SegmentEquivalence,
  TopicPathDecision,
} from "@agent-mindmap/shared";
import type { ProgressReporter } from "../../ports/ProgressReporter";
import type { SessionRecord } from "@agent-mindmap/shared";
import type { MergeInputMode } from "../../llm/trieReparentInput";
import type { OutputLanguage } from "../../llm/promptLanguage";
import type { LlmDumpDeps } from "../../ports/LlmDumpDeps";

export type MergeSessionAnalysisOpts = {
  records: SessionRecord[];
  projectSlug?: string;
  model?: string;
  hostId?: AgentHostId;
  mergeMode?: MergeInputMode;
  snapshotSessionId?: string;
  ontologyNodes?: ConceptOntologyNode[];
  ontologyMappings?: ConceptOntologyMapping[];
  topicPaths?: TopicPathDecision[];
  segmentEquivalences?: SegmentEquivalence[];
  maxDomains?: number;
  maxNodes?: number;
  maxBranches?: number;
  maxDetailsPerNode?: number;
  cacheDir?: string;
  cache?: boolean;
  outputLanguage?: OutputLanguage;
  /** Base LLM timeout (ms); scaled by session count / prompt size when set. */
  llmTimeoutMs?: number;
};

const DEFAULT_PROMPT_OPTS = {
  maxDomains: 8,
  maxNodes: 64,
  maxBranches: 8,
  maxDetailsPerNode: 4,
};

/**
 * M-merge LLM: produce one virtual combined session (same schema as Part I).
 */
export async function mergeSessionAnalysis(
  opts: MergeSessionAnalysisOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: ProgressReporter,
  dumpDeps?: LlmDumpDeps
): Promise<FinalizedSessionAnalysis | undefined> {
  const mergeMode = opts.mergeMode ?? "full";
  const recordsForInput = prepareRecordsBeforeReattach(opts.records, {
    nodes: opts.ontologyNodes ?? [],
    mappings: opts.ontologyMappings ?? [],
    topicPaths: opts.topicPaths ?? [],
    segmentEquivalences: opts.segmentEquivalences,
  });

  const realCount = recordsForInput.filter(
    (r) => !isMergeSnapshotSessionId(r.meta.sessionId)
  ).length;
  if (recordsForInput.length < 2 && mergeMode !== "delta") {
    return undefined;
  }
  if (mergeMode === "delta" && realCount === 0) {
    return undefined;
  }

  const input = buildMergeSessionAnalysisInput(recordsForInput, mergeMode, opts.snapshotSessionId);
  const promptOpts = {
    maxDomains: opts.maxDomains ?? DEFAULT_PROMPT_OPTS.maxDomains,
    maxNodes: opts.maxNodes ?? DEFAULT_PROMPT_OPTS.maxNodes,
    maxBranches: opts.maxBranches ?? DEFAULT_PROMPT_OPTS.maxBranches,
    maxDetailsPerNode: opts.maxDetailsPerNode ?? DEFAULT_PROMPT_OPTS.maxDetailsPerNode,
  };
  const hostId = opts.hostId ?? opts.records[0]?.meta.hostId ?? "cursor";
  const outputLanguage = opts.outputLanguage ?? outputLanguageFromRecords(recordsForInput);
  const prompt = buildMergeSessionAnalysisPrompt(input, promptOpts, hostId, outputLanguage);
  const timeoutMs =
    opts.llmTimeoutMs != null
      ? scaleMergeSessionAnalysisTimeoutMs(opts.llmTimeoutMs, input.sessions.length, {
          promptBytes: prompt.length,
          mergeMode,
        })
      : undefined;

  const analysis = await runLlmStage(
    {
      stageId: "merge-session-analysis",
      promptVersion: MERGE_SESSION_ANALYSIS_PROMPT_VERSION,
      events: [],
      prompt,
      modelHint: opts.model,
      cacheDir: opts.cacheDir,
      cache: opts.cache ?? false,
      hostId,
      projectSlug: opts.projectSlug,
      responseSchema: "session-analysis",
      maxTopics: promptOpts.maxNodes,
      maxItemsPerTopic: promptOpts.maxDetailsPerNode,
      heartbeatMessage: "Merging sessions into virtual combined session…",
      validate: (v: unknown) => validateSessionAnalysis(v, { requireOutline: false }),
      timeoutMs,
    },
    provider,
    signal,
    progress,
    dumpDeps
  );

  // Build outline deterministically from concept trie (Route 1: no outline from LLM)
  if (!analysis.outline) {
    analysis.outline = buildOutlineFromConceptTrie(analysis.domains, analysis.nodes);
  }

  return finalizeSessionAnalysis(analysis, {
    sessionId: MERGE_SNAPSHOT_SESSION_ID,
    projectSlug: opts.projectSlug ?? opts.records[0]?.meta.projectSlug ?? "",
    userQueryCount: 0,
  });
}

export { MERGE_SESSION_ANALYSIS_PROMPT_VERSION };
