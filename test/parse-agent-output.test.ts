import { describe, expect, it } from "vitest";
import { __testing } from "../extension/src/llm/cursorCliProvider";

/** Realistic cursor-agent stdout when the model prefixes prose before JSON. */
const AGENT_STDOUT_WITH_PROSE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result:
    '正在查找项目中该 JSON 格式的定义与用法。\n{"title":"t","outline":[{"title":"A","details":[{"text":"x"}]}]}',
});

describe("repairJsonText", () => {
  it("removes trailing commas before } or ]", () => {
    const fixed = __testing.repairJsonText(
      '{"outline":[{"title":"A","details":[{"text":"x",},],},]}'
    );
    expect(() => JSON.parse(fixed)).not.toThrow();
  });
});

describe("parseSessionOutlineFromStdout with prose prefix in result", () => {
  it("parses outline after Chinese preamble in result string", () => {
    const outline = __testing.parseSessionOutlineFromStdout(
      AGENT_STDOUT_WITH_PROSE,
      "cursor-agent"
    );
    expect(outline.title).toBe("t");
    expect(outline.outline.length).toBe(1);
  });
});
