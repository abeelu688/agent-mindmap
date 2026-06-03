import { describe, expect, it } from "vitest";
import { buildReattachPrompt } from "../extension/src/llm/promptReattach";
import {
  buildReattachDataTables,
  buildReattachHintTables,
  countNumberedTreeEdges,
  escapeTabularCell,
  estimateReattachJsonInputBytes,
} from "../extension/src/llm/promptReattachTabular";
import { estimateReattachPromptBytes } from "../extension/src/llm/reattachChunking";
import { buildReattachNodeCatalog } from "../extension/src/llm/reattachNodeCatalog";
import type {
  ReparentChain,
  TrieReparentInput,
} from "../extension/src/llm/trieReparentInput";

function makeChain(
  chainIndex: number,
  from: string,
  sessionIds: string[],
  subtreeChildren: ReparentChain["subtree"]["children"] = []
): ReparentChain {
  return {
    chainIndex,
    from,
    label: from,
    topicCount: 1,
    sessionIds,
    childSegments: subtreeChildren.map((c) => c.segment),
    pathSamples: [[from]],
    keywords: [`kw-${from}`],
    subtree: {
      segment: from,
      label: from,
      topicCount: 1,
      childSegments: subtreeChildren.map((c) => c.segment),
      children: subtreeChildren,
    },
  };
}

function makeInput(
  chains: ReparentChain[],
  opts: Partial<TrieReparentInput> = {}
): TrieReparentInput {
  const nodeCatalog = buildReattachNodeCatalog(chains);
  return {
    mergeMode: "full",
    conceptContexts: [],
    chains,
    topBranches: chains,
    segmentEquivalences: [],
    rootChildSynonymHints: [],
    topBranchSynonymHints: [],
    structuralHints: {
      duplicateTopRoots: [],
      listedChildCollapses: [],
      ontologySubordinates: [
        {
          kind: "ontology_subordinate",
          specialistFrom: "art",
          hubFrom: "android",
          hubNodeId: "N1",
          specialistNodeId: "N2",
        },
      ],
      prefixSubordinates: [],
    },
    nodeCatalog,
    nodes: [],
    ...opts,
  };
}

