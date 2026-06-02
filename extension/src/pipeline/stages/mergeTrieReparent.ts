import type { AgentHostId } from "../../host/types";
import { resolveReattachStepsWithCatalog } from "../../llm/reattachNodeCatalog";
import { tryParseReattachResponse } from "../../llm/ontologyValidate";
import {
  normalizeSynonymAttachSteps,
  reattachStepsToMoves,
} from "../../llm/reattachSteps";
import { dumpLlmReplay } from "../../llm/llmIoDump";
import {
  buildReattachPrompt,
  REATTACH_PROMPT_VERSION,
} from "../../llm/promptReattach";
import { buildReattachChunkExecutions } from "../../llm/reattachChunking";
import {
  buildTrieReparentInput,
  type MergeInputMode,
  type TrieReparentInput,
} from "../../llm/trieReparentInput";
import type {
  ConceptOntologyMapping,
  ConceptOntologyNode,
  LlmProvider,
  ReattachMove,
  ReattachParseResult,
  ReattachStep,
  SegmentEquivalence,
  TopicPathDecision,
} from "../../llm/types";
import { appendReattachSteps } from "../../store/mergeSnapshot";
import { prepareRecordsBeforeReattach } from "./updateConceptTrie";
import type { MindMapProgress } from "../../progress";
import { createHeartbeat } from "../../progress";
import type { SessionRecord } from "../../store/storeTypes";

export type MergeTrieReparentOpts = {
  records: SessionRecord[];
  segmentEquivalences: SegmentEquivalence[];
  ontologyNodes?: ConceptOntologyNode[];
  topicPaths?: TopicPathDecision[];
  ontologyMappings?: ConceptOntologyMapping[];
  projectSlug?: string;
  model?: string;
  hostId?: AgentHostId;
  promptLanguage?: "zh" | "en";
  mergeMode?: MergeInputMode;
  snapshotSessionId?: string;
};

export type MergeTrieReparentResult = {
  moves: ReattachMove[];
  steps: ReattachStep[];
};

async function runOneReattachLlmCall(
  slice: TrieReparentInput,
  opts: MergeTrieReparentOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  chunkMeta?: { chunkIndex: number; chunkCount: number }
): Promise<ReattachStep[]> {
  const hostId = opts.hostId ?? opts.records[0]?.meta.hostId ?? "cursor";
  const mergeMode = opts.mergeMode ?? "full";
  const prompt = buildReattachPrompt(
    slice,
    hostId,
    opts.promptLanguage ?? "zh",
    mergeMode,
    chunkMeta
  );

  const res = await provider.summarize(
    {
      events: [],
      prompt,
      model: opts.model,
      maxTopics: 8,
      maxItemsPerTopic: 8,
      responseSchema: "reattach-moves",
      dumpMeta: {
        stageId: "reattach-moves",
        projectSlug: opts.projectSlug,
        chunkIndex: chunkMeta?.chunkIndex,
        chunkCount: chunkMeta?.chunkCount,
      },
    },
    signal
  );
  const parsed: ReattachParseResult =
    res &&
    typeof res === "object" &&
    ("steps" in res || "moves" in res)
      ? (res as ReattachParseResult)
      : tryParseReattachResponse(res);
  return resolveReattachStepsWithCatalog(parsed.steps, slice.nodeCatalog);
}

/**
 * M2.5 LLM: one or more chunked calls with all chains; returns ordered steps + derived moves.
 */
export async function mergeTrieReparent(
  opts: MergeTrieReparentOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<MergeTrieReparentResult> {
  const recordsForInput = prepareRecordsBeforeReattach(opts.records, {
    nodes: opts.ontologyNodes ?? [],
    mappings: opts.ontologyMappings ?? [],
    topicPaths: opts.topicPaths ?? [],
    segmentEquivalences: opts.segmentEquivalences,
  });

  const input = buildTrieReparentInput(recordsForInput, {
    segmentEquivalences: opts.segmentEquivalences,
    ontologyNodes: opts.ontologyNodes,
    topicPaths: opts.topicPaths,
    projectSlug: opts.projectSlug,
    mergeMode: opts.mergeMode,
    snapshotSessionId: opts.snapshotSessionId,
  });

  const hostId = opts.hostId ?? opts.records[0]?.meta.hostId ?? "cursor";
  const promptLanguage = opts.promptLanguage ?? "zh";
  const mergeMode = opts.mergeMode ?? "full";

  if (input.chains.length < 2) {
    void dumpLlmReplay({
      stageId: "reattach-moves",
      responseSchema: "reattach-moves",
      providerId: provider.id,
      model: opts.model,
      prompt: buildReattachPrompt(input, hostId, promptLanguage, mergeMode),
      parsed: { moves: [], steps: [] },
      source: "skipped",
      skipReason: "chains<2",
      projectSlug: opts.projectSlug,
    });
    return { moves: [], steps: [] };
  }

  const executions = buildReattachChunkExecutions(
    input,
    hostId,
    promptLanguage,
    mergeMode
  );
  const chunked = executions.length > 1;

  const heartbeat = createHeartbeat(
    progress,
    chunked
      ? `Merging concept mind maps (${executions.length} chunks)…`
      : "Merging concept mind maps (fold + reattach)…"
  );

  let collectedSteps: ReattachStep[] = [];
  try {
    for (let i = 0; i < executions.length; i++) {
      const exec = executions[i]!;
      if (chunked) {
        progress?.report(
          `M-merge chunk ${i + 1}/${executions.length} (${exec.promptBytes}B)…`
        );
      }
      const chunkSteps = await runOneReattachLlmCall(
        exec.slice,
        opts,
        provider,
        signal,
        chunked ? { chunkIndex: i, chunkCount: executions.length } : undefined
      );
      collectedSteps = appendReattachSteps(collectedSteps, chunkSteps);
    }

    const steps = normalizeSynonymAttachSteps(
      collectedSteps,
      input.topBranchSynonymHints,
      input.segmentEquivalences,
      input.chains.map((c) => c.from)
    );
    const moves = steps.length > 0 ? reattachStepsToMoves(steps) : [];

    return { steps, moves };
  } catch {
    return { moves: [], steps: [] };
  } finally {
    heartbeat.stop();
  }
}

/** @deprecated Use MergeTrieReparentResult */
export async function mergeTrieReparentMovesOnly(
  opts: MergeTrieReparentOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<ReattachMove[]> {
  const result = await mergeTrieReparent(opts, provider, signal, progress);
  return result.moves;
}

export { REATTACH_PROMPT_VERSION };
