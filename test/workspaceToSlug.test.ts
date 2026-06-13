import { describe, expect, it, vi, afterEach } from "vitest";
import { slugToWorkspacePath, workspaceToSlug } from "../extension/src/paths";

describe("workspaceToSlug", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes unix absolute paths", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    expect(workspaceToSlug("/home/example/cursor/airecorder")).toBe("home-example-cursor-airecorder");
  });

  it("encodes windows paths like Cursor project dirs", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    expect(workspaceToSlug("D:\\cursor_projects\\agent-mindmap")).toBe(
      "d-cursor-projects-agent-mindmap"
    );
  });
});

describe("slugToWorkspacePath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes unix slugs", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    expect(slugToWorkspacePath("home-example-proj")).toBe("/home/example/proj");
  });

  it("decodes windows slugs with drive letter (lossy: all '-' become separators)", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    // Cursor's slug format is lossy — `_` and `-` in path segments both become
    // `-`, so the inverse can only restore `\` separators (best-effort display).
    expect(slugToWorkspacePath("d-cursor-projects-agent-mindmap")).toBe(
      "D:\\cursor\\projects\\agent\\mindmap"
    );
  });
});
