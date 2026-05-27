import { describe, expect, it } from "vitest";
import {
  outlineToTopicGraph,
  topicGraphToOutline,
} from "../extension/src/llm/outlineToTopicGraph";
import type { SessionOutline, TopicGraph } from "../extension/src/llm/types";

const graph: TopicGraph = {
  title: "Root",
  topics: [
    {
      title: "Topic A",
      conceptPath: ["android", "ipc"],
      items: [{ text: "detail 1", sourceTurnIndices: [0] }],
    },
  ],
};

const outline: SessionOutline = {
  title: "Root",
  outline: [
    {
      title: "Branch",
      children: [
        {
          title: "Leaf branch",
          details: [{ text: "detail 1", sourceTurnIndices: [0] }],
        },
      ],
    },
  ],
};

describe("outlineToTopicGraph", () => {
  it("flattens detail-bearing nodes into topics", () => {
    const g = outlineToTopicGraph(outline);
    expect(g.topics.length).toBeGreaterThan(0);
    expect(g.topics[0].items[0].text).toBe("detail 1");
    expect(g.topics[0].items[0].sourceTurnIndices).toEqual([0]);
  });
});

describe("topicGraphToOutline", () => {
  it("round-trips shallow topics to outline branches", () => {
    const o = topicGraphToOutline(graph);
    expect(o.title).toBe("Root");
    expect(o.outline[0].title).toBe("Topic A");
    expect(o.outline[0].details?.[0].text).toBe("detail 1");
  });
});
