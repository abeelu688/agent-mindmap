import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { extractUserQuery, parseJsonl } from "../extension/src/transcript/parseJsonl";
import { parseClaudeJsonl } from "../extension/src/transcript/parseClaudeJsonl";

describe("extractUserQuery", () => {
  it("parses user_query tags", () => {
    expect(extractUserQuery("<user_query>\nHello world\n</user_query>")).toBe("Hello world");
  });
});

describe("parseJsonl", () => {
  it("parses fixture into events", () => {
    const content = readFileSync(join(__dirname, "fixtures/sample.jsonl"), "utf8");
    const events = parseJsonl(content);
    expect(events.some((e) => e.kind === "user_query")).toBe(true);
    expect(events.some((e) => e.kind === "tool")).toBe(true);
    expect(events.some((e) => e.kind === "assistant_summary")).toBe(true);
  });

  it("extracts tool label with path basename", () => {
    const content = readFileSync(join(__dirname, "fixtures/sample.jsonl"), "utf8");
    const events = parseJsonl(content);
    const tool = events.find((e) => e.kind === "tool");
    expect(tool && tool.kind === "tool" && tool.label).toContain("binder.c");
  });

  it("extracts file paths from ApplyPatch freeform input", () => {
    const content = [
      JSON.stringify({
        role: "user",
        message: { content: [{ type: "text", text: "Update prompt version" }] },
      }),
      JSON.stringify({
        role: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "ApplyPatch",
              input:
                "*** Begin Patch\n" +
                "*** Update File: /proj/extension/src/llm/promptSessionAnalysis.ts\n" +
                "@@\n" +
                "-export const SESSION_ANALYSIS_PROMPT_VERSION = 14;\n" +
                "+export const SESSION_ANALYSIS_PROMPT_VERSION = 15;\n" +
                "*** End Patch\n",
            },
          ],
        },
      }),
    ].join("\n");

    const tool = parseJsonl(content).find((e) => e.kind === "tool");
    expect(tool && tool.kind === "tool" && tool.filePaths).toEqual([
      "/proj/extension/src/llm/promptSessionAnalysis.ts",
    ]);
    expect(tool && tool.kind === "tool" && tool.label).toBe("ApplyPatch: promptSessionAnalysis.ts");
    expect(tool && tool.kind === "tool" && tool.writeKind).toBe("modify");
    expect(tool && tool.kind === "tool" && tool.contentSnippet).toContain(
      "SESSION_ANALYSIS_PROMPT_VERSION = 15"
    );
  });

  it("extracts file paths from Claude ApplyPatch freeform input", () => {
    const content = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Update prompt contract" },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "ApplyPatch",
              input:
                "*** Begin Patch\n" +
                "*** Add File: /proj/test/promptContract.test.ts\n" +
                "+test content\n" +
                "*** End Patch\n",
            },
          ],
        },
      }),
    ].join("\n");

    const tool = parseClaudeJsonl(content).find((e) => e.kind === "tool");
    expect(tool && tool.kind === "tool" && tool.filePaths).toEqual([
      "/proj/test/promptContract.test.ts",
    ]);
    expect(tool && tool.kind === "tool" && tool.writeKind).toBe("create");
    expect(tool && tool.kind === "tool" && tool.contentSnippet).toBe("test content");
  });
});
