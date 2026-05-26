import { describe, expect, it } from "vitest";
import {
  __testing,
  validateTopicGraph,
} from "../extension/src/llm/cursorCliProvider";
import { LlmProviderError } from "../extension/src/llm/types";

describe("validateTopicGraph", () => {
  it("accepts well-formed graphs", () => {
    const g = validateTopicGraph({
      topics: [
        { title: "A", items: [{ text: "x" }] },
      ],
    });
    expect(g.topics.length).toBe(1);
    expect(g.topics[0].items[0].text).toBe("x");
  });

  it("drops items without text", () => {
    const g = validateTopicGraph({
      topics: [
        {
          title: "A",
          items: [{ text: "ok" }, { text: "" }, { other: true }],
        },
      ],
    });
    expect(g.topics[0].items.length).toBe(1);
  });

  it("drops topics with no usable items", () => {
    expect(() =>
      validateTopicGraph({ topics: [{ title: "A", items: [] }] })
    ).toThrow(LlmProviderError);
  });

  it("rejects non-object root", () => {
    expect(() => validateTopicGraph(null)).toThrow(LlmProviderError);
    expect(() => validateTopicGraph([])).toThrow(LlmProviderError);
  });

  it("rejects when topics is not an array", () => {
    expect(() => validateTopicGraph({ topics: "nope" })).toThrow(
      LlmProviderError
    );
  });

  it("filters bad sourceTurnIndices", () => {
    const g = validateTopicGraph({
      topics: [
        {
          title: "A",
          items: [
            { text: "x", sourceTurnIndices: [0, -1, "bad", 2.5, 3] },
          ],
        },
      ],
    });
    expect(g.topics[0].items[0].sourceTurnIndices).toEqual([0, 3]);
  });
});

describe("extractTopicsJson", () => {
  it("strips ```json fences", () => {
    const stripped = __testing.extractTopicsJson('```json\n{"topics":[]}\n```');
    expect(JSON.parse(stripped)).toEqual({ topics: [] });
  });

  it("extracts first balanced object from mixed text", () => {
    const stripped = __testing.extractTopicsJson(
      'Sure, here:\n{"topics":[{"title":"A","items":[{"text":"x"}]}]}\nThanks!'
    );
    const obj = JSON.parse(stripped);
    expect(obj.topics[0].title).toBe("A");
  });

  it("handles nested braces inside strings", () => {
    const stripped = __testing.extractTopicsJson(
      '{"topics":[{"title":"with } brace","items":[{"text":"x"}]}]}'
    );
    const obj = JSON.parse(stripped);
    expect(obj.topics[0].title).toBe("with } brace");
  });
});

describe("extractPayload", () => {
  it("returns plain text when stdout is not JSON", () => {
    expect(__testing.extractPayload("hello world")).toBe("hello world");
  });

  it("unwraps {result: ...} envelope", () => {
    expect(__testing.extractPayload('{"result":"inner"}')).toBe("inner");
  });

  it("scans NDJSON for last string payload", () => {
    const out = __testing.extractPayload(
      '{"event":"start"}\n{"result":"final"}\n'
    );
    expect(out).toBe("final");
  });
});
