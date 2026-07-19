/**
 * Integration test for virtual session incremental analysis.
 *
 * Exercises the full `analyzeSession` flow with REAL virtual-session logic
 * (no mocking of `computeTurnHashes` / `detectTurnDelta` / `buildRecordMeta` /
 * `buildSessionRecord`) - only I/O (`readSessionFile`, `ensureStore`, code-ref
 * queue) and the LLM pipeline are mocked.
 *
 * Verifies the three key scenarios:
 * 1. Session grows (append) -> a new virtual session is created, original unchanged
 * 2. Cache hit returns merged view when virtual sessions exist
 * 3. Session shrunk (deletion) -> falls back to full re-analysis (no virtual session)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSessionFile: vi.fn(),
  ensureStore: vi.fn(),
  enqueueCodeRefUpdate: vi.fn(),
  drainCodeRefQueue: vi.fn(),
}));

vi.mock("@agent-mindmap/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-mindmap/core")>();
  return {
    ...actual,
    readSessionFile: mocks.readSessionFile,
    ensureStore: mocks.ensureStore,
    enqueueCodeRefUpdate: mocks.enqueueCodeRefUpdate,
    drainCodeRefQueue: mocks.drainCodeRefQueue,
  };
});

import { analyzeSession } from "../core/src/useCases/analyzeSession";
import { currentPipelineVersions } from "../core/src/pipeline/pipelineVersions";
import type {
  AnalyzeSessionDeps,
  SessionPipelineResult,
} from "../core/src/useCases/analyzeSession";
import type { TranscriptSession } from "../core/src/host/types";
import type { ChatEvent } from "../core/src/transcript/types";
import type { SessionRecord, Store } from "@agent-mindmap/shared";

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildEvents(turnCount: number): ChatEvent[] {
  const events: ChatEvent[] = [];
  let lineIndex = 0;
  for (let i = 0; i < turnCount; i++) {
    events.push({ kind: "user_query", text: `Query ${i + 1}`, lineIndex: lineIndex++ });
    events.push({
      kind: "tool",
      name: `tool_${i}`,
      label: `Tool ${i}`,
      lineIndex: lineIndex++,
      filePaths: [],
    });
    events.push({
      kind: "assistant_summary",
      text: `Summary ${i + 1}`,
      preview: `Summary ${i + 1}`,
      lineIndex: lineIndex++,
    });
  }
  return events;
}

function makeHost(events: ChatEvent[]) {
  return {
    id: "cursor" as const,
    defaultLlmProvider: "cursor-cli" as const,
    parseTranscript: () => events,
    inferProjectFromTranscriptPath: () => ({ projectSlug: "test-project", projectPath: "/tmp" }),
    slugToWorkspacePath: () => "/tmp",
    encodeWorkspacePath: () => "test-project",
  };
}

type InMemoryStore = Store & {
  records: Map<string, SessionRecord>;
  upserts: SessionRecord[];
};

function makeInMemoryStore(): InMemoryStore {
  const records = new Map<string, SessionRecord>();
  const upserts: SessionRecord[] = [];
  const store = {
    records,
    upserts,
    async getRecord(_slug: string, sessionId: string) {
      return records.get(sessionId);
    },
    async upsertRecord(record: SessionRecord) {
      records.set(record.meta.sessionId, record);
      upserts.push(record);
    },
    async listRecordsForProject(slug: string) {
      return [...records.values()].filter((r) => r.meta.projectSlug === slug);
    },
  };
  return store as unknown as InMemoryStore;
}

function buildDeps(store: Store, runSessionPipeline: ReturnType<typeof vi.fn>): AnalyzeSessionDeps {
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
      getActiveHost: async () => null,
      getWorkspacePath: () => "/tmp",
      getWorkspaceSlug: () => "test-project",
    },
    mindMapSink: { refreshMindMap: () => {}, showInfo: () => {} },
    codeRefDeps: {
      logInfo: () => {},
      logWarn: () => {},
      logError: () => {},
      withCancellableProgress: async (_t: string, _m: string, run: any) =>
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
    runSessionPipeline,
    runBackgroundMerge: vi.fn().mockResolvedValue(undefined),
    sanitizeSessionRecord: vi.fn(),
    getProvider: () => ({ id: "cursor-cli", summarize: vi.fn() }) as never,
  } as unknown as AnalyzeSessionDeps;
}

function buildSession(): TranscriptSession {
  return {
    id: "sess-1",
    label: "Test Session",
    filePath: "/tmp/t.jsonl",
    mtimeMs: Date.now(),
    hostId: "cursor",
  };
}

function fakePipelineResult(): SessionPipelineResult {
  return {
    sessionAnalysis: {
      codeReferences: [],
      domains: [],
      nodes: [],
      segmentEquivalences: [],
      termAliases: [],
      outline: {
        title: "Outline",
        outline: [{ title: "Topic", details: [{ text: "detail", sourceTurnIndices: [0] }] }],
      },
    },
    outline: {
      title: "Outline",
      outline: [{ title: "Topic", details: [{ text: "detail", sourceTurnIndices: [0] }] }],
    },
    pipelineVersions: currentPipelineVersions(),
    conceptExtract: { equivalences: [] },
    sessionSynonyms: { equivalences: [] },
    treeSnapshot: { nodes: [] },
    conceptContexts: [],
  } as unknown as SessionPipelineResult;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("virtual session incremental analysis (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSessionFile.mockResolvedValue("content");
    mocks.ensureStore.mockResolvedValue(undefined);
    mocks.enqueueCodeRefUpdate.mockReturnValue(undefined);
    mocks.drainCodeRefQueue.mockResolvedValue(undefined);
  });

  it("creates a virtual session when a session grows (append delta)", async () => {
    const store = makeInMemoryStore();
    const pipelineCalls: Parameters<ReturnType<typeof vi.fn>>[0][] = [];
    const runSessionPipeline = vi.fn().mockImplementation(async (opts: unknown) => {
      pipelineCalls.push(opts as Parameters<ReturnType<typeof vi.fn>>[0]);
      return fakePipelineResult();
    });

    const session = buildSession();

    // ── Run 1: 3-turn session, no existing record -> original analysis ────
    const events3 = buildEvents(3);
    const deps3 = buildDeps(store, runSessionPipeline);
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);

    const handle1 = await analyzeSession(session, deps3, {});
    await handle1.completed();

    // Verify run 1: original record written, no virtual session
    expect(pipelineCalls).toHaveLength(1);
    expect(pipelineCalls[0]!.virtualSession).toBeUndefined();
    expect(pipelineCalls[0]!.events).toHaveLength(9); // 3 turns × 3 events

    const original = store.records.get("sess-1");
    expect(original).toBeDefined();
    expect(original!.meta.turnHashes).toHaveLength(3);
    expect(original!.meta.parentSessionId).toBeUndefined();
    expect(original!.meta.virtualSessionIndex).toBeUndefined();

    // ── Run 2: 5-turn session (same first 3 + 2 new), existing record ────
    const events5 = buildEvents(5); // Query 1..5, first 3 match events3
    const deps5 = buildDeps(store, runSessionPipeline);
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);

    const handle2 = await analyzeSession(session, deps5, {});
    await handle2.completed();

    // Verify run 2: virtual session path triggered
    expect(pipelineCalls).toHaveLength(2);
    expect(pipelineCalls[1]!.virtualSession).toBeDefined();
    expect(pipelineCalls[1]!.virtualSession.startTurnIndex).toBe(3);
    // Pipeline saw only the 2 new turns (6 events)
    expect(pipelineCalls[1]!.events).toHaveLength(6);

    // Virtual session record written
    const virtual = store.records.get("sess-1#v1");
    expect(virtual).toBeDefined();
    expect(virtual!.meta.parentSessionId).toBe("sess-1");
    expect(virtual!.meta.virtualSessionIndex).toBe(1);
    expect(virtual!.meta.startTurnIndex).toBe(3);
    expect(virtual!.meta.endTurnIndex).toBe(5);
    expect(virtual!.meta.turnHashes).toHaveLength(2);

    // Original record UNCHANGED - turnHashes still 3, no parent
    const originalAfter = store.records.get("sess-1");
    expect(originalAfter!.meta.turnHashes).toHaveLength(3);
    expect(originalAfter!.meta.parentSessionId).toBeUndefined();
  });

  it("returns merged view on cache hit when virtual sessions exist", async () => {
    const store = makeInMemoryStore();
    const runSessionPipeline = vi.fn().mockResolvedValue(fakePipelineResult());

    const session = buildSession();

    // ── Run 1: analyze 3-turn session ─────────────────────────────────────
    const events3 = buildEvents(3);
    const deps3 = buildDeps(store, runSessionPipeline);
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps3, {})).completed();

    // ── Run 2: grow to 5 turns -> creates virtual session #v1 ────────────
    const events5 = buildEvents(5);
    const deps5 = buildDeps(store, runSessionPipeline);
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    await (await analyzeSession(session, deps5, {})).completed();

    expect(store.records.has("sess-1#v1")).toBe(true);

    // ── Run 3: same 5-turn session, no change -> cache hit ───────────────
    // isRecordFresh should return true (same token "15", same pipeline).
    // Cache hit path calls readMergedSessionRecord, so the returned mind map
    // should reflect both the original and the virtual session outlines.
    const deps6 = buildDeps(store, runSessionPipeline);
    (deps6.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    const handle3 = await analyzeSession(session, deps6, {});

    // Pipeline should NOT have been called again (cache hit)
    expect(runSessionPipeline).toHaveBeenCalledTimes(2);
    // Result should be topic-based (from library), not turn fallback
    expect(handle3.result.source).toBe("topic");
    expect(handle3.result.fromLibrary).toBe(true);
  });

  it("falls back to full re-analysis when turns were deleted (edit delta)", async () => {
    const store = makeInMemoryStore();
    const pipelineCalls: Parameters<ReturnType<typeof vi.fn>>[0][] = [];
    const runSessionPipeline = vi.fn().mockImplementation(async (opts: unknown) => {
      pipelineCalls.push(opts as Parameters<ReturnType<typeof vi.fn>>[0]);
      return fakePipelineResult();
    });

    const session = buildSession();

    // ── Run 1: 5-turn session ─────────────────────────────────────────────
    const events5 = buildEvents(5);
    const deps3 = buildDeps(store, runSessionPipeline);
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    await (await analyzeSession(session, deps3, {})).completed();

    const original = store.records.get("sess-1")!;
    expect(original.meta.turnHashes).toHaveLength(5);

    // ── Run 2: shrink to 3 turns (deleted 2) -> edit delta ──────────────
    const events3 = buildEvents(3);
    const deps5 = buildDeps(store, runSessionPipeline);
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps5, {})).completed();

    // Pipeline called with full events (not sliced), no virtual session option
    expect(pipelineCalls).toHaveLength(2);
    expect(pipelineCalls[1]!.virtualSession).toBeUndefined();
    expect(pipelineCalls[1]!.events).toHaveLength(9); // full 3 turns × 3 events

    // No virtual session created
    expect(store.records.has("sess-1#v1")).toBe(false);

    // Original record overwritten with new full analysis (3 turns)
    const rewritten = store.records.get("sess-1")!;
    expect(rewritten.meta.turnHashes).toHaveLength(3);
    expect(rewritten.meta.parentSessionId).toBeUndefined();
  });
});
