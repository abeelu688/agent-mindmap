import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { buildTurnMindMap } from "../extension/src/mindmap/buildMindMapData";
import { parseJsonl } from "../extension/src/transcript/parseJsonl";

// The "turn" view is the fallback renderer used when the LLM provider is
// unavailable. The default renderer is buildTopicMindMap (see its own test).

describe("buildTurnMindMap (fallback)", () => {
  it("builds tree with question branches", () => {
    const content = readFileSync(join(__dirname, "fixtures/sample.jsonl"), "utf8");
    const events = parseJsonl(content);
    const root = buildTurnMindMap(events, {
      includeToolCalls: true,
      maxConclusionItems: 8,
    });

    expect(root.data.text).toBeTruthy();
    expect(root.children?.length).toBeGreaterThan(0);

    const q1 = root.children?.[0];
    expect(q1?.data.text).toMatch(/^Q1:/);

    const subNames = q1?.children?.map((c) => c.data.text) ?? [];
    expect(subNames).toContain("Research");
    expect(subNames).toContain("Conclusion");
  });

  it("omits tool branch when disabled", () => {
    const content = readFileSync(join(__dirname, "fixtures/sample.jsonl"), "utf8");
    const events = parseJsonl(content);
    const root = buildTurnMindMap(events, {
      includeToolCalls: false,
      maxConclusionItems: 8,
    });
    const q1 = root.children?.[0];
    const subNames = q1?.children?.map((c) => c.data.text) ?? [];
    expect(subNames).not.toContain("Research");
    expect(subNames).toContain("Conclusion");
  });

  it("uses Chinese fixed labels when requested", () => {
    const content = readFileSync(join(__dirname, "fixtures/sample.jsonl"), "utf8");
    const events = parseJsonl(content);
    const root = buildTurnMindMap(
      events,
      {
        includeToolCalls: true,
        maxConclusionItems: 8,
      },
      undefined,
      undefined,
      "Chinese"
    );
    const subNames = root.children?.[0]?.children?.map((c) => c.data.text) ?? [];
    expect(subNames).toContain("调研");
    expect(subNames).toContain("结论");
  });
});
