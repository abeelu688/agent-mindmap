/**
 * Tests for `commandAnalyzeAndMergeCurrentProject`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureModelSelected: vi.fn(),
  analyzeProject: vi.fn(),
  getActiveHost: vi.fn(),
  getWorkspaceSlug: vi.fn(),
  panel: {
    setLoading: vi.fn(),
    setTitle: vi.fn(),
  },
  buildAnalyzeProjectDeps: vi.fn(),
}));

vi.mock("../../extension/src/llmOptions", () => ({
  ensureModelSelected: mocks.ensureModelSelected,
}));

vi.mock("@agent-mindmap/core", () => ({
  analyzeProject: mocks.analyzeProject,
}));

vi.mock("../../extension/src/host", () => ({
  getActiveHost: mocks.getActiveHost,
  getWorkspaceSlug: mocks.getWorkspaceSlug,
}));

vi.mock("../../extension/src/webview/MindMapPanel", () => ({
  MindMapPanel: {
    createOrShow: vi.fn().mockReturnValue(mocks.panel),
    getCurrent: vi.fn().mockReturnValue(mocks.panel),
  },
}));

vi.mock("../../extension/src/progressHelpers", () => ({
  withCancellableProgress: vi.fn(
    async <T>(run: (ctx: { signal: AbortSignal; progress: unknown }) => Promise<T>) =>
      run({ signal: new AbortController().signal, progress: { report: vi.fn() } })
  ),
}));

vi.mock("../../extension/src/adapters/coreUseCaseDeps", () => ({
  buildAnalyzeProjectDeps: mocks.buildAnalyzeProjectDeps,
}));

vi.mock("../../extension/src/notify", () => ({
  notifyInfo: vi.fn(),
}));

vi.mock("../../extension/src/l10n/uiTranslate", () => ({
  t: (_key: string, defaultMsg: string, ...args: unknown[]) => {
    if (args.length === 0) return defaultMsg;
    return defaultMsg.replace(/\{(\d+)\}/g, (_m, idx: string) => String(args[Number(idx)]));
  },
}));

import { commandAnalyzeAndMergeCurrentProject } from "../../extension/src/commands/analyzeProject";
import { notifyInfo } from "../../extension/src/notify";

const fakeContext = {
  extensionUri: { fsPath: "/tmp/ext" },
} as unknown as Parameters<typeof commandAnalyzeAndMergeCurrentProject>[0];

describe("commandAnalyzeAndMergeCurrentProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureModelSelected.mockResolvedValue(true);
    mocks.getActiveHost.mockResolvedValue({});
    mocks.getWorkspaceSlug.mockReturnValue("my-project");
  });

  it("aborts when model is not selected", async () => {
    mocks.ensureModelSelected.mockResolvedValue(false);

    await commandAnalyzeAndMergeCurrentProject(fakeContext);

    expect(mocks.analyzeProject).not.toHaveBeenCalled();
  });

  it("notifies with summary and sets panel title when analysis succeeds", async () => {
    mocks.analyzeProject.mockResolvedValue({
      result: {
        projectSlug: "my-project",
        total: 5,
        analyzed: 3,
        skippedFresh: 2,
        turnFallbacks: 0,
        failed: 0,
        cliMissingCount: 0,
        failures: [],
      },
      completed: vi.fn().mockResolvedValue(undefined),
    });

    await commandAnalyzeAndMergeCurrentProject(fakeContext);

    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);
    expect(notifyInfo).toHaveBeenCalledWith(expect.stringContaining("5 session(s) total"));
    expect(notifyInfo).toHaveBeenCalledWith(expect.stringContaining("1 newly analyzed"));
    expect(mocks.panel.setTitle).toHaveBeenCalledWith("Concept Mind Map · my-project");
  });

  it("includes failure details in summary when failed > 0", async () => {
    mocks.analyzeProject.mockResolvedValue({
      result: {
        projectSlug: "my-project",
        total: 3,
        analyzed: 1,
        skippedFresh: 0,
        turnFallbacks: 0,
        failed: 2,
        cliMissingCount: 0,
        failures: [{ label: "Session A" }, { label: "Session B" }],
      },
      completed: vi.fn().mockResolvedValue(undefined),
    });

    await commandAnalyzeAndMergeCurrentProject(fakeContext);

    expect(notifyInfo).toHaveBeenCalledWith(expect.stringContaining("2 failed"));
    expect(notifyInfo).toHaveBeenCalledWith(expect.stringContaining("Session A"));
  });

  it("does not set title when slug is undefined", async () => {
    mocks.getWorkspaceSlug.mockReturnValue(undefined);
    mocks.analyzeProject.mockResolvedValue({
      result: {
        projectSlug: "p",
        total: 0,
        analyzed: 0,
        skippedFresh: 0,
        turnFallbacks: 0,
        failed: 0,
        cliMissingCount: 0,
        failures: [],
      },
      completed: vi.fn().mockResolvedValue(undefined),
    });

    await commandAnalyzeAndMergeCurrentProject(fakeContext);

    expect(mocks.panel.setTitle).not.toHaveBeenCalled();
  });
});
