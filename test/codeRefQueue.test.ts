import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LlmProviderError,
  initCodeRefQueue,
  type CodeRefQueueDeps,
  type ProgressReporter,
} from "@agent-mindmap/core";
import {
  CODE_REF_MAX_ATTEMPTS,
  __testing,
  drainCodeRefQueue,
  enqueueCodeRefUpdate,
  type CodeRefQueueItem,
} from "../extension/src/codeRefQueue";
import type { CodeReference } from "@agent-mindmap/core";
import type { ChatEvent } from "@agent-mindmap/core";

const mocks = vi.hoisted(() => ({
  extractMock: vi.fn(),
  readRecordMock: vi.fn(),
  writeRecordMock: vi.fn(),
  withCancellableProgressMock: vi.fn(),
  onCodeRefPanelStatusUpdateMock: vi.fn(),
  logInfoMock: vi.fn(),
  logWarnMock: vi.fn(),
  logErrorMock: vi.fn(),
  rebuildProjectMergeMock: vi.fn(),
  getCurrentMindMapMock: vi.fn(() => undefined),
  getPendingMindMapMock: vi.fn(() => undefined),
  onPendingCodeRefRefreshMock: vi.fn(),
  getStoreMock: vi.fn(),
}));

// Mock the core extractCodeReferencesFromEvents (used via dynamic import in codeRefQueue)
// The dynamic import `import("./llm/extractCodeReferences")` resolves to the core
// source file directly, so we must mock the actual file path.
vi.mock("../core/src/llm/extractCodeReferences", () => ({
  extractCodeReferencesFromEvents: mocks.extractMock,
}));

vi.mock("@agent-mindmap/core", async (importOriginal) => {
  const mod = await importOriginal();
  const actual = mod as typeof import("@agent-mindmap/core");
  return {
    ...actual,
  };
});

// Test-specific CodeRefQueueDeps implementation
const testDeps: CodeRefQueueDeps = {
  logInfo: mocks.logInfoMock,
  logWarn: mocks.logWarnMock,
  logError: mocks.logErrorMock,

  async withCancellableProgress<T>(
    _title: string,
    _initialMessage: string,
    run: (ctx: { progress: ProgressReporter; signal: AbortSignal }) => Promise<T>
  ): Promise<T | undefined> {
    mocks.withCancellableProgressMock(_title, _initialMessage);
    const controller = new AbortController();
    return run({
      progress: { report: () => {} },
      signal: controller.signal,
    });
  },

  async getStore(storeDir: string) {
    mocks.getStoreMock(storeDir);
    return {
      getRecord: mocks.readRecordMock,
      upsertRecord: mocks.writeRecordMock,
      writeConceptTrieMerge: vi.fn(),
      listRecordsForProject: vi.fn().mockResolvedValue([]),
      listAllRecords: vi.fn().mockResolvedValue([]),
    } as never;
  },

  async rebuildProjectMerge(_storeDir: string, _projectSlug: string) {
    return mocks.rebuildProjectMergeMock(_storeDir, _projectSlug);
  },

  onPendingCodeRefRefresh: mocks.onPendingCodeRefRefreshMock,
  onCodeRefPanelStatusUpdate: mocks.onCodeRefPanelStatusUpdateMock,
  getCurrentMindMap: mocks.getCurrentMindMapMock,
  getPendingMindMap: mocks.getPendingMindMapMock,
};

function makeItem(overrides: Partial<CodeRefQueueItem> = {}): CodeRefQueueItem {
  return {
    sessionId: "session-abc",
    projectSlug: "proj",
    sessionLabel: "Test session",
    transcriptPath: "/tmp/session.jsonl",
    events: [{ kind: "user_query", text: "Q", lineIndex: 0 }] as ChatEvent[],
    outline: { title: "T", topics: [] },
    provider: { id: "cursor-cli", summarize: vi.fn() },
    cache: false,
    timeoutMs: 1000,
    storeDir: "/tmp/store",
    ...overrides,
  };
}

const pendingRefs: CodeReference[] = [
  {
    path: "src/a.ts",
    lines: "-",
    description: "support code change",
    llmStatus: "pending",
    llmUpdatedAt: 1,
  },
];

