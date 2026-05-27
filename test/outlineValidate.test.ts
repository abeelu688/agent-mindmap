import { describe, expect, it } from "vitest";
import {
  validateMergedOutline,
  validateSessionOutline,
} from "../extension/src/llm/outlineValidate";
import { LlmProviderError } from "../extension/src/llm/types";

describe("validateSessionOutline", () => {
  it("accepts hierarchical outline with details", () => {
    const o = validateSessionOutline({
      title: "T",
      outline: [
        {
          title: "A",
          children: [{ title: "B", details: [{ text: "x", sourceTurnIndices: [0] }] }],
        },
      ],
    });
    expect(o.outline[0].children?.[0].details?.[0].text).toBe("x");
  });

  it("strips details when children exist", () => {
    const o = validateSessionOutline({
      outline: [
        {
          title: "A",
          children: [{ title: "B", details: [{ text: "leaf" }] }],
          details: [{ text: "should drop" }],
        },
      ],
    });
    expect(o.outline[0].details).toBeUndefined();
  });

  it("rejects empty outline", () => {
    expect(() => validateSessionOutline({ outline: [] })).toThrow(LlmProviderError);
  });
});

describe("validateMergedOutline", () => {
  it("accepts sources on details", () => {
    const o = validateMergedOutline({
      outline: [
        {
          title: "Merged",
          details: [
            { text: "point", sources: [{ sessionIndex: 1, turnIndex: 2 }] },
          ],
        },
      ],
    });
    expect(o.outline[0].details?.[0].sources?.[0].sessionIndex).toBe(1);
  });
});
