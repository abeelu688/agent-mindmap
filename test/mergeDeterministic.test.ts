import { describe, expect, it } from "vitest";
import {
  buildDeterministicMergeMindMap,
  buildDeterministicMergeRecord,
} from "../extension/src/store/mergeDeterministic";
import {
  buildRecordMeta,
  buildSessionRecord,
  sha256Hex,
} from "../extension/src/store/sessionStore";
import type { SessionRecord } from "../extension/src/store/storeTypes";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";
import type { TopicGraph } from "../extension/src/llm/types";

const graphA: TopicGraph = {
  title: "Binder",
  topics: [{ title: "tr.code", items: [{ text: "在 binder.c 里" }] }],
};

const graphB: TopicGraph = {
  title: "AIDL",
  topics: [{ title: "代码生成", items: [{ text: "aidl 命令" }] }],
};

function makeRecord(
  sessionId: string,
  projectSlug: string,
  analyzedAt: number,
  graph: TopicGraph,
  projectPath?: string
): SessionRecord {
  return buildSessionRecord(
    buildRecordMeta({
      sessionId,
      projectSlug,
      projectPath,
      transcriptPath: `/tmp/${sessionId}.jsonl`,
      transcriptMtimeMs: analyzedAt,
      transcriptSha256: sha256Hex(sessionId),
      analyzedAt,
      llm: { provider: "fake" },
      promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
      sessionLabel: `${sessionId.slice(0, 4)}…`,
    }),
    topicGraphToOutline(graph)
  );
}

describe("buildDeterministicMergeMindMap", () => {
  it("groups sessions by project with project labels", () => {
    const records = [
      makeRecord("a1", "proj-a", 100, graphA, "/work/proj-a"),
      makeRecord("a2", "proj-a", 200, graphB),
      makeRecord("b1", "proj-b", 150, graphA, "/work/proj-b"),
    ];
    const root = buildDeterministicMergeMindMap(records);
    expect(root.data.text).toBe("Agent Mind Map · 全部");
    expect(root.children?.length).toBe(2);
    const labels = root.children?.map((c) => c.data.text) ?? [];
    expect(labels.some((l) => l.startsWith("项目: /work/proj-a"))).toBe(true);
    expect(labels.some((l) => l.startsWith("项目: /work/proj-b"))).toBe(true);
  });

  it("orders projects by most recently analyzed session", () => {
    const records = [
      makeRecord("old", "proj-old", 100, graphA),
      makeRecord("fresh", "proj-fresh", 999, graphB),
    ];
    const root = buildDeterministicMergeMindMap(records);
    expect(root.children?.[0].data.text).toContain("proj-fresh");
    expect(root.children?.[1].data.text).toContain("proj-old");
  });

  it("orders sessions within a project newest first", () => {
    const records = [
      makeRecord("older", "p", 100, graphA),
      makeRecord("newer", "p", 200, graphB),
    ];
    const root = buildDeterministicMergeMindMap(records);
    const projectChild = root.children?.[0];
    const sessionLabels =
      projectChild?.children?.map((c) => c.data.text) ?? [];
    expect(sessionLabels[0]).toContain("AIDL");
    expect(sessionLabels[1]).toContain("Binder");
  });

  it("filters by projectSlug when supplied", () => {
    const records = [
      makeRecord("a", "proj-a", 100, graphA),
      makeRecord("b", "proj-b", 200, graphB),
    ];
    const root = buildDeterministicMergeMindMap(records, {
      projectSlug: "proj-b",
    });
    expect(root.data.text).toBe("Agent Mind Map · proj-b");
    expect(root.children?.length).toBe(1);
  });

  it("shows a placeholder when library is empty", () => {
    const root = buildDeterministicMergeMindMap([]);
    expect(root.children?.[0].data.text).toContain("(库中暂无已分析的 session)");
  });

  it("buildDeterministicMergeRecord captures meta", () => {
    const records = [
      makeRecord("a", "proj-a", 100, graphA),
      makeRecord("b", "proj-b", 200, graphB),
    ];
    const merge = buildDeterministicMergeRecord(records);
    expect(merge.meta.kind).toBe("deterministic");
    expect(merge.meta.sessionIds.sort()).toEqual(["a", "b"]);
    expect(merge.meta.projectSlugs).toEqual(["proj-a", "proj-b"]);
  });
});
