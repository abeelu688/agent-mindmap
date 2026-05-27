import { describe, expect, it } from "vitest";
import { outlineToTopicGraph } from "../extension/src/llm/outlineToTopicGraph";
import type { SessionOutline } from "../extension/src/llm/types";

describe("outlineToTopicGraph conceptPath derivation", () => {
  it("derives conceptPath from outline branch titles when LLM omits it", () => {
    const outline: SessionOutline = {
      outline: [
        {
          title: "ART",
          children: [
            {
              title: "JIT",
              details: [{ text: "compile" }],
            },
          ],
        },
      ],
    };
    const graph = outlineToTopicGraph(outline);
    expect(graph.topics[0].conceptPath).toEqual(["art", "jit"]);
  });

  it("leaves single-level topics without conceptPath (未分类)", () => {
    const outline: SessionOutline = {
      outline: [
        {
          title: "Only topic",
          details: [{ text: "fact" }],
        },
      ],
    };
    const graph = outlineToTopicGraph(outline);
    expect(graph.topics[0].conceptPath).toBeUndefined();
  });
});
