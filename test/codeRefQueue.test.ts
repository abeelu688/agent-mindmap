import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmProviderError } from "../extension/src/llm/types";
import type { CodeReference } from "../extension/src/llm/types";
import type { ChatEvent } from "../extension/src/transcript/types";

const mocks = vi.hoisted(() => ({
  extractMock: vi.fn(),
  readRecordMock: vi.fn(),
  writeRecordMock: vi.fn(),
}));

vi.mock("../extension/src/llm/extractCodeReferences", () => ({
  extractCodeReferencesFromEvents: mocks.extractMock,
}));

vi.mock("../extension/src/store/sessionStore", () => ({
  conceptTrieMergePath: vi.fn(() => "/tmp/merge.json"),
  listRecords: vi.fn().mockResolvedValue([]),
  readRecord: mocks.readRecordMock,
  writeRecord: mocks.writeRecordMock,
  writeMergeRecord: vi.fn(),
}));

vi.mock("../extension/src/webview/MindMapPanel", () => ({
  MindMapPanel: {
    getCurrent: vi.fn(() => undefined),
  },
}));

import {
  CODE_REF_MAX_ATTEMPTS,
  __testing,
  drainCodeRefQueue,
  enqueueCodeRefUpdate,
  type CodeRefQueueItem,
} from "../extension/src/codeRefQueue";

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

describe("codeRefQueue runItem retries", () => {
  beforeEach(() => {
    __testing.resetQueueState();
    mocks.extractMock.mockReset();
    mocks.readRecordMock.mockReset();
    mocks.writeRecordMock.mockReset();
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
    const written = mocks.writeRecordMock.mock.calls[0]?.[1];
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
    const written = mocks.writeRecordMock.mock.calls[0]?.[1];
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
    const written = mocks.writeRecordMock.mock.calls[0]?.[1];
    expect(written.sessionAnalysis.codeReferences[0]?.llmStatus).toBe("failed");
  });
});
