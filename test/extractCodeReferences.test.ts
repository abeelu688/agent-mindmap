import { describe, expect, it, vi } from "vitest";
import {
  __testing,
  CODE_REF_DESC_PROMPT_VERSION,
  extractFilePathsFromEvents,
  generateCodeReferenceDescriptions,
} from "../extension/src/llm/extractCodeReferences";
import { type LlmProvider } from "../extension/src/llm/types";
import type { LlmProviderError } from "../extension/src/llm/types";
import type { ChatEvent } from "../extension/src/transcript/types";

// Mock fs.accessSync so isProjectRelativePath doesn't fail on nonexistent paths
vi.mock("fs", () => ({
  accessSync: () => true,
}));

describe("extractFilePathsFromEvents", () => {
  it("extracts file paths from write tool events", () => {
    const events: ChatEvent[] = [
      { kind: "user_query", text: "Fix the router", lineIndex: 0 },
      {
        kind: "tool",
        name: "StrReplace",
        label: "StrReplace: router.ts",
        lineIndex: 1,
        filePaths: ["/project/src/router.ts"],
        writeKind: "modify",
        contentSnippet: "export function routeTo(path: string) {",
      },
      { kind: "assistant_summary", text: "Fixed router bug", lineIndex: 2 },
    ];
    const entries = extractFilePathsFromEvents(events, "/project");
    expect(entries.length).toBe(1);
    expect(entries[0]?.path).toBe("src/router.ts");
    expect(entries[0]?.query).toBe("Fix the router");
    expect(entries[0]?.summary).toBe("Fixed router bug");
    expect(entries[0]?.writeKind).toBe("modify");
    expect(entries[0]?.contentSnippet).toBe("export function routeTo(path: string) {");
  });

  it("returns empty for read-only tool events (strategy A)", () => {
    const events: ChatEvent[] = [
      { kind: "user_query", text: "Fix the router", lineIndex: 0 },
      {
        kind: "tool",
        name: "Read",
        label: "Read: router.ts",
        lineIndex: 1,
        filePaths: ["/project/src/router.ts"],
      },
      { kind: "assistant_summary", text: "Fixed router bug", lineIndex: 2 },
    ];
    const entries = extractFilePathsFromEvents(events, "/project");
    expect(entries).toEqual([]);
  });

  it("returns empty for no file paths", () => {
    const events: ChatEvent[] = [
      { kind: "user_query", text: "Hello", lineIndex: 0 },
      { kind: "assistant_summary", text: "Hi", lineIndex: 1 },
    ];
    const entries = extractFilePathsFromEvents(events);
    expect(entries).toEqual([]);
  });

  it("deduplicates same file in same turn", () => {
    const events: ChatEvent[] = [
      { kind: "user_query", text: "Q", lineIndex: 0 },
      {
        kind: "tool",
        name: "StrReplace",
        label: "StrReplace: a.ts",
        lineIndex: 1,
        filePaths: ["/proj/src/a.ts"],
        writeKind: "modify",
      },
      {
        kind: "tool",
        name: "StrReplace",
        label: "StrReplace: a.ts",
        lineIndex: 2,
        filePaths: ["/proj/src/a.ts"],
        writeKind: "modify",
      },
      { kind: "assistant_summary", text: "Done", lineIndex: 3 },
    ];
    const entries = extractFilePathsFromEvents(events, "/proj");
    expect(entries.length).toBe(1);
  });

  it("keeps separate entries for same file across different turns", () => {
    const events: ChatEvent[] = [
      { kind: "user_query", text: "Fix router", lineIndex: 0 },
      {
        kind: "tool",
        name: "StrReplace",
        label: "StrReplace: a.ts",
        lineIndex: 1,
        filePaths: ["/proj/src/a.ts"],
        writeKind: "modify",
      },
      { kind: "assistant_summary", text: "Fixed routing", lineIndex: 2 },
      { kind: "user_query", text: "Add middleware", lineIndex: 3 },
      {
        kind: "tool",
        name: "StrReplace",
        label: "StrReplace: a.ts",
        lineIndex: 4,
        filePaths: ["/proj/src/a.ts"],
        writeKind: "modify",
      },
      { kind: "assistant_summary", text: "Added middleware", lineIndex: 5 },
    ];
    const entries = extractFilePathsFromEvents(events, "/proj");
    expect(entries.length).toBe(2);
    expect(entries[0]?.query).toBe("Fix router");
    expect(entries[1]?.query).toBe("Add middleware");
  });

  it("attaches outline topic context by source turn", () => {
    const events: ChatEvent[] = [
      { kind: "user_query", text: "Optimize code refs", lineIndex: 0 },
      {
        kind: "tool",
        name: "StrReplace",
        label: "StrReplace: codeRefs.ts",
        lineIndex: 1,
        filePaths: ["/proj/src/codeRefs.ts"],
        writeKind: "modify",
      },
      { kind: "assistant_summary", text: "Updated prompt wording", lineIndex: 2 },
    ];
    const entries = extractFilePathsFromEvents(events, "/proj", {
      title: "Prompt optimization",
      outline: [
        {
          title: "Code reference descriptions",
          summary: "Generate file-specific change summaries",
          details: [
            {
              text: "Prompt now asks for file change responsibilities",
              sourceTurnIndices: [0],
            },
          ],
        },
      ],
    });

    expect(entries[0]?.topicContexts?.[0]).toContain("Code reference descriptions");
    expect(entries[0]?.topicContexts?.[0]).toContain("file change responsibilities");
  });

  it("prefers 'create' writeKind snippet over 'modify' for same path", () => {
    const events: ChatEvent[] = [
      { kind: "user_query", text: "Create new file", lineIndex: 0 },
      {
        kind: "tool",
        name: "StrReplace",
        label: "StrReplace: a.ts",
        lineIndex: 1,
        filePaths: ["/proj/src/a.ts"],
        writeKind: "modify",
        contentSnippet: "modify snippet",
      },
      {
        kind: "tool",
        name: "Write",
        label: "Write: a.ts",
        lineIndex: 2,
        filePaths: ["/proj/src/a.ts"],
        writeKind: "create",
        contentSnippet: "create snippet",
      },
      { kind: "assistant_summary", text: "Done", lineIndex: 3 },
    ];
    const entries = extractFilePathsFromEvents(events, "/proj");
    expect(entries[0]?.writeKind).toBe("create");
    expect(entries[0]?.contentSnippet).toBe("create snippet");
  });
});

