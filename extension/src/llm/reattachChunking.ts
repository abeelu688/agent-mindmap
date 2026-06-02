import { buildReattachPrompt } from "./promptReattach";
import {
  buildRootChildSynonymHints,
  buildTopBranchSynonymHints,
  type MergeInputMode,
  type ReparentChain,
  type TrieReparentInput,
} from "./trieReparentInput";
import {
  buildReattachNodeCatalog,
} from "./reattachNodeCatalog";
import {
  buildStructuralReattachHints,
  enrichStructuralHintsWithNodeIds,
} from "./reattachStructuralHints";
import { segmentKeyForMerge } from "./topicGraphValidate";
import type { AgentHostId } from "../host/types";
import type { PromptLanguage } from "./promptLanguage";

/** Stay under headlessCli MAX_PROMPT_BYTES (96 KiB) argv cap. */
export const REATTACH_PROMPT_TARGET_BYTES = 90 * 1024;

export type ReattachChunkPlan = {
  /** 0-based indices into the full `input.chains`. */
  chainIndices: number[];
};

function sessionIdsInChains(chains: ReparentChain[]): Set<string> {
  const ids = new Set<string>();
  for (const c of chains) {
    for (const id of c.sessionIds) {
      ids.add(id);
    }
  }
  return ids;
}

function reindexChains(chains: ReparentChain[]): ReparentChain[] {
  return chains.map((c, i) => ({ ...c, chainIndex: i + 1 }));
}

function frozenCountInIndices(
  input: TrieReparentInput,
  chainIndices: number[]
): number | undefined {
  if (input.mergeMode !== "delta" || !input.frozenChainIndices?.length) {
    return undefined;
  }
  const frozen = new Set(input.frozenChainIndices);
  return chainIndices.filter((i) => frozen.has(i)).length;
}

function frozenIndicesFromInput(input: TrieReparentInput): number[] {
  return input.frozenChainIndices ?? [];
}

function newChainIndices(input: TrieReparentInput): number[] {
  const frozen = new Set(frozenIndicesFromInput(input));
  return input.chains.map((_, i) => i).filter((i) => !frozen.has(i));
}

function buildSliceInput(
  input: TrieReparentInput,
  chainIndices: number[]
): TrieReparentInput {
  const selected = reindexChains(chainIndices.map((i) => input.chains[i]));
  const nodeCatalog = buildReattachNodeCatalog(selected);
  const rootNodeIdByFrom = new Map(
    nodeCatalog.numberedChains.map(
      (c) => [segmentKeyForMerge(c.from), c.rootNodeId] as const
    )
  );
  const sessionIds = sessionIdsInChains(selected);
  const conceptContexts = input.conceptContexts.filter((c) =>
    sessionIds.has(c.sessionId)
  );

  return {
    ...input,
    frozenChainCount: frozenCountInIndices(input, chainIndices),
    conceptContexts,
    chains: selected,
    topBranches: selected,
    nodeCatalog,
    rootChildSynonymHints: buildRootChildSynonymHints(
      selected,
      input.segmentEquivalences
    ),
    topBranchSynonymHints: buildTopBranchSynonymHints(
      selected,
      input.segmentEquivalences
    ),
    structuralHints: enrichStructuralHintsWithNodeIds(
      buildStructuralReattachHints(
        selected,
        undefined,
        input.segmentEquivalences,
        undefined
      ),
      rootNodeIdByFrom
    ),
  };
}

export function estimateReattachPromptBytes(
  input: TrieReparentInput,
  hostId: AgentHostId = "cursor",
  promptLanguage?: PromptLanguage,
  mergeMode: MergeInputMode = input.mergeMode ?? "full",
  chunkIndex?: number,
  chunkCount?: number
): number {
  const prompt = buildReattachPrompt(
    input,
    hostId,
    promptLanguage,
    mergeMode,
    chunkIndex != null && chunkCount != null && chunkCount > 1
      ? { chunkIndex, chunkCount }
      : undefined
  );
  return Buffer.byteLength(prompt, "utf8");
}