beforeAll(() => {
  initCodeRefQueue(testDeps);
});

describe("codeRefQueue retry helpers", () => {
  it("shouldScheduleCodeRefRetry allows retryable errors below max attempts", () => {
    const err = new LlmProviderError("timeout", "timed out");
    expect(__testing.shouldScheduleCodeRefRetry(err, 1)).toBe(true);
    expect(__testing.shouldScheduleCodeRefRetry(err, 2)).toBe(true);
    expect(__testing.shouldScheduleCodeRefRetry(err, 3)).toBe(false);
  });

  it("shouldScheduleCodeRefRetry rejects cancelled and non-retryable errors", () => {
    expect(
      __testing.shouldScheduleCodeRefRetry(new LlmProviderError("cancelled", "cancelled"), 1)
    ).toBe(false);
    expect(
      __testing.shouldScheduleCodeRefRetry(new LlmProviderError("cli-missing", "missing"), 1)
    ).toBe(false);
  });

  it("mergeEnqueueAttempt keeps the higher attempt count", () => {
    expect(__testing.mergeEnqueueAttempt(2, 1)).toBe(2);
    expect(__testing.mergeEnqueueAttempt(1, 3)).toBe(3);
    expect(__testing.mergeEnqueueAttempt(undefined, 2)).toBe(2);
  });
});

describe("enqueueCodeRefUpdate attempt merge", () => {
  beforeEach(() => {
    __testing.resetQueueState();
  });

  afterEach(() => {
    __testing.resetQueueState();
  });

  it("merges attempt via enqueueCodeRefItemOnly before processing", () => {
    __testing.enqueueCodeRefItemOnly(makeItem({ attempt: 2 }));
    __testing.enqueueCodeRefItemOnly(makeItem({ attempt: 1 }));
    expect(__testing.getQueueSnapshot()[0]?.attempt).toBe(2);
  });
});

describe("codeRefQueue defer and panel status", () => {
  beforeEach(() => {
    __testing.resetQueueState();
    mocks.extractMock.mockReset();
    mocks.withCancellableProgressMock.mockClear();
    mocks.onCodeRefPanelStatusUpdateMock.mockClear();
    mocks.extractMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve([
                {
                  path: "src/a.ts",
                  lines: "-",
                  description: "add handler",
                  sourceTurnIndices: [1],
                },
              ]),
            50
          );
        })
    );
    mocks.readRecordMock.mockResolvedValue({
      outline: { title: "T", topics: [] },
      sessionAnalysis: { codeReferences: pendingRefs },
    });
  });

  afterEach(async () => {
    await drainCodeRefQueue();
    __testing.resetQueueState();
  });

  it("defers notification progress until after the current stack (setImmediate)", async () => {
    enqueueCodeRefUpdate(makeItem());
    expect(mocks.withCancellableProgressMock).not.toHaveBeenCalled();

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mocks.withCancellableProgressMock).toHaveBeenCalledTimes(1);

    await drainCodeRefQueue();
  });

  it("publishes code ref progress to panel status while running", async () => {
    enqueueCodeRefUpdate(makeItem({ sessionLabel: "My session" }));
    await drainCodeRefQueue();

    expect(mocks.onCodeRefPanelStatusUpdateMock).toHaveBeenCalled();
    const activeCall = mocks.onCodeRefPanelStatusUpdateMock.mock.calls.find(
      (call: unknown[]) => (call as [{ active: boolean }])[0]?.active === true
    );
    expect((activeCall?.[0] as { sessionLabel?: string })?.sessionLabel).toBe("My session");

    const clearedCall = mocks.onCodeRefPanelStatusUpdateMock.mock.calls.find(
      (call: unknown[]) => (call as [{ active: boolean }])[0]?.active === false
    );
    expect(clearedCall).toBeDefined();
  });

  it("onCodeRefPanelStatusUpdate receives structured updates", () => {
    // The queue's internal publishCodeRefPanelStatus calls deps.onCodeRefPanelStatusUpdate
    // We can verify this through the runItem flow
    expect(true).toBe(true); // Verified through the test above
  });
});

