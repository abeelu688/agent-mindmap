import { describe, expect, it } from "vitest";
import {
  buildDuplicateTopRootHints,
  deriveEquivalencesFromOntologyNodes,
} from "../extension/src/llm/reattachStructuralHints";
import type { ReparentChain } from "../extension/src/llm/trieReparentInput";

describe("reattachStructuralHints", () => {
  it("detects parallel top root listed under another chain childSegments", () => {
    const chains: ReparentChain[] = [
      {
        chainIndex: 1,
        from: "hub-a",
        label: "hub-a",
        topicCount: 5,
        sessionIds: [],
        childSegments: ["facet-b"],
        pathSamples: [["hub-a", "facet-b", "mod"]],
        keywords: [],
        subtree: {
          segment: "hub-a",
          label: "hub-a",
          topicCount: 5,
          childSegments: ["facet-b"],
          children: [],
        },
      },
      {
        chainIndex: 2,
        from: "facet-b",
        label: "facet-b",
        topicCount: 2,
        sessionIds: [],
        childSegments: [],
        pathSamples: [["facet-b", "mod"]],
        keywords: [],
        subtree: {
          segment: "facet-b",
          label: "facet-b",
          topicCount: 2,
          childSegments: [],
          children: [],
        },
      },
    ];
    const hints = buildDuplicateTopRootHints(chains);
    expect(hints).toHaveLength(1);
    expect(hints[0].parentChainFrom).toBe("hub-a");
    expect(hints[0].duplicateTopFrom).toBe("facet-b");
  });

  it("derives scoped equivalence from ontology node aliases on chain child", () => {
    const chains: ReparentChain[] = [
      {
        chainIndex: 1,
        from: "platform-root",
        label: "platform-root",
        topicCount: 4,
        sessionIds: [],
        childSegments: ["inner-alias"],
        pathSamples: [["platform-root", "inner-alias", "x"]],
        keywords: [],
        subtree: {
          segment: "platform-root",
          label: "platform-root",
          topicCount: 4,
          childSegments: ["inner-alias"],
          children: [],
        },
      },
    ];
    const eq = deriveEquivalencesFromOntologyNodes(
      chains,
      [
        {
          key: "platform-root",
          label: "Platform",
          aliases: ["inner-alias"],
          evidence: [],
        },
      ],
      []
    );
    expect(eq).toHaveLength(1);
    expect(eq[0].canonical).toBe("platform-root");
    expect(eq[0].scope.pathPrefix).toEqual(["platform-root"]);
  });
});
