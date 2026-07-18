/**
 * Tests for `commandOpenLatest`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureModelSelected: vi.fn(),
  listSessions: vi.fn(),
  analyzeSession: vi.fn(),
  panel: {
    setLoading: vi.fn(),
    setMindMapData: vi.fn(),
    setTitle: vi.fn(),
    watchTranscript: vi.fn(),
  },
  buildHostAccess: vi.fn(),
  buildAnalyzeSessionDeps: vi.fn(),
  activeHost: {
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

import {
  commandOpenLatest,
  setActiveSession,
  getActiveSession,
} from "../../extension/src/commands/openLatest";
import {
  withCancellableProgress,
  attachTranscriptWatch,
} from "../../extension/src/progressHelpers";
import { notifyWarning } from "../../extension/src/notify";

const fakeContext = {
  extensionUri: { fsPath: "/tmp/ext" },
} as unknown as Parameters<typeof commandOpenLatest>[0];

describe("commandOpenLatest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureModelSelected.mockResolvedValue(true);
    mocks.buildHostAccess.mockReturnValue({
      getActiveHost: vi.fn().mockResolvedValue(mocks.activeHost),
    });
    setActiveSession(undefined);
  });

  it("aborts when model is not selected", async () => {
    mocks.ensureModelSelected.mockResolvedValue(false);

    await commandOpenLatest(fakeContext);

    expect(mocks.listSessions).not.toHaveBeenCalled();
    expect(withCancellableProgress).not.toHaveBeenCalled();
  });

  it("warns when no sessions are discovered", async () => {
    mocks.listSessions.mockResolvedValue(undefined);

    await commandOpenLatest(fakeContext);

    expect(notifyWarning).not.toHaveBeenCalled();
  });

  it("warns with emptyTranscriptsHint when sessions list is empty", async () => {
    mocks.listSessions.mockResolvedValue({
      sessions: [],
      scanDir: "/tmp/scan",
      projectSlug: "proj",
    });
    mocks.activeHost.emptyTranscriptsHint.mockReturnValue("No transcripts found");

    await commandOpenLatest(fakeContext);

    expect(notifyWarning).toHaveBeenCalledWith("No transcripts found");
  });

  it("analyzes the most recent session and sets the mind map", async () => {
    const fakeSession = { id: "abc123", label: "Latest", filePath: "/tmp/abc.jsonl" };
    mocks.listSessions.mockResolvedValue({
      sessions: [fakeSession],
      scanDir: "/tmp/scan",
      projectSlug: "proj",
    });
    const fakeHandle = {
      result: { session: fakeSession, mindMap: { children: [] }, source: "topic" },
      completed: vi.fn().mockResolvedValue(undefined),
    };
    mocks.analyzeSession.mockResolvedValue(fakeHandle);

    await commandOpenLatest(fakeContext);

    expect(mocks.analyzeSession).toHaveBeenCalledTimes(1);
    const analyzedSessionArg = mocks.analyzeSession.mock.calls[0]![0];
    expect(analyzedSessionArg).toBe(fakeSession);
    expect(mocks.panel.setMindMapData).toHaveBeenCalledWith(fakeHandle.result.mindMap);
    expect(attachTranscriptWatch).toHaveBeenCalledWith(mocks.panel, fakeHandle.result, fakeContext);
    expect(getActiveSession()).toBe(fakeHandle.result);
  });

  it("does not set mind map data when handle is undefined (no sessions)", async () => {
    mocks.listSessions.mockResolvedValue(undefined);

    await commandOpenLatest(fakeContext);

    expect(mocks.panel.setMindMapData).not.toHaveBeenCalled();
  });
});
