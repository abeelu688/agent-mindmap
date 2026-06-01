import { describe, expect, it } from "vitest";
import {
  buildReattachNodeCatalog,
  resolveReattachStepsWithCatalog,
} from "../extension/src/llm/reattachNodeCatalog";
import type { CatalogChainInput } from "../extension/src/llm/reattachNodeCatalog";

describe("reattachNodeCatalog", () => {
  const chains: CatalogChainInput[] = [
    {
      chainIndex: 1,
      from: "hub-a",
      label: "Hub A",
      topicCount: 3,
      childSegments: ["facet-b"],
      pathSamples: [["hub-a", "facet-b"]],
      keywords: [],
      subtree: {
        segment: "hub-a",
        label: "Hub A",
        topicCount: 3,
        children: [
          {
            segment: "facet-b",
            label: "Facet B",
            topicCount: 1,
            children: [],
          },
        ],
      },
    },
    {
      chainIndex: 2,
      from: "leaf-c",
      label: "Leaf C",
      topicCount: 2,
      childSegments: [],
      pathSamples: [["leaf-c"]],
      keywords: [],
      subtree: {
        segment: "leaf-c",
        label: "Leaf C",
        topicCount: 2,
        children: [],
      },
    },
  ];

  it("assigns stable N1..Nn ids in DFS order", () => {
    const catalog = buildReattachNodeCatalog(chains);
    expect(catalog.nodes.map((n) => n.id)).toEqual(["N1", "N2", "N3"]);
    expect(catalog.nodes[0].isTopRoot).toBe(true);
    expect(catalog.nodes[2].isTopRoot).toBe(true);
    expect(catalog.numberedChains[0].tree.children[0].id).toBe("N2");
  });

  it("resolves merge_synonym steps from node ids", () => {
    const catalog = buildReattachNodeCatalog(chains);
    const resolved = resolveReattachStepsWithCatalog(
      [
        {
          step: 1,
          kind: "merge_synonym",
          sourceFrom: "",
          targetPath: [],
          sourceNodeId: "N3",
          targetNodeId: "N1",
          action: "merge",
          result: "done",
        },
      ],
      catalog
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].sourceFrom).toBe("leaf-c");
    expect(resolved[0].targetPath).toEqual(["hub-a"]);
  });

  it("resolves attach_under from targetNodeIds", () => {
    const catalog = buildReattachNodeCatalog(chains);
    const resolved = resolveReattachStepsWithCatalog(
      [
        {
          step: 1,
          kind: "attach_under",
          sourceFrom: "",
          targetPath: [],
          sourceNodeId: "N3",
          targetNodeIds: ["N1", "N3"],
          action: "attach",
          result: "done",
        },
      ],
      catalog
    );
    expect(resolved[0].targetPath).toEqual(["hub-a", "leaf-c"]);
  });
});