describe("code reference description prompt", () => {
  it("uses English instructions and the requested output language for descriptions", () => {
    const prompt = __testing.buildCodeRefDescriptionPrompt(
      [
        {
          path: "src/router.ts",
          turnIndex: 0,
          query: "这个文件为什么要改？",
          summary: "Updated routing",
        },
      ],
      "Chinese"
    );

    expect(CODE_REF_DESC_PROMPT_VERSION).toBe(5);
    expect(prompt).toContain("Below are code file paths");
    expect(prompt).toContain("Write every natural-language `description` value in Chinese");
    expect(prompt).toContain('Output ONLY a JSON array: [{"path":"...","description":"..."}]');
  });
});

describe("generateCodeReferenceDescriptions", () => {
  it("fails instead of saving fallback descriptions when the LLM returns no descriptions", async () => {
    const provider: LlmProvider = {
      id: "fake",
      summarize: async () => [],
    };

    await expect(
      generateCodeReferenceDescriptions(
        [
          {
            path: "src/router.ts",
            turnIndex: 0,
            query: "Fix router",
            summary: "Updated routing",
          },
        ],
        provider,
        new AbortController().signal,
        { cache: false }
      )
    ).rejects.toMatchObject({
      code: "bad-shape",
    } satisfies Partial<LlmProviderError>);
  });

  it("fails instead of mixing fallback descriptions when LLM paths do not match", async () => {
    const provider: LlmProvider = {
      id: "fake",
      summarize: async () => [{ path: "other.ts", description: "Other file" }],
    };

    await expect(
      generateCodeReferenceDescriptions(
        [
          {
            path: "src/router.ts",
            turnIndex: 0,
            query: "Fix router",
            summary: "Updated routing",
          },
        ],
        provider,
        new AbortController().signal,
        { cache: false }
      )
    ).rejects.toMatchObject({
      code: "bad-shape",
    } satisfies Partial<LlmProviderError>);
  });
});