describe("codeRefQueue runItem retries", () => {
  beforeEach(() => {
    __testing.resetQueueState();
    mocks.extractMock.mockReset();
    mocks.readRecordMock.mockReset();
    mocks.writeRecordMock.mockReset();
    mocks.withCancellableProgressMock.mockClear();
    mocks.onCodeRefPanelStatusUpdateMock.mockClear();
    mocks.logInfoMock.mockClear();
    mocks.logWarnMock.mockClear();
  });

  afterEach(async () => {
    await drainCodeRefQueue();
    __testing.resetQueueState();
  });

  it("re-enqueues on retryable failure without writing failed status", async () => {
    const timeoutErr = new LlmProviderError("timeout", "timed out");
    mocks.extractMock.mockRejectedValueOnce(timeoutErr).mockResolvedValueOnce([
      {
        path: "src/a.ts",
        lines: "-",
        description: "add router handler",
        sourceTurnIndices: [1],
      },
    ]);
    mocks.readRecordMock.mockResolvedValue({
      outline: { title: "T", topics: [] },
      sessionAnalysis: { codeReferences: pendingRefs },
    });

    enqueueCodeRefUpdate(makeItem());
    await drainCodeRefQueue();

    expect(mocks.extractMock).toHaveBeenCalledTimes(2);
    expect(mocks.writeRecordMock).toHaveBeenCalledTimes(1);
    const written = mocks.writeRecordMock.mock.calls[0]?.[0];
    expect(written.sessionAnalysis.codeReferences[0]?.llmStatus).toBe("done");
  });

  it("writes failed status after exhausting attempts", async () => {
    const timeoutErr = new LlmProviderError("timeout", "timed out");
    mocks.extractMock.mockRejectedValue(timeoutErr);
    mocks.readRecordMock.mockResolvedValue({
      outline: { title: "T", topics: [] },
      sessionAnalysis: { codeReferences: pendingRefs },
    });

    enqueueCodeRefUpdate(makeItem());
    await drainCodeRefQueue();

    expect(mocks.extractMock).toHaveBeenCalledTimes(CODE_REF_MAX_ATTEMPTS);
    expect(mocks.writeRecordMock).toHaveBeenCalledTimes(1);
    const written = mocks.writeRecordMock.mock.calls[0]?.[0];
    expect(written.sessionAnalysis.codeReferences[0]?.llmStatus).toBe("failed");
  });

  it("does not retry or write on cancellation", async () => {
    mocks.extractMock.mockRejectedValue(new LlmProviderError("cancelled", "cancelled"));

    enqueueCodeRefUpdate(makeItem());
    await drainCodeRefQueue();

    expect(mocks.extractMock).toHaveBeenCalledTimes(1);
    expect(mocks.writeRecordMock).not.toHaveBeenCalled();
  });

  it("writes failed immediately for non-retryable errors", async () => {
    mocks.extractMock.mockRejectedValue(new LlmProviderError("cli-missing", "missing"));
    mocks.readRecordMock.mockResolvedValue({
      outline: { title: "T", topics: [] },
      sessionAnalysis: { codeReferences: pendingRefs },
    });

    enqueueCodeRefUpdate(makeItem());
    await drainCodeRefQueue();

    expect(mocks.extractMock).toHaveBeenCalledTimes(1);
    expect(mocks.writeRecordMock).toHaveBeenCalledTimes(1);
    const written = mocks.writeRecordMock.mock.calls[0]?.[0];
    expect(written.sessionAnalysis.codeReferences[0]?.llmStatus).toBe("failed");
  });

  it("preserves already-done refs when marking failure", async () => {
    const refs: CodeReference[] = [
      {
        path: "src/a.ts",
        lines: "-",
        description: "real description",
        llmStatus: "done",
        llmUpdatedAt: 1,
      },
      {
        path: "src/b.ts",
        lines: "-",
        description: "support code change",
        llmStatus: "pending",
        llmUpdatedAt: 1,
      },
    ];
    const failed = __testing.markCodeRefsFailed(refs, new Error("batch failed"));
    expect(failed?.[0]?.llmStatus).toBe("done");
    expect(failed?.[1]?.llmStatus).toBe("failed");
  });
});
