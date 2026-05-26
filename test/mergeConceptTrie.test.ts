import { describe, expect, it } from "vitest";
import {
  buildConceptMergeRecord,
  buildConceptTrieMindMap,
} from "../extension/src/store/mergeConceptTrie";
import {
  buildRecordMeta,
  buildSessionRecord,
  sha256Hex,
} from "../extension/src/store/sessionStore";
import { canonicalizeConceptSegment } from "../extension/src/llm/cursorCliProvider";
import type { SessionRecord } from "../extension/src/store/storeTypes";
import type { Topic, TopicGraph } from "../extension/src/llm/types";

function topic(
  title: string,
  conceptPath: string[] | undefined,
  items: string[]
): Topic {
  return {
    title,
    conceptPath,
    items: items.map((text) => ({ text })),
  };
}

function makeRecord(
  sessionId: string,
  projectSlug: string,
  graph: TopicGraph,
  analyzedAt = 1
): SessionRecord {
  return buildSessionRecord(
    buildRecordMeta({
      sessionId,
      projectSlug,
      projectPath: `/work/${projectSlug}`,
      transcriptPath: `/tmp/${sessionId}.jsonl`,
      transcriptMtimeMs: analyzedAt,
      transcriptSha256: sha256Hex(sessionId),
      analyzedAt,
      llm: { provider: "fake" },
      promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
      promptVersion: 2,
      sessionLabel: `${sessionId}-label`,
    }),
    graph
  );
}

describe("canonicalizeConceptSegment", () => {
  it("collapses whitespace and lowercases", () => {
    expect(canonicalizeConceptSegment("  Android  ")).toBe("android");
    expect(canonicalizeConceptSegment("Binder 驱动")).toBe("binder 驱动");
  });
});

describe("buildConceptTrieMindMap", () => {
  it("groups topics by common conceptPath prefix into a trie", () => {
    const records = [
      makeRecord("s1", "proj-a", {
        topics: [
          topic("Binder 调研", ["android", "ipc", "binder"], ["tr.code 字段"]),
        ],
      }),
      makeRecord("s2", "proj-a", {
        topics: [
          topic(
            "Binder 驱动调试",
            ["android", "ipc", "binder", "binder 驱动"],
            ["BR_TRANSACTION 路径"]
          ),
        ],
      }),
      makeRecord("s3", "proj-b", {
        topics: [
          topic("AIDL 代码生成", ["Android", "ipc", "aidl"], ["aidl 命令"]),
        ],
      }),
    ];

    const { mindMap, stats } = buildConceptTrieMindMap(records);
    expect(stats.totalTopics).toBe(3);
    expect(stats.topicsWithPath).toBe(3);
    expect(stats.topicsWithoutPath).toBe(0);

    // Root has one top-level concept: android (case-folded merge of "android" / "Android")
    expect(mindMap.children?.length).toBe(1);
    const android = mindMap.children![0];
    expect(android.data.text).toMatch(/^android \(/);

    // Under android there should be exactly one bucket: ipc
    expect(android.children?.length).toBe(1);
    const ipc = android.children![0];
    expect(ipc.data.text).toMatch(/^ipc \(/);

    // Under ipc: binder + aidl, sorted by occurrence count (binder=2, aidl=1)
    const ipcChildren = ipc.children?.map((c) => c.data.text) ?? [];
    expect(ipcChildren.length).toBe(2);
    expect(ipcChildren[0]).toMatch(/^binder \(/);
    expect(ipcChildren[1]).toMatch(/^aidl \(/);

    // Under binder: the s1 topic terminates here, and "binder 驱动" is a deeper bucket
    const binder = ipc.children![0];
    const binderChildren = binder.children?.map((c) => c.data.text) ?? [];
    // s1 topic (Binder 调研) is attached at the binder node, after deeper buckets
    expect(
      binderChildren.some((t) => t.startsWith("binder 驱动 ("))
    ).toBe(true);
    expect(
      binderChildren.some((t) => t.includes("Binder 调研"))
    ).toBe(true);
  });

  it("places topics without conceptPath under a 未分类 bucket", () => {
    const records = [
      makeRecord("a", "proj", {
        topics: [topic("With path", ["android", "ui"], ["x"])],
      }),
      makeRecord("b", "proj", {
        topics: [topic("No path", undefined, ["y"])],
      }),
    ];
    const { mindMap, stats } = buildConceptTrieMindMap(records);
    expect(stats.topicsWithoutPath).toBe(1);
    const labels = mindMap.children?.map((c) => c.data.text) ?? [];
    expect(labels.some((l) => l.startsWith("未分类"))).toBe(true);
  });

  it("filters by projectSlug", () => {
    const records = [
      makeRecord("a", "proj-a", {
        topics: [topic("X", ["android"], ["x"])],
      }),
      makeRecord("b", "proj-b", {
        topics: [topic("Y", ["frontend"], ["y"])],
      }),
    ];
    const { stats } = buildConceptTrieMindMap(records, {
      projectSlug: "proj-a",
    });
    expect(stats.totalTopics).toBe(1);
  });

  it("returns a placeholder mind map when nothing has conceptPath", () => {
    const records = [
      makeRecord("a", "proj", {
        topics: [topic("No path 1", undefined, ["x"])],
      }),
    ];
    const { mindMap } = buildConceptTrieMindMap(records, {
      // Intentionally only orphans; check no crash and we still get a tree.
    });
    expect(mindMap.children?.length).toBeGreaterThanOrEqual(1);
  });

  it("buildConceptMergeRecord captures meta", () => {
    const records = [
      makeRecord("a", "proj-a", {
        topics: [topic("X", ["android"], ["x"])],
      }),
    ];
    const merge = buildConceptMergeRecord(records);
    expect(merge.meta.kind).toBe("deterministic");
    expect(merge.meta.sessionIds).toEqual(["a"]);
  });
});
