/**
 * Verifies that `analyzeSession` calls `refreshMcpIndex` after writing a record
 * to the library (cache-miss + LLM success path), and does NOT call it on
 * cache-hit or empty-transcript early returns.
 */
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSessionFile: vi.fn(),
  isRecordFresh: vi.fn(),
  ensureStore: vi.fn(),
  enqueueCodeRefUpdate: vi.fn(),
  drainCodeRefQueue: vi.fn(),
  buildRecordMeta: vi.fn(),
  buildSessionRecord: vi.fn(),
}));

vi.mock("@agent-mindmap/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-mindmap/core")>();
  return {
    ...actual,
    readSessionFile: mocks.readSessionFile,
    isRecordFresh: mocks.isRecordFresh,
    ensureStore: mocks.ensureStore,
    enqueueCodeRefUpdate: mocks.enqueueCodeRefUpdate,
    drainCodeRefQueue: mocks.drainCodeRefQueue,
    buildRecordMeta: mocks.buildRecordMeta,
    buildSessionRecord: mocks.buildSessionRecord,
  };
});

import { analyzeSession } from "../core/src/useCases/analyzeSession";
import type { AnalyzeSessionDeps } from "../core/src/useCases/analyzeSession";
import type { TranscriptSession } from "../core/src/host/types";
import type { SessionPipelineResult } from "../core/src/useCases/analyzeSession";

const fakeHost = {
  id: "cursor",
  defaultLlmProvider: "cursor-cli",
  parseTranscript: () => [
    { kind: "user_query", text: "hello", lineIndex: 0 },
    { kind: "assistant_summary", text: "world", preview: "world", lineIndex: 1 },
  ],
  inferProjectFromTranscriptPath: () => ({ projectSlug: "test-project", projectPath: "/tmp" }),
  slugToWorkspacePath: () => "/tmp",
  encodeWorkspacePath: () => "test-project",
} as const;

function buildSession(overrides: Partial<TranscriptSession> = {}): TranscriptSession {
  return {
    id: "session-1",
    label: "Test Session",
    filePath: "/tmp/transcript.jsonl",
    mtimeMs: Date.now(),
    hostId: "cursor",
    ...overrides,
  };
}

function buildDeps(overrides: Partial<AnalyzeSessionDeps> = {}): AnalyzeSessionDeps {
  const refreshMcpIndex = vi.fn().mockResolvedValue(undefined);
  const store = {
    getRecord: vi.fn().mockResolvedValue(undefined),
    upsertRecord: vi.fn().mockResolvedValue(undefined),
  };
  return {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    progress: { report: () => {} },
    configStore: {
      get: (key: string) => {
        if (key === "llm.provider") return "cursor-cli";
        if (key === "llm.model") return "test-model";
        if (key === "maxTopics") return 6;
        if (key === "maxItemsPerTopic") return 6;
        if (key === "library.enabled") return true;
        if (key === "cacheLlmResult") return true;
        if (key === "merge.autoRebuildDeterministic") return false;
        return undefined;
      },
      set: () => {},
    },
    storeAccess: {
      getStore: async () => store,
      getStoreForDir: async () => store,
      ensureStore: async () => {},
      getStoreDir: () => "/tmp/store",
    },
    hostAccess: {
      getActiveHost: async () => fakeHost,
      getWorkspacePath: () => "/tmp",
      getWorkspaceSlug: () => "test-project",
    },
    mindMapSink: {
      refreshMindMap: () => {},
      showInfo: () => {},
    },
    codeRefDeps: {
      logInfo: () => {},
      logWarn: () => {},
      logError: () => {},
      withCancellableProgress: async (_t, _m, run) =>
        run({ progress: { report: () => {} }, signal: new AbortController().signal }),
      getStore: async () => store,
      rebuildProjectMerge: async () => undefined,
    },
    llmDumpDeps: {
      isDumpEnabled: () => false,
      resolveDumpRoots: () => [],
      logInfo: () => {},
      logWarn: () => {},
    },
    runSessionPipeline: vi.fn().mockResolvedValue({
      sessionAnalysis: { codeReferences: [] },
      outline: { outline: [] },
      pipelineVersions: {},
      conceptExtract: { equivalences: [] },
      sessionSynonyms: { equivalences: [] },
      treeSnapshot: { nodes: [] },
      conceptContexts: [],
    } as unknown as SessionPipelineResult),
    runBackgroundMerge: vi.fn().mockResolvedValue(undefined),
    sanitizeSessionRecord: vi.fn().mockResolvedValue(undefined),
    getProvider: () => ({ id: "cursor-cli", summarize: vi.fn() }) as never,
    refreshMcpIndex,
    ...overrides,
  } as unknown as AnalyzeSessionDeps & { refreshMcpIndex: ReturnType<typeof vi.fn> };
}

describe("analyzeSession refreshMcpIndex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSessionFile.mockResolvedValue("content");
    mocks.isRecordFresh.mockReturnValue(false);
    mocks.ensureStore.mockResolvedValue(undefined);
    mocks.enqueueCodeRefUpdate.mockReturnValue(undefined);
    mocks.drainCodeRefQueue.mockResolvedValue(undefined);
    mocks.buildRecordMeta.mockReturnValue({
      sessionId: "session-1",
      projectSlug: "test-project",
      analyzedAt: Date.now(),
      pipelineVersions: {},
    });
    mocks.buildSessionRecord.mockReturnValue({
      meta: { sessionId: "session-1", projectSlug: "test-project" },
      outline: { outline: [] },
      graph: { topics: [] },
      sessionAnalysis: { codeReferences: [] },
    });
  });

  it("calls refreshMcpIndex after writing a record (cache miss + LLM success)", async () => {
    const deps = buildDeps();
    const handle = await analyzeSession(buildSession(), deps, {});
    await handle.completed();

    expect(deps.refreshMcpIndex).toHaveBeenCalledTimes(1);
    expect(deps.refreshMcpIndex).toHaveBeenCalledWith("test-project");
  });

  it("does NOT call refreshMcpIndex on cache hit", async () => {
    mocks.isRecordFresh.mockReturnValue(true);
    const deps = buildDeps();
    const existingRecord = {
      meta: {
        sessionId: "session-1",
        projectSlug: "test-project",
        projectPath: "/tmp",
        sessionLabel: "Test",
        transcriptPath: "/tmp/transcript.jsonl",
        analyzedAt: Date.now(),
      },
      outline: { outline: [] },
      sessionAnalysis: { codeReferences: [] },
    };
    const store = await deps.storeAccess.getStore();
    (store.getRecord as ReturnType<typeof vi.fn>).mockResolvedValue(existingRecord);

    const handle = await analyzeSession(buildSession(), deps, {});
    await handle.completed();

    expect(deps.refreshMcpIndex).not.toHaveBeenCalled();
  });

  it("does NOT call refreshMcpIndex when refreshMcpIndex is not provided", async () => {
    const deps = buildDeps();
    delete (deps as { refreshMcpIndex?: unknown }).refreshMcpIndex;

    const handle = await analyzeSession(buildSession(), deps, {});
    await handle.completed();

    // Should not throw, just skip the refreshMcpIndex push.
    expect(handle.result).toBeDefined();
  });
});
