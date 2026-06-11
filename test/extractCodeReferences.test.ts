import { describe, expect, it, vi } from "vitest";
import { extractFilePathsFromEvents } from "../extension/src/llm/extractCodeReferences";
import type { ChatEvent } from "../extension/src/transcript/types";

// Mock fs.accessSync so isProjectRelativePath doesn't fail on nonexistent paths
vi.mock("fs", () => ({
  accessSync: () => true,
}));

describe("extractFilePathsFromEvents", () => {
  it("extracts file paths from tool events", () => {
    const events: ChatEvent[] = [
      { kind: "user_query", text: "Fix the router", lineIndex: 0 },
      { kind: "tool", name: "Read", label: "read", lineIndex: 1, filePaths: ["/project/src/router.ts"] },
      { kind: "assistant_summary", text: "Fixed router bug", lineIndex: 2 },
    ];
    const entries = extractFilePathsFromEvents(events, "/project");
    expect(entries.length).toBe(1);
    expect(entries[0]?.path).toBe("src/router.ts");
    expect(entries[0]?.query).toBe("Fix the router");
    expect(entries[0]?.summary).toBe("Fixed router bug");
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
      { kind: "tool", name: "Read", label: "read", lineIndex: 1, filePaths: ["/proj/src/a.ts"] },
      { kind: "tool", name: "Edit", label: "edit", lineIndex: 2, filePaths: ["/proj/src/a.ts"] },
      { kind: "assistant_summary", text: "Done", lineIndex: 3 },
    ];
    const entries = extractFilePathsFromEvents(events, "/proj");
    expect(entries.length).toBe(1);
  });

  it("keeps separate entries for same file across different turns", () => {
    const events: ChatEvent[] = [
      { kind: "user_query", text: "Fix router", lineIndex: 0 },
      { kind: "tool", name: "Read", label: "read", lineIndex: 1, filePaths: ["/proj/src/a.ts"] },
      { kind: "assistant_summary", text: "Fixed routing", lineIndex: 2 },
      { kind: "user_query", text: "Add middleware", lineIndex: 3 },
      { kind: "tool", name: "Edit", label: "edit", lineIndex: 4, filePaths: ["/proj/src/a.ts"] },
      { kind: "assistant_summary", text: "Added middleware", lineIndex: 5 },
    ];
    const entries = extractFilePathsFromEvents(events, "/proj");
    expect(entries.length).toBe(2);
    expect(entries[0]?.query).toBe("Fix router");
    expect(entries[1]?.query).toBe("Add middleware");
  });
});
