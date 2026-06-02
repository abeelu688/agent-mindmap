import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimateReattachPromptBytes,
  planReattachChunks,
  REATTACH_PROMPT_TARGET_BYTES,
} from "../extension/src/llm/reattachChunking";
import type {
  ReparentChain,
  TrieReparentInput,
} from "../extension/src/llm/trieReparentInput";
import { buildReattachNodeCatalog } from "../extension/src/llm/reattachNodeCatalog";

function makeChain(
  chainIndex: number,
  from: string,
  sessionIds: string[]
): ReparentChain {
  return {
    chainIndex,
    from,
    label: from,
    topicCount: 1,
    sessionIds,
    childSegments: [],
    pathSamples: [[from]],
    keywords: [`kw-${from}`],
    subtree: {
      segment: from,
      label: from,
      topicCount: 1,
      childSegments: [],
      children: [],
    },
  };
}

function makeInput(
  chains: ReparentChain[],
  opts: { mergeMode?: "delta" | "full"; snapshotSessionId?: string } = {}
): TrieReparentInput {
  const frozenChainIndices =
    opts.mergeMode === "delta" && opts.snapshotSessionId
      ? chains
          .map((c, i) =>
            c.sessionIds.every((id) => id === opts.snapshotSessionId) ? i : -1
          )
          .filter((i) => i >= 0)
      : [];
  const nodeCatalog = buildReattachNodeCatalog(chains);
  return {
    mergeMode: opts.mergeMode,
    snapshotSessionId: opts.snapshotSessionId,
    frozenChainCount: frozenChainIndices.length,
    frozenChainIndices,
    conceptContexts: [],
    chains,
    topBranches: chains,
    segmentEquivalences: [],
    rootChildSynonymHints: [],
    topBranchSynonymHints: [],
    structuralHints: {
      duplicateTopRoots: [],
      listedChildCollapses: [],
      ontologySubordinates: [],
      prefixSubordinates: [],
    },
    nodeCatalog,
    nodes: [],
  };
}

describe("reattachChunking", () => {
  it("returns single chunk when prompt fits budget", () => {
    const chains = [
      makeChain(1, "a", ["s1"]),
      makeChain(2, "b", ["s2"]),
    ];
    const input = makeInput(chains);
    const plans = planReattachChunks(input);
    assert.equal(plans.length, 1);
    assert.deepEqual(plans[0]!.chainIndices, [0, 1]);
  });

  it("delta mode batches new chains with all frozen anchors", () => {
    const snap = "__snap__";
    const chains = [
      makeChain(1, "art", [snap]),
      makeChain(2, "android", ["batch2"]),
      makeChain(3, "aosp", [snap]),
      makeChain(4, "devtools", ["batch2"]),
      makeChain(5, "mobile", [snap]),
      makeChain(6, "loganalysis", ["batch2"]),
    ];
    const input = makeInput(chains, { mergeMode: "delta", snapshotSessionId: snap });
    assert.deepEqual(input.frozenChainIndices, [0, 2, 4]);

    const plans = planReattachChunks(input);
    assert.ok(plans.length >= 1);
    for (const plan of plans) {
      assert.ok(plan.chainIndices.includes(0));
      assert.ok(plan.chainIndices.includes(2));
      assert.ok(plan.chainIndices.includes(4));
      const sliceChains = plan.chainIndices.map((i) => chains[i]!);
      const bytes = estimateReattachPromptBytes(
        makeInput(sliceChains, { mergeMode: "delta", snapshotSessionId: snap })
      );
      assert.ok(bytes <= REATTACH_PROMPT_TARGET_BYTES + 5000);
    }
  });
});
