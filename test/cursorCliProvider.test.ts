import { describe, expect, it } from "vitest";
import { __testing } from "../extension/src/llm/cursorCliProvider";
import { validateTopicGraph } from "../extension/src/llm/topicGraphValidate";
import { LlmProviderError } from "../extension/src/llm/types";

describe("isRetryableError", () => {
  it("retries on transient codes", () => {
    expect(
      __testing.isRetryableError(new LlmProviderError("timeout", "x"))
    ).toBe(true);
    expect(
      __testing.isRetryableError(new LlmProviderError("cli-failed", "x"))
    ).toBe(true);
    expect(
      __testing.isRetryableError(new LlmProviderError("bad-json", "x"))
    ).toBe(true);
    expect(
      __testing.isRetryableError(new LlmProviderError("bad-shape", "x"))
    ).toBe(true);
  });

  it("does not retry on terminal codes", () => {
    expect(
      __testing.isRetryableError(new LlmProviderError("cli-missing", "x"))
    ).toBe(false);
    expect(
      __testing.isRetryableError(new LlmProviderError("cancelled", "x"))
    ).toBe(false);
    expect(
      __testing.isRetryableError(new LlmProviderError("empty", "x"))
    ).toBe(false);
  });
});

describe("computeBackoff", () => {
  it("grows exponentially from the base", () => {
    // With jitter ±25%: attempt 1 should be in [0.75*base, 1.25*base]
    const base = 1000;
    for (let i = 0; i < 20; i++) {
      const v1 = __testing.computeBackoff(base, 1);
      expect(v1).toBeGreaterThanOrEqual(750);
      expect(v1).toBeLessThanOrEqual(1250);
      const v2 = __testing.computeBackoff(base, 2);
      expect(v2).toBeGreaterThanOrEqual(1500);
      expect(v2).toBeLessThanOrEqual(2500);
      const v3 = __testing.computeBackoff(base, 3);
      expect(v3).toBeGreaterThanOrEqual(3000);
      expect(v3).toBeLessThanOrEqual(5000);
    }
  });

  it("caps at 10s", () => {
    expect(__testing.computeBackoff(10_000, 5)).toBeLessThanOrEqual(10_000);
    expect(__testing.computeBackoff(100_000, 1)).toBeLessThanOrEqual(10_000);
  });

  it("returns 0 when base is 0", () => {
    expect(__testing.computeBackoff(0, 5)).toBe(0);
  });
});

describe("sleepWithCancel", () => {
  it("resolves after the requested delay", async () => {
    const start = Date.now();
    await __testing.sleepWithCancel(50, new AbortController().signal);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(300);
  });

  it("rejects immediately when already aborted", async () => {
    const c = new AbortController();
    c.abort();
    await expect(__testing.sleepWithCancel(1000, c.signal)).rejects.toThrow(
      LlmProviderError
    );
  });

  it("rejects promptly when aborted mid-sleep", async () => {
    const c = new AbortController();
    const start = Date.now();
    const p = __testing.sleepWithCancel(5000, c.signal);
    setTimeout(() => c.abort(), 30);
    await expect(p).rejects.toThrow(LlmProviderError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

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

  it("parses and normalises conceptPath", () => {
    const g = validateTopicGraph({
      topics: [
        {
          title: "T",
          conceptPath: ["  Android ", "android", "IPC", "binder"],
          items: [{ text: "x" }],
        },
      ],
    });
    // Case-insensitive dedup folds "Android"/"android"
    expect(g.topics[0].conceptPath).toEqual(["Android", "IPC", "binder"]);
  });

  it("omits conceptPath when missing or unusable", () => {
    const g = validateTopicGraph({
      topics: [
        {
          title: "T",
          items: [{ text: "x" }],
        },
        {
          title: "U",
          conceptPath: ["", "   ", 42 as unknown as string],
          items: [{ text: "y" }],
        },
      ],
    });
    expect(g.topics[0].conceptPath).toBeUndefined();
    expect(g.topics[1].conceptPath).toBeUndefined();
  });

  it("caps conceptPath length", () => {
    const g = validateTopicGraph({
      topics: [
        {
          title: "T",
          conceptPath: ["a", "b", "c", "d", "e", "f", "g", "h"],
          items: [{ text: "x" }],
        },
      ],
    });
    expect(g.topics[0].conceptPath?.length).toBe(6);
  });

  it("extracts root title/summary when provided", () => {
    const g = validateTopicGraph({
      title: "Binder 命令字段",
      summary: "tr.code 才是真正的命令字段",
      topics: [{ title: "A", items: [{ text: "x" }] }],
    });
    expect(g.title).toBe("Binder 命令字段");
    expect(g.summary).toBe("tr.code 才是真正的命令字段");
  });

  it("drops blank or non-string root title/summary", () => {
    const g = validateTopicGraph({
      title: "   ",
      summary: 42,
      topics: [{ title: "A", items: [{ text: "x" }] }],
    });
    expect(g.title).toBeUndefined();
    expect(g.summary).toBeUndefined();
  });

  it("truncates overly long root title", () => {
    const longTitle = "x".repeat(200);
    const g = validateTopicGraph({
      title: longTitle,
      topics: [{ title: "A", items: [{ text: "x" }] }],
    });
    expect(g.title).toBeDefined();
    expect(g.title!.length).toBeLessThanOrEqual(80);
    expect(g.title!.endsWith("...")).toBe(true);
  });

  it("omits root title/summary when absent", () => {
    const g = validateTopicGraph({
      topics: [{ title: "A", items: [{ text: "x" }] }],
    });
    expect(g.title).toBeUndefined();
    expect(g.summary).toBeUndefined();
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
