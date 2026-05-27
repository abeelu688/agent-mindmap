import { describe, expect, it } from "vitest";
import { sanitizeTopicGraph } from "../extension/src/llm/sanitizeTopicGraph";
import type { TopicGraph } from "../extension/src/llm/types";

const sample: TopicGraph = {
  title: "t",
  topics: [
    {
      title: "a",
      items: [
        { text: "from Q1", sourceTurnIndices: [0] },
        { text: "from Q3", sourceTurnIndices: [2] },
        { text: "mixed", sourceTurnIndices: [0, 2, 5] },
      ],
    },
  ],
};

describe("sanitizeTopicGraph", () => {
  it("drops indices >= userQueryCount", () => {
    const out = sanitizeTopicGraph(sample, 1);
    expect(out.topics[0].items[0].sourceTurnIndices).toEqual([0]);
    expect(out.topics[0].items[1].sourceTurnIndices).toBeUndefined();
    expect(out.topics[0].items[2].sourceTurnIndices).toEqual([0]);
  });

  it("keeps graph unchanged when all indices valid", () => {
    const out = sanitizeTopicGraph(sample, 6);
    expect(out).toBe(sample);
  });
});