function fitsPromptBudget(
  input: TrieReparentInput,
  chainIndices: number[],
  hostId: AgentHostId,
  promptLanguage: PromptLanguage | undefined,
  mergeMode: MergeInputMode
): boolean {
  const slice = buildSliceInput(input, chainIndices);
  return (
    estimateReattachPromptBytes(
      slice,
      hostId,
      promptLanguage,
      mergeMode
    ) <= REATTACH_PROMPT_TARGET_BYTES
  );
}

/**
 * Split parallel chains into prompt-sized chunks.
 * Delta: always include frozen (snapshot) chains + batches of new chains.
 * Full: partition all chains into disjoint groups.
 */
export function planReattachChunks(
  input: TrieReparentInput,
  hostId: AgentHostId = "cursor",
  promptLanguage?: PromptLanguage,
  mergeMode: MergeInputMode = input.mergeMode ?? "full"
): ReattachChunkPlan[] {
  const n = input.chains.length;
  if (n < 2) {
    return [{ chainIndices: n ? [0] : [] }];
  }

  const fullIndices = Array.from({ length: n }, (_, i) => i);
  if (
    fitsPromptBudget(input, fullIndices, hostId, promptLanguage, mergeMode)
  ) {
    return [{ chainIndices: fullIndices }];
  }

  const frozenIdx = frozenIndicesFromInput(input);
  const newIdx = newChainIndices(input);

  if (frozenIdx.length > 0 && newIdx.length > 0) {
    let batchSize = newIdx.length;
    while (batchSize >= 1) {
      const plans: ReattachChunkPlan[] = [];
      for (let i = 0; i < newIdx.length; i += batchSize) {
        plans.push({
          chainIndices: [...frozenIdx, ...newIdx.slice(i, i + batchSize)],
        });
      }
      if (
        plans.every((p) =>
          fitsPromptBudget(
            input,
            p.chainIndices,
            hostId,
            promptLanguage,
            mergeMode
          )
        )
      ) {
        return plans;
      }
      batchSize = Math.max(1, Math.ceil(batchSize / 2));
    }
  }

  let chunkSize = Math.max(2, Math.ceil(n / 2));
  while (chunkSize >= 2) {
    const plans: ReattachChunkPlan[] = [];
    for (let i = 0; i < n; i += chunkSize) {
      plans.push({
        chainIndices: Array.from(
          { length: Math.min(chunkSize, n - i) },
          (_, j) => i + j
        ),
      });
    }
    if (
      plans.every((p) =>
        fitsPromptBudget(
          input,
          p.chainIndices,
          hostId,
          promptLanguage,
          mergeMode
        )
      )
    ) {
      return plans;
    }
    chunkSize = Math.max(2, Math.ceil(chunkSize / 2));
  }

  return [{ chainIndices: fullIndices }];
}

export function sliceTrieReparentInput(
  input: TrieReparentInput,
  chainIndices: number[]
): TrieReparentInput {
  return buildSliceInput(input, chainIndices);
}

export type ReattachChunkExecution = {
  plan: ReattachChunkPlan;
  slice: TrieReparentInput;
  promptBytes: number;
};

export function buildReattachChunkExecutions(
  input: TrieReparentInput,
  hostId: AgentHostId = "cursor",
  promptLanguage?: PromptLanguage,
  mergeMode: MergeInputMode = input.mergeMode ?? "full"
): ReattachChunkExecution[] {
  const plans = planReattachChunks(input, hostId, promptLanguage, mergeMode);
  return plans.map((plan, chunkIndex) => {
    const slice = sliceTrieReparentInput(input, plan.chainIndices);
    const promptBytes = estimateReattachPromptBytes(
      slice,
      hostId,
      promptLanguage,
      mergeMode,
      chunkIndex,
      plans.length
    );
    return { plan, slice, promptBytes };
  });
}