function countTreeEdgeRowsInPrompt(prompt: string): number {
  const marker = "### treeEdges\n";
  const start = prompt.indexOf(marker);
  if (start < 0) {
    return 0;
  }
  const rest = prompt.slice(start + marker.length);
  const end = rest.search(/\n### |\n## /);
  const block = end >= 0 ? rest.slice(0, end) : rest;
  const lines = block.trim().split("\n");
  return Math.max(0, lines.length - 1);
}

describe("escapeTabularCell", () => {
  it("passes through plain tokens", () => {
    expect(escapeTabularCell("android")).toBe("android");
    expect(escapeTabularCell(3)).toBe("3");
    expect(escapeTabularCell(undefined)).toBe("");
  });

  it("quotes cells with TAB, pipe, or newline", () => {
    expect(escapeTabularCell("a|b")).toBe('"a|b"');
    expect(escapeTabularCell("a\tb")).toBe('"a\tb"');
    expect(escapeTabularCell('say "hi"')).toBe('"say ""hi"""');
  });
});

describe("buildReattachPrompt tabular input", () => {
  it("includes input schema once and avoids repeated JSON kind keys in hints", () => {
    const input = makeInput([
      makeChain(1, "android", ["s1"]),
      makeChain(2, "art", ["s2"]),
    ]);
    const prompt = buildReattachPrompt(input);
    expect(prompt.match(/## 输入 schema/g)?.length).toBe(1);
    expect(prompt).toContain("### ontologySubordinates");
    expect(prompt).not.toContain('"kind":"ontology_subordinate"');
    expect(prompt).toContain("### nodeCatalog");
    expect(prompt).toContain("### chainMeta");
    expect(prompt).toContain("### treeEdges");
  });

  it("treeEdges row count matches numbered subtree edge count", () => {
    const input = makeInput([
      makeChain(1, "android", ["s1"], [
        {
          segment: "art",
          label: "ART",
          topicCount: 2,
          childSegments: ["oat"],
          children: [
            {
              segment: "oat",
              label: "OAT",
              topicCount: 1,
              childSegments: [],
              children: [],
            },
          ],
        },
      ]),
      makeChain(2, "cpp", ["s2"]),
    ]);
    const expected = countNumberedTreeEdges(input.nodeCatalog.numberedChains);
    expect(expected).toBe(2);
    const prompt = buildReattachPrompt(input);
    expect(countTreeEdgeRowsInPrompt(prompt)).toBe(expected);
  });

  it("delta prompt lists frozen top root ids and forbids parallel hubs", () => {
    const input = makeInput(
      [
        makeChain(1, "androidplatform", ["__snap__"]),
        makeChain(2, "android", ["s-new"]),
      ],
      {
        mergeMode: "delta",
        snapshotSessionId: "__snap__",
        frozenChainCount: 1,
        frozenChainIndices: [0],
      }
    );
    const frozenId = input.nodeCatalog.numberedChains[0]!.rootNodeId;
    const prompt = buildReattachPrompt(input, "cursor", "zh", "delta");
    expect(prompt).toContain("已稳定顶根 hub");
    expect(prompt).toContain(`${frozenId} (androidplatform)`);
    expect(prompt).toContain("仅 changes");
    expect(prompt).toContain("hub->node");
    expect(prompt).toContain('"kind":"attach"');
    expect(prompt).not.toContain('"steps":[');
  });

  it("tabular input blocks are smaller than legacy JSON payload at scale", () => {
    const chains = Array.from({ length: 10 }, (_, i) => {
      const root = `domain-${i}`;
      return makeChain(i + 1, root, [`s${i}`], [
        {
          segment: `${root}-child-a`,
          label: `${root}-child-a`,
          topicCount: 2,
          childSegments: [`${root}-leaf`],
          children: [
            {
              segment: `${root}-leaf`,
              label: `${root}-leaf`,
              topicCount: 1,
              childSegments: [],
              children: [],
            },
          ],
        },
        {
          segment: `${root}-child-b`,
          label: `${root}-child-b`,
          topicCount: 1,
          childSegments: [],
          children: [],
        },
      ]);
    });
    const input = makeInput(chains);
    input.segmentEquivalences = chains.map((c, i) => ({
      canonical: c.from,
      aliases: [`alias-${i}`, `syn-${i}`],
      scope: { pathPrefix: [c.from] },
      confidence: 0.85,
    }));
    input.conceptContexts = chains.flatMap((c, i) =>
      Array.from({ length: 8 }, (_, j) => ({
        key: `${c.from}-ctx-${j}`,
        label: `${c.from} ctx ${j}`,
        domainKeys: [c.from, "android"],
        parentKeys: [c.from],
        childKeys: [`${c.from}-child-a`],
        evidence: [`evidence ${i}-${j} for ${c.from}`, `more ${j}`],
        sessionId: `s${i}`,
        projectSlug: "proj",
      }))
    );

    const jsonBytes = estimateReattachJsonInputBytes(input);
    expect(jsonBytes).toBeGreaterThan(8000);
    const tabularBytes = Buffer.byteLength(
      [buildReattachHintTables(input), buildReattachDataTables(input)].join("\n"),
      "utf8"
    );
    expect(tabularBytes).toBeLessThan(jsonBytes * 0.75);
  });

  it("full prompt stays under chunking byte budget for moderate fixtures", () => {
    const input = makeInput([
      makeChain(1, "a", ["s1"]),
      makeChain(2, "b", ["s2"]),
    ]);
    expect(estimateReattachPromptBytes(input)).toBeLessThan(90 * 1024);
  });
});
