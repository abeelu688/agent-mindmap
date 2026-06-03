import { describe, expect, it } from "vitest";
import { buildReattachNodeCatalog } from "../extension/src/llm/reattachNodeCatalog";
import type { ReparentChain, TrieReparentInput } from "../extension/src/llm/trieReparentInput";
import {
  DeltaReattachValidationError,
  validateDeltaReattachSteps,
} from "../extension/src/llm/validateDeltaReattachSteps";

function chain(from: string, sessionIds: string[], chainIndex: number): ReparentChain {
  return {
    chainIndex,
    from,
    label: from,
    topicCount: 1,
    sessionIds,
    childSegments: [],
    pathSamples: [[from]],
    keywords: [],
    subtree: {
      segment: from,
      label: from,
      topicCount: 1,
      childSegments: [],
      children: [],
    },
  };
}

function deltaInput(
  frozenFrom: string,
  newFrom: string,
  snapshotId = "__snap__"
): TrieReparentInput {
  const chains = [
    chain(frozenFrom, [snapshotId], 1),
    chain(newFrom, ["s-new"], 2),
  ];
  const nodeCatalog = buildReattachNodeCatalog(chains);
  return {
    mergeMode: "delta",
    snapshotSessionId: snapshotId,
    frozenChainCount: 1,
    frozenChainIndices: [0],
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

describe("validateDeltaReattachSteps", () => {
  it("allows attach_under new chain under frozen top root", () => {
    const input = deltaInput("androidplatform", "aosp");
    expect(() =>
      validateDeltaReattachSteps(input, [
        {
          step: 1,
          kind: "attach_under",
          sourceFrom: "aosp",
          targetPath: ["androidplatform", "aosp"],
          action: "attach",
          result: "ok",
        },
      ])
    ).not.toThrow();
  });

  it("rejects attach with new-batch hub (parallel hub)", () => {
    const input = deltaInput("androidplatform", "android");
    expect(() =>
      validateDeltaReattachSteps(input, [
        {
          step: 1,
          kind: "attach_under",
          sourceFrom: "android",
          targetPath: ["android", "android"],
          action: "bad",
          result: "bad",
        },
      ])
    ).toThrow(DeltaReattachValidationError);
  });

  it("allows attach under frozen hub by segment key", () => {
    const input = deltaInput("androidplatform", "aosp");
    expect(() =>
      validateDeltaReattachSteps(input, [
        {
          step: 1,
          kind: "attach_under",
          sourceFrom: "aosp",
          targetPath: ["androidplatform", "aosp"],
          action: "ok",
          result: "ok",
        },
      ])
    ).not.toThrow();
  });

  it("rejects moving a frozen top root", () => {
    const input = deltaInput("forest", "intent");
    expect(() =>
      validateDeltaReattachSteps(input, [
        {
          step: 1,
          kind: "attach_under",
          sourceFrom: "forest",
          targetPath: ["forest"],
          action: "move frozen",
          result: "bad",
        },
      ])
    ).toThrow(DeltaReattachValidationError);
  });
});
