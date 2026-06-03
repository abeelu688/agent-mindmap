import { describe, expect, it } from "vitest";
import {
  buildMergeSessionAnalysisInput,
  formatMergeSessionAnalysisInput,
  prioritizeNodesForMergeInput,
  serializeOutlineTree,
  __testing,
} from "../extension/src/llm/mergeSessionAnalysisInput";
import {
  buildMergeSessionAnalysisPrompt,
  MERGE_SESSION_ANALYSIS_PROMPT_VERSION,
} from "../extension/src/llm/promptMergeSessionAnalysis";
import { snapConceptPathToVirtualSession } from "../extension/src/llm/applyVirtualSessionToRecords";
import {
  buildRecordMeta,
  buildSessionRecord,
  sha256Hex,
} from "../extension/src/store/sessionStore";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";
import { MERGE_SNAPSHOT_SESSION_ID } from "../extension/src/store/mergeSnapshot";
import type { ConceptContextForMerge } from "../extension/src/store/storeTypes";
import type { OutlineNode } from "../extension/src/llm/types";

function sessionRecord(
  sessionId: string,
  path: string[],
  extra?: {
    conceptContexts?: ConceptContextForMerge[];
    outlineTree?: OutlineNode[];
  }
) {
  const outline =
    extra?.outlineTree ??
    topicGraphToOutline({
      topics: [{ title: "topic", conceptPath: path, items: [{ text: "x" }] }],
    }).outline;
  return buildSessionRecord(
    buildRecordMeta({
      sessionId,
      projectSlug: "proj-a",
      transcriptPath: `/tmp/${sessionId}.jsonl`,
      transcriptMtimeMs: 1,
      transcriptSha256: sha256Hex(sessionId),
      analyzedAt: 1,
      llm: { provider: "fake" },
      promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
      promptVersion: 5,
      sessionLabel: sessionId,
    }),
    topicGraphToOutline({
      topics: [{ title: "topic", conceptPath: path, items: [{ text: "x" }] }],
      title: "session title",
    }),
    {
      sessionAnalysis: {
        domains: ["platform"],
        nodes: [
          {
            key: path[0] ?? "root",
            label: path[0] ?? "root",
            parentKeys: [],
            evidence: ["evidence line one", "evidence line two"],
          },
        ],
        segmentEquivalences: [],
        outline: { title: "t", outline },
      },
      conceptContexts: extra?.conceptContexts,
    }
  );
}

