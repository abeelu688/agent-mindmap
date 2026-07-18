/**
 * Tests for `commandPickSession`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureModelSelected: vi.fn(),
  listSessions: vi.fn(),
  analyzeSession: vi.fn(),
  showQuickPick: vi.fn(),
  panel: {
    setLoading: vi.fn(),
    setMindMapData: vi.fn(),
    setTitle: vi.fn(),
    watchTranscript: vi.fn(),
  },
  buildHostAccess: vi.fn(),
  buildAnalyzeSessionDeps: vi.fn(),
  activeHost: {
    displayName: "Cursor",
    emptyTranscriptsHint: vi.fn(),
  },
}));

vi.mock("../../extension/src/llmOptions", () => ({
  ensureModelSelected: mocks.ensureModelSelected,
}));

vi.mock("@agent-mindmap/core", () => ({
  listSessions: mocks.listSessions,
  analyzeSession: mocks.analyzeSession,
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
  progressTitle: () => "Analyzing…",
  attachTranscriptWatch: vi.fn(),
}));

vi.mock("../../extension/src/adapters/coreUseCaseDeps", () => ({
  buildAnalyzeSessionDeps: mocks.buildAnalyzeSessionDeps,
  buildHostAccess: mocks.buildHostAccess,
}));

vi.mock("../../extension/src/notify", () => ({
  notifyWarning: vi.fn(),
}));

vi.mock("../../extension/src/l10n/uiTranslate", () => ({
  t: (_key: string, defaultMsg: string, ...args: unknown[]) => {
    if (args.length === 0) return defaultMsg;
    return defaultMsg.replace(/\{(\d+)\}/g, (_m, idx: string) => String(args[Number(idx)]));
  },
}));

vi.mock("vscode", () => ({
  window: {
    showQuickPick: mocks.showQuickPick,
  },
}));

import { commandPickSession } from "../../extension/src/commands/pickSession";
import { attachTranscriptWatch } from "../../extension/src/progressHelpers";
import { notifyWarning } from "../../extension/src/notify";

const fakeContext = {
  extensionUri: { fsPath: "/tmp/ext" },
} as unknown as Parameters<typeof commandPickSession>[0];

describe("commandPickSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureModelSelected.mockResolvedValue(true);
    mocks.buildHostAccess.mockReturnValue({
      getActiveHost: vi.fn().mockResolvedValue(mocks.activeHost),
    });
  });

  it("aborts when model is not selected", async () => {
    mocks.ensureModelSelected.mockResolvedValue(false);

    await commandPickSession(fakeContext);

    expect(mocks.listSessions).not.toHaveBeenCalled();
  });

  it("warns with emptyTranscriptsHint when no sessions discovered", async () => {
    mocks.listSessions.mockResolvedValue({
      sessions: [],
      scanDir: "/tmp/scan",
      projectSlug: "proj",
    });
    mocks.activeHost.emptyTranscriptsHint.mockReturnValue("No transcripts");

    await commandPickSession(fakeContext);

    expect(notifyWarning).toHaveBeenCalledWith("No transcripts");
  });

  it("does nothing when user cancels the quick pick", async () => {
    mocks.listSessions.mockResolvedValue({
      sessions: [{ id: "abc", label: "Session A", filePath: "/tmp/a.jsonl" }],
      scanDir: "/tmp/scan",
      projectSlug: "proj",
    });
    mocks.showQuickPick.mockResolvedValue(undefined);

    await commandPickSession(fakeContext);

    expect(mocks.analyzeSession).not.toHaveBeenCalled();
    expect(mocks.panel.setMindMapData).not.toHaveBeenCalled();
  });

  it("analyzes the picked session and sets the mind map", async () => {
    const fakeSession = { id: "abc123", label: "Picked", filePath: "/tmp/abc.jsonl" };
    mocks.listSessions.mockResolvedValue({
      sessions: [fakeSession],
      scanDir: "/tmp/scan",
      projectSlug: "proj",
    });
    mocks.showQuickPick.mockResolvedValue({
      label: "Picked",
      description: "abc123…",
      detail: "abc123",
      session: fakeSession,
    });
    const fakeHandle = {
      result: { session: fakeSession, mindMap: { children: [] }, source: "topic" },
      completed: vi.fn().mockResolvedValue(undefined),
    };
    mocks.analyzeSession.mockResolvedValue(fakeHandle);

    await commandPickSession(fakeContext);

    expect(mocks.analyzeSession).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeSession.mock.calls[0]![0]).toBe(fakeSession);
    expect(mocks.panel.setMindMapData).toHaveBeenCalledWith(fakeHandle.result.mindMap);
    expect(attachTranscriptWatch).toHaveBeenCalled();
  });
});
