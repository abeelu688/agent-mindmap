import { describe, expect, it } from "vitest";
import { buildTopicMindMap } from "../extension/src/mindmap/buildTopicMindMap";
import type { TopicGraph } from "../extension/src/llm/types";

const sampleGraph: TopicGraph = {
  topics: [
    {
      title: "Binder transaction code",
      summary: "tr.code 才是真正的命令字段",
      items: [
        { text: "tr.code 不在 Parcel 里", sourceTurnIndices: [0] },
        { text: "BR_TRANSACTION 路径" },
      ],
    },
    {
      title: "调研用到的工具",
      items: [{ text: "Grep binder_transaction", sourceTurnIndices: [0, 1] }],
    },
  ],
};

describe("buildTopicMindMap", () => {
  it("falls back to session label as root when graph has no title", () => {
    const root = buildTopicMindMap(sampleGraph, "abc12345…");
    expect(root.data.text).toBe("abc12345…");
  });

  it("uses graph.title as root when present, ignoring session label", () => {
    const root = buildTopicMindMap(
      { ...sampleGraph, title: "Binder 命令字段调研" },
      "abc12345…"
    );
    expect(root.data.text).toBe("Binder 命令字段调研");
  });

  it("falls back to session label when graph.title is blank", () => {
    const root = buildTopicMindMap(
      { ...sampleGraph, title: "   " },
      "abc12345…"
    );
    expect(root.data.text).toBe("abc12345…");
  });

  it("creates one branch per topic with 核心 prefix", () => {
    const root = buildTopicMindMap(sampleGraph, "label");
    expect(root.children?.length).toBe(2);
    expect(root.children?.[0].data.text).toMatch(/^核心1:/);
    expect(root.children?.[1].data.text).toMatch(/^核心2:/);
  });

  it("prepends summary as a 概述 leaf when present", () => {
    const root = buildTopicMindMap(sampleGraph, "label");
    const firstChildren = root.children?.[0].children ?? [];
    expect(firstChildren[0].data.text).toMatch(/^概述：/);
  });

  it("annotates items with Q# references", () => {
    const root = buildTopicMindMap(sampleGraph, "label");
    const items = root.children?.[0].children?.map((c) => c.data.text) ?? [];
    expect(items.some((t) => t.includes("(Q1)"))).toBe(true);
  });

  it("falls back to default label without session label", () => {
    const root = buildTopicMindMap(sampleGraph);
    expect(root.data.text).toBe("Agent Session");
  });

  it("handles empty graph", () => {
    const root = buildTopicMindMap({ topics: [] }, "label");
    expect(root.children).toBeUndefined();
  });
});