describe("mergeSessionAnalysis input enrichment", () => {
  it("includes domainKeys and aliases from conceptContexts", () => {
    const rec = sessionRecord("s1", ["android", "art"], {
      conceptContexts: [
        {
          key: "android",
          label: "Android",
          domainKeys: ["platform"],
          parentKeys: [],
          childKeys: ["art"],
          aliases: ["android-platform"],
          evidence: ["ev1", "ev2", "ev3"],
          sessionId: "s1",
          projectSlug: "proj-a",
        },
      ],
    });
    const input = buildMergeSessionAnalysisInput([rec], "full");
    const node = input.sessions[0]?.nodes[0];
    expect(node?.domainKeys).toEqual(["platform"]);
    expect(node?.aliases).toContain("android-platform");
    expect(node?.evidence.length).toBeLessThanOrEqual(3);
  });

  it("serializes outline as tree with intermediate children", () => {
    const tree = serializeOutlineTree([
      {
        title: "Top",
        summary: "top sum",
        children: [
          {
            title: "Mid",
            children: [
              {
                title: "Leaf",
                summary: "leaf sum",
                conceptPath: ["a", "b"],
              },
            ],
          },
        ],
      },
    ]);
    expect(tree[0]?.title).toBe("Top");
    expect(tree[0]?.children?.[0]?.title).toBe("Mid");
    expect(tree[0]?.children?.[0]?.children?.[0]?.conceptPath).toEqual([
      "a",
      "b",
    ]);
  });

  it("adds frozenTopRootKeys and frozenDomains on snapshot in delta mode", () => {
    const snap = sessionRecord(MERGE_SNAPSHOT_SESSION_ID, ["hub", "child"]);
    snap.sessionAnalysis!.nodes = [
      {
        key: "hub",
        label: "Hub",
        parentKeys: [],
        evidence: ["e"],
      },
      {
        key: "child",
        label: "Child",
        parentKeys: ["hub"],
        evidence: ["e2"],
      },
    ];
    snap.sessionAnalysis!.domains = ["hub-domain", "extra"];
    const input = buildMergeSessionAnalysisInput(
      [snap, sessionRecord("new", ["android", "jni"])],
      "delta",
      MERGE_SNAPSHOT_SESSION_ID
    );
    expect(input.sessions[0]?.role).toBe("snapshot");
    expect(input.sessions[0]?.frozenTopRootKeys).toEqual(["hub"]);
    expect(input.sessions[0]?.frozenDomains).toEqual(["hub-domain", "extra"]);
    expect(input.sessions[0]?.outline.tree).toBeDefined();
    expect(
      (input.sessions[0]?.outline as { leaves?: unknown }).leaves
    ).toBeUndefined();
  });

  it("prioritizeNodesForMergeInput keeps all root nodes when over cap", () => {
    const nodes = Array.from({ length: 100 }, (_, i) => ({
      key: `node-${i}`,
      label: `n${i}`,
      domainKeys: ["d"],
      parentKeys: i < 3 ? [] : [`node-${i - 1}`],
      childKeys: [] as string[],
      aliases: [] as string[],
      evidence: ["e"],
    }));
    const kept = prioritizeNodesForMergeInput(nodes, new Set(["node-50"]), 10);
    expect(kept.filter((n) => !n.parentKeys.length).length).toBe(3);
    expect(kept.length).toBe(10);
  });

  it("uses compact JSON without pretty-print", () => {
    const input = buildMergeSessionAnalysisInput(
      [sessionRecord("s1", ["a", "b"]), sessionRecord("s2", ["a", "c"])],
      "full"
    );
    const body = formatMergeSessionAnalysisInput(input);
    expect(body).not.toContain("\n  ");
    expect(body).toContain('"domainKeys"');
    expect(body).toContain('"tree"');
  });

  it("prompt v2 documents domainKeys, frozenTopRootKeys, and merge constraints", () => {
    const snap = sessionRecord(MERGE_SNAPSHOT_SESSION_ID, ["hub"]);
    const input = buildMergeSessionAnalysisInput(
      [snap, sessionRecord("new", ["x"])],
      "delta",
      MERGE_SNAPSHOT_SESSION_ID
    );
    const prompt = buildMergeSessionAnalysisPrompt(input, {
      maxDomains: 8,
      maxNodes: 64,
      maxBranches: 8,
      maxDetailsPerNode: 4,
    });
    expect(MERGE_SESSION_ANALYSIS_PROMPT_VERSION).toBe(4);
    expect(prompt).toContain("domainKeys");
    expect(prompt).toContain("frozenTopRootKeys");
    expect(prompt).toContain("outline.tree");
    expect(prompt).toContain("parentKeys=[] 的根节点最多 2 个");
    expect(prompt).toContain("增量合并");
  });

  it("snapshot node cap is higher than batch", () => {
    expect(__testing.MAX_SNAPSHOT_NODES).toBeGreaterThan(
      __testing.MAX_CONTEXTS_PER_SESSION
    );
  });
});

describe("snapConceptPathToVirtualSession", () => {
  it("rebuilds path from virtual node hierarchy", () => {
    const virtual = {
      domains: ["platform"],
      nodes: [
        {
          key: "androidplatform",
          label: "Android Platform",
          parentKeys: [],
          evidence: ["hub"],
        },
        {
          key: "art",
          label: "ART",
          parentKeys: ["androidplatform"],
          evidence: ["runtime"],
        },
      ],
      segmentEquivalences: [
        {
          canonical: "android",
          aliases: ["androidplatform"],
          scope: { pathPrefix: [] },
        },
      ],
      outline: { title: "t", outline: [] },
    };
    const snapped = snapConceptPathToVirtualSession(
      ["android", "art"],
      virtual
    );
    expect(snapped[0]).toBe("androidplatform");
    expect(snapped[1]).toBe("art");
  });
});

describe("mergeSessionAnalysis prompt", () => {
  it("formats multi-session input and references session-analysis schema", () => {
    const input = buildMergeSessionAnalysisInput(
      [
        sessionRecord("s1", ["android", "art"]),
        sessionRecord("s2", ["android", "binder"]),
      ],
      "full"
    );
    expect(input.sessions).toHaveLength(2);
    const body = formatMergeSessionAnalysisInput(input);
    expect(body).toContain('"sessionId":"s1"');
    const prompt = buildMergeSessionAnalysisPrompt(input, {
      maxDomains: 8,
      maxNodes: 64,
      maxBranches: 8,
      maxDetailsPerNode: 4,
    });
    expect(prompt).toContain("session-analysis");
    expect(prompt).toContain("segmentEquivalences");
    expect(prompt).toContain("domainKeys");
    expect(prompt).toContain("childKeys");
    expect(prompt).toContain("子孙");
    expect(prompt).not.toContain("changes[]");
  });
});
