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
import { tryParseReattachChangesResponse } from "../../llm/reattachChanges";
import {
  DeltaReattachValidationError,
  validateDeltaReattachSteps,
} from "../../llm/validateDeltaReattachSteps";
import { appendReattachSteps } from "../../store/mergeSnapshot";
import { prepareRecordsBeforeReattach } from "./updateConceptTrie";
import type { MindMapProgress } from "../../progress";
import { createHeartbeat } from "../../progress";
import { scaleReattachTimeoutMs } from "../../llm/reattachTimeout";

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
  /** Base CLI timeout (ms); scaled up by chain count for reattach-moves. */
  llmTimeoutMs?: number;
};

export type MergeTrieReparentResult = {
  moves: ReattachMove[];
  steps: ReattachStep[];
};

async function runOneReattachLlmCallDetailed(
  slice: TrieReparentInput,
  opts: MergeTrieReparentOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  chunkMeta?: { chunkIndex: number; chunkCount: number }
): Promise<{ steps: ReattachStep[]; rawCount: number; resolved: number }> {
  const hostId = opts.hostId ?? opts.records[0]?.meta.hostId ?? "cursor";
  const mergeMode = opts.mergeMode ?? "full";
  const prompt = buildReattachPrompt(
    slice,
    hostId,
    opts.promptLanguage ?? "zh",
    mergeMode,
    chunkMeta
  );
  const timeoutMs =
    opts.llmTimeoutMs != null
      ? scaleReattachTimeoutMs(opts.llmTimeoutMs, slice.chains.length)
      : undefined;

  const res = await provider.summarize(
    {
      events: [],
      prompt,
      model: opts.model,
      maxTopics: 8,
      maxItemsPerTopic: 8,
      responseSchema: "reattach-moves",
      timeoutMs,
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
    ("steps" in res || "moves" in res || "changes" in res)
      ? (res as ReattachParseResult & { changes?: unknown })
      : tryParseReattachResponse(res);

  let steps: ReattachStep[];
  if (mergeMode === "delta") {
    const root =
      res && typeof res === "object"
        ? (res as Record<string, unknown>)
        : undefined;
    if (Array.isArray(root?.steps) && (root.steps as unknown[]).length > 0) {
      throw new DeltaReattachValidationError(
        "M-merge delta must return changes[] not steps[]",
        ["Use {\"changes\":[{\"kind\":\"attach\",...}]} for delta merge"]
      );
    }
    steps = tryParseReattachChangesResponse(res ?? parsed);
    validateDeltaReattachSteps(slice, steps);
  } else {
    const rawSteps = parsed.steps ?? [];
    steps = resolveReattachStepsWithCatalog(rawSteps, slice.nodeCatalog);
  }
  return {
    steps,
    rawCount:
      mergeMode === "delta"
        ? (Array.isArray(
            (res as Record<string, unknown> | undefined)?.changes
          )
            ? ((res as Record<string, unknown>).changes as unknown[]).length
            : steps.length)
        : (parsed.steps ?? []).length,
    resolved: steps.length,
  };
}

async function runOneReattachLlmCall(
  slice: TrieReparentInput,
  opts: MergeTrieReparentOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  chunkMeta?: { chunkIndex: number; chunkCount: number }
): Promise<ReattachStep[]> {
  const result = await runOneReattachLlmCallDetailed(
    slice,
    opts,
    provider,
    signal,
    chunkMeta
  );
  return result.steps;
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
  let lastError: string | undefined;
  let rawParsedCount = 0;
  let resolvedCount = 0;
  try {
    for (let i = 0; i < executions.length; i++) {
      const exec = executions[i]!;
      if (chunked) {
        progress?.report(
          `M-merge chunk ${i + 1}/${executions.length} (${exec.promptBytes}B)…`
        );
      }
      const { steps: chunkSteps, rawCount, resolved } = await runOneReattachLlmCallDetailed(
        exec.slice,
        opts,
        provider,
        signal,
        chunked ? { chunkIndex: i, chunkCount: executions.length } : undefined
      );
      rawParsedCount += rawCount;
      resolvedCount += resolved;
      collectedSteps = appendReattachSteps(collectedSteps, chunkSteps);
    }

    const steps = normalizeSynonymAttachSteps(
      collectedSteps,
      input.topBranchSynonymHints,
      input.segmentEquivalences,
      input.chains.map((c) => c.from)
    );
    if (mergeMode === "delta") {
      validateDeltaReattachSteps(input, steps);
    }
    const moves = steps.length > 0 ? reattachStepsToMoves(steps) : [];

    // #region agent log
    fetch("http://127.0.0.1:7901/ingest/4949e060-0582-4e25-a1f5-3c9b36f3b66d", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "0cd37d",
      },
      body: JSON.stringify({
        sessionId: "0cd37d",
        runId: "post-fix-v9",
        hypothesisId: "H6-H8",
        location: "mergeTrieReparent.ts:done",
        message: "M-merge LLM step resolution",
        data: {
          mergeMode: mergeMode ?? "full",
          chainCount: input.chains.length,
          chunkCount: executions.length,
          chunked,
          scaledTimeoutMs: opts.llmTimeoutMs
            ? scaleReattachTimeoutMs(opts.llmTimeoutMs, input.chains.length)
            : null,
          rawParsedCount,
          resolvedCount,
          normalizedStepCount: steps.length,
          lastError,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    return { steps, moves };
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    // #region agent log
    fetch("http://127.0.0.1:7901/ingest/4949e060-0582-4e25-a1f5-3c9b36f3b66d", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "0cd37d",
      },
      body: JSON.stringify({
        sessionId: "0cd37d",
        runId: "post-fix-v9",
        hypothesisId: "H6-H9",
        location: "mergeTrieReparent.ts:catch",
        message: "M-merge LLM failed",
        data: {
          mergeMode: mergeMode ?? "full",
          chainCount: input.chains.length,
          chunkCount: executions.length,
          error: lastError,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
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
