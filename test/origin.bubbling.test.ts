import { describe, expect, it } from "vitest";
import { buildTopicMindMap } from "../extension/src/mindmap/buildTopicMindMap";
import { buildConceptTrieMindMap } from "../extension/src/store/mergeConceptTrie";
import type { TopicGraph } from "../extension/src/llm/types";
import type {
  MindMapNodeData,
  NodeOriginRef,
} from "../extension/src/transcript/types";
import type { SessionMeta } from "../extension/src/mindmap/origin";
import {
  buildRecordMeta,
  buildSessionRecord,
} from "../extension/src/store/sessionStore";

function collectLeaves(node: MindMapNodeData): MindMapNodeData[] {
  if (!node.children?.length) {
    return [node];
  }
  return node.children.flatMap(collectLeaves);
}

const graph: TopicGraph = {
  title: "Binder 调研",
  topics: [
    {
      title: "tr.code",
      summary: "command field",
      items: [
        { text: "tr.code 不在 Parcel 里", sourceTurnIndices: [0] },
        { text: "BR_TRANSACTION 路径", sourceTurnIndices: [2] },
      ],
    },
    {
      title: "调研工具",
      items: [{ text: "Grep binder_transaction", sourceTurnIndices: [0, 1] }],
    },
  ],
};

const sessionMeta: SessionMeta = {
  sessionId: "sess-X",
  projectSlug: "proj-a",
  projectPath: "/work/proj-a",
  sessionLabel: "sess-X · now",
  transcriptPath: "/tmp/sess-X.jsonl",
};

describe("buildTopicMindMap origin bubbling", () => {
  it("attaches per-leaf refs from sourceTurnIndices", () => {
    const root = buildTopicMindMap(graph, "label", sessionMeta);
    const firstTopicChildren = root.children?.[0].children ?? [];
    const itemNode = firstTopicChildren.find((c) =>
      c.data.text.includes("tr.code 不在 Parcel")
    );
    expect(itemNode?.data.origin?.refs).toEqual([
      { ...sessionMeta, turnIndex: 0 },
    ]);
  });

  it("topic branch carries the union of its leaves' refs", () => {
    const root = buildTopicMindMap(graph, "label", sessionMeta);
    const topic0 = root.children?.[0];
    const turns = (topic0?.data.origin?.refs ?? [])
      .map((r) => r.turnIndex)
      .filter((n): n is number => typeof n === "number")
      .sort((a, b) => a - b);
    // 概述 carries a branch-level (turnIndex=undefined) ref so the union
    // includes both the session-level entry and the per-turn entries.
    expect(turns).toEqual([0, 2]);
  });

  it("root carries the union across all topics", () => {
    const root = buildTopicMindMap(graph, "label", sessionMeta);
    const turns = (root.data.origin?.refs ?? [])
      .map((r) => r.turnIndex)
      .filter((n): n is number => typeof n === "number")
      .sort((a, b) => a - b);
    expect(turns).toEqual([0, 1, 2]);
  });

  it("emits no origin when sessionMeta is omitted (back-compat)", () => {
    const root = buildTopicMindMap(graph, "label");
    expect(root.data.origin).toBeUndefined();
    for (const leaf of collectLeaves(root)) {
      expect(leaf.data.origin).toBeUndefined();
    }
  });
});

describe("buildConceptTrieMindMap origin bubbling", () => {
  function recordFor(
    sessionId: string,
    slug: string,
    topics: TopicGraph["topics"]
  ) {
    return buildSessionRecord(
      buildRecordMeta({
        sessionId,
        projectSlug: slug,
        projectPath: `/work/${slug}`,
        transcriptPath: `/tmp/${sessionId}.jsonl`,
        transcriptMtimeMs: 1,
        transcriptSha256: "deadbeef",
        llm: { provider: "fake" },
        promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
        promptVersion: 2,
        sessionLabel: sessionId,
      }),
      { topics }
    );
  }

  it("a leaf inside android > ipc > binder refs its single session+turn", () => {
    const rec = recordFor("sess-1", "proj-a", [
      {
        title: "Binder",
        conceptPath: ["android", "ipc", "binder"],
        items: [{ text: "tr.code", sourceTurnIndices: [3] }],
      },
    ]);
    const { mindMap } = buildConceptTrieMindMap([rec]);
    // Walk root -> android -> ipc -> binder -> topic branch -> leaf
    const android = mindMap.children?.[0];
    const ipc = android?.children?.[0];
    const binder = ipc?.children?.[0];
    const topicBranch = binder?.children?.[0];
    const leaf = topicBranch?.children?.find((c) =>
      c.data.text.includes("tr.code")
    );
    expect(leaf?.data.origin?.refs).toEqual([
      {
        sessionId: "sess-1",
        projectSlug: "proj-a",
        projectPath: "/work/proj-a",
        sessionLabel: "sess-1",
        transcriptPath: "/tmp/sess-1.jsonl",
        turnIndex: 3,
      },
    ]);
  });

  it("a trie branch unions session+turn refs across multiple records", () => {
    const records = [1, 2, 3].map((i) =>
      recordFor(`sess-${i}`, `proj-${i}`, [
        {
          title: `Topic ${i}`,
          conceptPath: ["android", "ipc", "binder"],
          items: [{ text: `note ${i}`, sourceTurnIndices: [0] }],
        },
      ])
    );
    const { mindMap } = buildConceptTrieMindMap(records);
    const android = mindMap.children?.[0];
    const sessionIds = new Set(
      (android?.data.origin?.refs ?? []).map((r: NodeOriginRef) => r.sessionId)
    );
    expect(sessionIds).toEqual(new Set(["sess-1", "sess-2", "sess-3"]));
  });
});
