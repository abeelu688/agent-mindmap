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
 *
 * Plus deeper coverage:
 * 4. Merged view actually contains content from BOTH original + virtual outlines
 * 5. Multiple consecutive increments create #v1, #v2, ... (not just one)
 * 6. Background merge is invoked with the virtual session's id + parent-tagged record
 * 7. SQLite persistence: records survive store close/reopen
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

import {
  SqliteStore,
  LlmProviderError,
  type CodeReference,
  type SessionRecord,
  type Store,
} from "@agent-mindmap/shared";
import { analyzeSession } from "../core/src/useCases/analyzeSession";
import { currentPipelineVersions } from "../core/src/pipeline/pipelineVersions";
import { setPromptLanguageSettingProvider } from "../core/src/llm/promptLanguage";
import type {
  AnalyzeSessionDeps,
  SessionPipelineResult,
} from "../core/src/useCases/analyzeSession";
import type { TranscriptSession } from "../core/src/host/types";
import type { ChatEvent } from "../core/src/transcript/types";

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

function buildDeps(
  store: Store,
  runSessionPipeline: ReturnType<typeof vi.fn>,
  overrides?: {
    autoRebuildDeterministic?: boolean;
    provider?: string;
    maxTopics?: number;
  }
): AnalyzeSessionDeps {
  return {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    progress: { report: () => {} },
    configStore: {
      get: (key: string) => {
        if (key === "llm.provider") return overrides?.provider ?? "cursor-cli";
        if (key === "llm.model") return "test-model";
        if (key === "maxTopics") return overrides?.maxTopics ?? 6;
        if (key === "maxItemsPerTopic") return 6;
        if (key === "library.enabled") return true;
        if (key === "cacheLlmResult") return true;
        if (key === "merge.autoRebuildDeterministic")
          return overrides?.autoRebuildDeterministic ?? false;
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

function fakePipelineResult(
  topicTitle: string = "Topic",
  codeRefs: CodeReference[] = []
): SessionPipelineResult {
  return {
    sessionAnalysis: {
      codeReferences: codeRefs,
      domains: [],
      nodes: [],
      segmentEquivalences: [],
      termAliases: [],
      outline: {
        title: "Outline",
        outline: [{ title: topicTitle, details: [{ text: "detail", sourceTurnIndices: [0] }] }],
      },
    },
    outline: {
      title: "Outline",
      outline: [{ title: topicTitle, details: [{ text: "detail", sourceTurnIndices: [0] }] }],
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

  it("merged view contains content from both original and virtual outlines", async () => {
    const store = makeInMemoryStore();
    // Pipeline returns distinguishable topic titles per run so we can verify
    // the merged view actually includes both outlines (not just one).
    const runSessionPipeline = vi
      .fn()
      .mockResolvedValueOnce(fakePipelineResult("Original Topic"))
      .mockResolvedValueOnce(fakePipelineResult("Virtual Topic"));

    const session = buildSession();

    // ── Run 1: 3-turn session, pipeline returns "Original Topic" ─────────
    const events3 = buildEvents(3);
    const deps3 = buildDeps(store, runSessionPipeline);
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps3, {})).completed();

    // ── Run 2: 5-turn session -> virtual #v1 with "Virtual Topic" ───────
    const events5 = buildEvents(5);
    const deps5 = buildDeps(store, runSessionPipeline);
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    await (await analyzeSession(session, deps5, {})).completed();

    // ── Run 3: same 5-turn session -> cache hit returns merged view ──────
    const deps6 = buildDeps(store, runSessionPipeline);
    (deps6.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    const handle3 = await analyzeSession(session, deps6, {});

    // Pipeline not called again on cache hit
    expect(runSessionPipeline).toHaveBeenCalledTimes(2);

    // Merged outline should have 2 top-level branches (Part 1, Part 2)
    const children = handle3.result.mindMap?.children ?? [];
    expect(children.length).toBe(2);
    expect(children[0]!.data.text).toBe("Part 1");
    expect(children[1]!.data.text).toBe("Part 2");

    // Part 1 = original outline (3-turn analysis), Part 2 = virtual (2 new turns)
    const part1Topic = children[0]!.children?.[0]?.data.text;
    const part2Topic = children[1]!.children?.[0]?.data.text;
    expect(part1Topic).toBe("Original Topic");
    expect(part2Topic).toBe("Virtual Topic");
  });

  it("creates #v2 after #v1 when the session grows again (multiple increments)", async () => {
    const store = makeInMemoryStore();
    const pipelineCalls: Parameters<ReturnType<typeof vi.fn>>[0][] = [];
    const runSessionPipeline = vi.fn().mockImplementation(async (opts: unknown) => {
      pipelineCalls.push(opts as Parameters<ReturnType<typeof vi.fn>>[0]);
      return fakePipelineResult();
    });

    const session = buildSession();

    // ── Run 1: 3-turn session -> original record ─────────────────────────
    const events3 = buildEvents(3);
    const deps3 = buildDeps(store, runSessionPipeline);
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps3, {})).completed();

    // ── Run 2: 5-turn session -> virtual #v1 (turns 3..5) ───────────────
    const events5 = buildEvents(5);
    const deps5 = buildDeps(store, runSessionPipeline);
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    await (await analyzeSession(session, deps5, {})).completed();

    expect(store.records.has("sess-1#v1")).toBe(true);
    expect(pipelineCalls[1]!.virtualSession.startTurnIndex).toBe(3);

    // ── Run 3: 7-turn session -> virtual #v2 (turns 5..7) ───────────────
    const events7 = buildEvents(7);
    const deps7 = buildDeps(store, runSessionPipeline);
    (deps7.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events7);
    await (await analyzeSession(session, deps7, {})).completed();

    // Pipeline called a third time for the new delta (2 new turns)
    expect(pipelineCalls).toHaveLength(3);
    expect(pipelineCalls[2]!.virtualSession).toBeDefined();
    expect(pipelineCalls[2]!.virtualSession.startTurnIndex).toBe(5);
    expect(pipelineCalls[2]!.events).toHaveLength(6); // 2 new turns × 3 events

    // #v2 record written with correct meta
    const v2 = store.records.get("sess-1#v2");
    expect(v2).toBeDefined();
    expect(v2!.meta.parentSessionId).toBe("sess-1");
    expect(v2!.meta.virtualSessionIndex).toBe(2);
    expect(v2!.meta.startTurnIndex).toBe(5);
    expect(v2!.meta.endTurnIndex).toBe(7);
    expect(v2!.meta.turnHashes).toHaveLength(2);

    // #v1 still intact (not overwritten by #v2)
    const v1 = store.records.get("sess-1#v1");
    expect(v1).toBeDefined();
    expect(v1!.meta.virtualSessionIndex).toBe(1);
    expect(v1!.meta.startTurnIndex).toBe(3);
    expect(v1!.meta.endTurnIndex).toBe(5);

    // Original still intact
    const original = store.records.get("sess-1")!;
    expect(original.meta.turnHashes).toHaveLength(3);
    expect(original.meta.parentSessionId).toBeUndefined();
  });

  it("invokes background merge with the virtual session id and parent-tagged record", async () => {
    const store = makeInMemoryStore();
    const runSessionPipeline = vi.fn().mockResolvedValue(fakePipelineResult());

    const session = buildSession();

    // ── Run 1: 3-turn session (autoRebuild off for run 1 to isolate) ─────
    const events3 = buildEvents(3);
    const deps3 = buildDeps(store, runSessionPipeline);
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps3, {})).completed();

    // ── Run 2: 5-turn session with autoRebuildDeterministic=true ────────
    // The background merge should be called for the virtual session, not the
    // original - proving batch merge picks up #v1 as a new record.
    const events5 = buildEvents(5);
    const deps5 = buildDeps(store, runSessionPipeline, { autoRebuildDeterministic: true });
    const runBackgroundMerge5 = deps5.runBackgroundMerge as unknown as ReturnType<typeof vi.fn>;
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    await (await analyzeSession(session, deps5, {})).completed();

    // Background merge called exactly once for run 2 (run 1 had autoRebuild off)
    expect(runBackgroundMerge5).toHaveBeenCalledTimes(1);
    const mergeArg = runBackgroundMerge5.mock.calls[0]![0] as {
      sessionId: string;
      record: SessionRecord;
    };
    // Called with the virtual session id, NOT the original session id
    expect(mergeArg.sessionId).toBe("sess-1#v1");
    expect(mergeArg.record.meta.sessionId).toBe("sess-1#v1");
    expect(mergeArg.record.meta.parentSessionId).toBe("sess-1");
    expect(mergeArg.record.meta.virtualSessionIndex).toBe(1);
    // Events passed to background merge are the delta events (2 new turns)
    expect(mergeArg.events).toHaveLength(6);
  });

  it("forceRefresh: true bypasses virtual session detection and does full re-analysis", async () => {
    const store = makeInMemoryStore();
    const pipelineCalls: Parameters<ReturnType<typeof vi.fn>>[0][] = [];
    const runSessionPipeline = vi.fn().mockImplementation(async (opts: unknown) => {
      pipelineCalls.push(opts as Parameters<ReturnType<typeof vi.fn>>[0]);
      return fakePipelineResult();
    });

    const session = buildSession();

    // ── Run 1: 3-turn session -> original record ─────────────────────────
    const events3 = buildEvents(3);
    const deps3 = buildDeps(store, runSessionPipeline);
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps3, {})).completed();

    expect(store.records.get("sess-1")!.meta.turnHashes).toHaveLength(3);

    // ── Run 2: 5-turn session with forceRefresh ─────────────────────────
    // Should NOT create a virtual session. Should overwrite original with full
    // 5-turn analysis. The `!options.forceRefresh` guards at lines 384 and 486
    // skip both the cache-hit path and the virtual-session detection path.
    const events5 = buildEvents(5);
    const deps5 = buildDeps(store, runSessionPipeline);
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    await (await analyzeSession(session, deps5, { forceRefresh: true })).completed();

    // Pipeline called with full 15 events, no virtualSession option
    expect(pipelineCalls).toHaveLength(2);
    expect(pipelineCalls[1]!.virtualSession).toBeUndefined();
    expect(pipelineCalls[1]!.events).toHaveLength(15); // full 5 turns × 3 events

    // No virtual session created
    expect(store.records.has("sess-1#v1")).toBe(false);

    // Original record overwritten with 5-turn analysis
    const rewritten = store.records.get("sess-1")!;
    expect(rewritten.meta.turnHashes).toHaveLength(5);
    expect(rewritten.meta.parentSessionId).toBeUndefined();
  });

  it("falls back to turn view when LLM fails during virtual session analysis", async () => {
    const store = makeInMemoryStore();
    const runSessionPipeline = vi
      .fn()
      .mockResolvedValueOnce(fakePipelineResult()) // run 1 succeeds
      .mockRejectedValueOnce(new LlmProviderError("cli-failed", "boom")); // run 2 fails

    const session = buildSession();

    // ── Run 1: 3-turn session -> original record ─────────────────────────
    const events3 = buildEvents(3);
    const deps3 = buildDeps(store, runSessionPipeline);
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps3, {})).completed();

    const original = store.records.get("sess-1")!;
    expect(original.meta.turnHashes).toHaveLength(3);

    // ── Run 2: 5-turn session, pipeline throws -> turn fallback ──────────
    const events5 = buildEvents(5);
    const deps5 = buildDeps(store, runSessionPipeline);
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    const handle2 = await analyzeSession(session, deps5, {});

    // Result is turn fallback, not topic
    expect(handle2.result.source).toBe("turn");
    expect(handle2.result.llmErrorCode).toBe("cli-failed");

    // No virtual session record written (LLM failed before record write)
    expect(store.records.has("sess-1#v1")).toBe(false);

    // Original record UNCHANGED (not overwritten by failed run)
    const originalAfter = store.records.get("sess-1")!;
    expect(originalAfter.meta.turnHashes).toHaveLength(3);
  });

  it("falls back to full re-analysis when a middle turn is modified (edit delta)", async () => {
    const store = makeInMemoryStore();
    const pipelineCalls: Parameters<ReturnType<typeof vi.fn>>[0][] = [];
    const runSessionPipeline = vi.fn().mockImplementation(async (opts: unknown) => {
      pipelineCalls.push(opts as Parameters<ReturnType<typeof vi.fn>>[0]);
      return fakePipelineResult();
    });

    const session = buildSession();

    // ── Run 1: 5-turn session -> original record with 5 turnHashes ───────
    const events5 = buildEvents(5);
    const deps3 = buildDeps(store, runSessionPipeline);
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    await (await analyzeSession(session, deps3, {})).completed();

    expect(store.records.get("sess-1")!.meta.turnHashes).toHaveLength(5);

    // ── Run 2: delete turn 3 (the middle one) -> edit delta ─────────────
    // buildEvents(5) produces 15 events (5 turns × 3). Removing the 3rd turn
    // (events at indices 6,7,8 = Q3,tool_2,Summary3) leaves 12 events / 4 turns.
    // Event count changes (15->12) so isRecordFresh returns false -> falls
    // through to virtual session detection. detectTurnDelta compares hashes:
    //   stored: [h1,h2,h3,h4,h5]
    //   current: [h1,h2,h4,h5]   (turn 3 removed)
    //   i=0: match, i=1: match, i=2: h3 !== h4 -> kind="edit", startTurnIndex=2
    // Edit delta falls through to full re-analysis (no virtual session).
    const events4 = buildEvents(5).filter((_, idx) => idx < 6 || idx > 8);

    const deps5 = buildDeps(store, runSessionPipeline);
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events4);
    await (await analyzeSession(session, deps5, {})).completed();

    // Pipeline called with full 12 events (not sliced), no virtual session
    expect(pipelineCalls).toHaveLength(2);
    expect(pipelineCalls[1]!.virtualSession).toBeUndefined();
    expect(pipelineCalls[1]!.events).toHaveLength(12);

    // No virtual session created
    expect(store.records.has("sess-1#v1")).toBe(false);

    // Original record overwritten with 4-turn analysis
    const rewritten = store.records.get("sess-1")!;
    expect(rewritten.meta.turnHashes).toHaveLength(4);
    expect(rewritten.meta.parentSessionId).toBeUndefined();
  });

  it("cache hit with no virtual sessions returns the original record unchanged", async () => {
    const store = makeInMemoryStore();
    const runSessionPipeline = vi.fn().mockResolvedValue(fakePipelineResult());

    const session = buildSession();

    // ── Run 1: 3-turn session -> original record (no virtuals) ───────────
    const events3 = buildEvents(3);
    const deps3 = buildDeps(store, runSessionPipeline);
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps3, {})).completed();

    expect(store.records.has("sess-1#v1")).toBe(false);

    // ── Run 2: same 3-turn session -> cache hit, no virtuals to merge ────
    const deps5 = buildDeps(store, runSessionPipeline);
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    const handle2 = await analyzeSession(session, deps5, {});

    // Pipeline not called again (cache hit)
    expect(runSessionPipeline).toHaveBeenCalledTimes(1);
    // Returns topic view from library
    expect(handle2.result.source).toBe("topic");
    expect(handle2.result.fromLibrary).toBe(true);
    // No virtual session was created
    expect(store.records.has("sess-1#v1")).toBe(false);
  });

  it("provider change triggers full re-analysis (not virtual session)", async () => {
    const store = makeInMemoryStore();
    const pipelineCalls: Parameters<ReturnType<typeof vi.fn>>[0][] = [];
    const runSessionPipeline = vi.fn().mockImplementation(async (opts: unknown) => {
      pipelineCalls.push(opts as Parameters<ReturnType<typeof vi.fn>>[0]);
      return fakePipelineResult();
    });

    const session = buildSession();

    // ── Run 1: 3-turn session with cursor-cli ────────────────────────────
    const events3 = buildEvents(3);
    const deps3 = buildDeps(store, runSessionPipeline, { provider: "cursor-cli" });
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps3, {})).completed();

    expect(store.records.get("sess-1")!.meta.llm.provider).toBe("cursor-cli");

    // ── Run 2: same 3-turn session but provider=claude-cli ───────────────
    // isRecordPipelineFresh should return false (provider mismatch) -> full
    // re-analysis. Virtual session path is also skipped because pipelineFresh
    // gates it.
    const deps5 = buildDeps(store, runSessionPipeline, { provider: "claude-cli" });
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps5, {})).completed();

    // Pipeline called again (full re-analysis, not cache hit)
    expect(pipelineCalls).toHaveLength(2);
    expect(pipelineCalls[1]!.virtualSession).toBeUndefined();
    expect(pipelineCalls[1]!.events).toHaveLength(9); // full 3 turns

    // No virtual session
    expect(store.records.has("sess-1#v1")).toBe(false);

    // Original record overwritten with new provider
    const rewritten = store.records.get("sess-1")!;
    expect(rewritten.meta.llm.provider).toBe("claude-cli");
  });

  it("outputLanguage change triggers full re-analysis (not virtual session)", async () => {
    // Save and restore the prompt-language setting provider so this test
    // doesn't leak state into other tests.
    const originalProvider = (globalThis as { __originalLangProvider?: () => string })
      .__originalLangProvider;
    setPromptLanguageSettingProvider(() => "auto");

    try {
      const store = makeInMemoryStore();
      const pipelineCalls: Parameters<ReturnType<typeof vi.fn>>[0][] = [];
      const runSessionPipeline = vi.fn().mockImplementation(async (opts: unknown) => {
        pipelineCalls.push(opts as Parameters<ReturnType<typeof vi.fn>>[0]);
        return fakePipelineResult();
      });

      const session = buildSession();

      // ── Run 1: 3-turn session, language=auto (resolves to English) ─────
      const events3 = buildEvents(3);
      const deps3 = buildDeps(store, runSessionPipeline);
      (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
        async () => makeHost(events3);
      await (await analyzeSession(session, deps3, {})).completed();

      const original = store.records.get("sess-1")!;
      const lang1 = original.meta.outputLanguage;
      expect(lang1).toBeDefined();

      // ── Run 2: same session but language forced to "zh" ─────────────────
      setPromptLanguageSettingProvider(() => "zh");
      const deps5 = buildDeps(store, runSessionPipeline);
      (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
        async () => makeHost(events3);
      await (await analyzeSession(session, deps5, {})).completed();

      // Pipeline called again (full re-analysis, not cache hit)
      expect(pipelineCalls).toHaveLength(2);
      expect(pipelineCalls[1]!.virtualSession).toBeUndefined();
      expect(pipelineCalls[1]!.events).toHaveLength(9);

      // No virtual session
      expect(store.records.has("sess-1#v1")).toBe(false);

      // Original record overwritten with new outputLanguage
      const rewritten = store.records.get("sess-1")!;
      expect(rewritten.meta.outputLanguage).not.toBe(lang1);
    } finally {
      // Restore default - vitest will reset modules between files, but be safe.
      setPromptLanguageSettingProvider(originalProvider ?? (() => "auto"));
    }
  });

  it("maxTopics change triggers full re-analysis (not virtual session)", async () => {
    const store = makeInMemoryStore();
    const pipelineCalls: Parameters<ReturnType<typeof vi.fn>>[0][] = [];
    const runSessionPipeline = vi.fn().mockImplementation(async (opts: unknown) => {
      pipelineCalls.push(opts as Parameters<ReturnType<typeof vi.fn>>[0]);
      return fakePipelineResult();
    });

    const session = buildSession();

    // ── Run 1: 3-turn session with maxTopics=6 ───────────────────────────
    const events3 = buildEvents(3);
    const deps3 = buildDeps(store, runSessionPipeline, { maxTopics: 6 });
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps3, {})).completed();

    expect(store.records.get("sess-1")!.meta.promptParams.maxTopics).toBe(6);

    // ── Run 2: same session but maxTopics=8 ──────────────────────────────
    // isRecordPipelineFresh should return false (promptParams mismatch).
    const deps5 = buildDeps(store, runSessionPipeline, { maxTopics: 8 });
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps5, {})).completed();

    // Pipeline called again (full re-analysis)
    expect(pipelineCalls).toHaveLength(2);
    expect(pipelineCalls[1]!.virtualSession).toBeUndefined();
    expect(pipelineCalls[1]!.events).toHaveLength(9);

    // No virtual session
    expect(store.records.has("sess-1#v1")).toBe(false);

    // Original record overwritten with new maxTopics
    const rewritten = store.records.get("sess-1")!;
    expect(rewritten.meta.promptParams.maxTopics).toBe(8);
  });

  it("merges code refs from original and virtual sessions (deduped by path, original first)", async () => {
    const store = makeInMemoryStore();
    // Use absolute paths under /tmp/ so filterProjectCodeReferences keeps
    // them (relative paths would be filtered out since the files don't exist
    // on disk under projectPath="/tmp").
    const originalRef: CodeReference = {
      path: "/tmp/src/original.ts",
      lines: "1-10",
      description: "Original file",
    };
    const sharedRef: CodeReference = {
      path: "/tmp/src/shared.ts",
      lines: "5-15",
      description: "From original",
    };
    const virtualRef: CodeReference = {
      path: "/tmp/src/virtual.ts",
      lines: "20-30",
      description: "Virtual-only file",
    };
    const virtualDuplicateRef: CodeReference = {
      path: "/tmp/src/shared.ts",
      lines: "99",
      description: "DUPLICATE - should be dropped (original wins)",
    };

    const runSessionPipeline = vi
      .fn()
      .mockResolvedValueOnce(fakePipelineResult("Original Topic", [originalRef, sharedRef]))
      .mockResolvedValueOnce(
        fakePipelineResult("Virtual Topic", [virtualRef, virtualDuplicateRef])
      );

    const session = buildSession();

    // ── Run 1: 3-turn session with [originalRef, sharedRef] ──────────────
    const events3 = buildEvents(3);
    const deps3 = buildDeps(store, runSessionPipeline);
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps3, {})).completed();

    // ── Run 2: 5-turn session -> virtual #v1 with [virtualRef, duplicate sharedRef]
    const events5 = buildEvents(5);
    const deps5 = buildDeps(store, runSessionPipeline);
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    await (await analyzeSession(session, deps5, {})).completed();

    // ── Run 3: cache hit -> merged view should have 3 unique code refs ───
    const deps6 = buildDeps(store, runSessionPipeline);
    (deps6.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    const handle3 = await analyzeSession(session, deps6, {});

    expect(runSessionPipeline).toHaveBeenCalledTimes(2);

    // Verify the merged record's code refs directly via readMergedSessionRecord.
    // This is the same function analyzeSession calls on cache hit.
    const { readMergedSessionRecord } = await import("../core/src/store/virtualSession");
    const merged = await readMergedSessionRecord(
      store as unknown as Store,
      "test-project",
      "sess-1"
    );
    expect(merged).toBeDefined();
    const mergedRefs = merged!.sessionAnalysis?.codeReferences ?? [];
    // 3 unique paths: original.ts, shared.ts, virtual.ts (shared.ts deduped)
    expect(mergedRefs).toHaveLength(3);
    const paths = mergedRefs.map((r) => r.path).sort();
    expect(paths).toEqual(["/tmp/src/original.ts", "/tmp/src/shared.ts", "/tmp/src/virtual.ts"]);
    // shared.ts keeps original's description ("From original"), not the duplicate
    const sharedEntry = mergedRefs.find((r) => r.path === "/tmp/src/shared.ts")!;
    expect(sharedEntry.description).toBe("From original");

    // The mind map should also include the code refs node (3 file branches)
    const children = handle3.result.mindMap?.children ?? [];
    // Find the code refs root node (its children are file paths)
    const codeRefNode = children.find((c) =>
      c.children?.some((cc) => cc.data.text.includes("/tmp/src/"))
    );
    expect(codeRefNode).toBeDefined();
    const codeRefPaths = (codeRefNode!.children ?? []).map((c) => c.data.text);
    expect(codeRefPaths).toHaveLength(3);
    expect(codeRefPaths).toContain("/tmp/src/original.ts");
    expect(codeRefPaths).toContain("/tmp/src/shared.ts");
    expect(codeRefPaths).toContain("/tmp/src/virtual.ts");
  });

  it("passes original session outline as contextPrimer to the virtual session pipeline", async () => {
    const store = makeInMemoryStore();
    const pipelineCalls: Parameters<ReturnType<typeof vi.fn>>[0][] = [];
    const runSessionPipeline = vi
      .fn()
      .mockImplementationOnce(async (opts: unknown) => {
        pipelineCalls.push(opts as Parameters<ReturnType<typeof vi.fn>>[0]);
        return fakePipelineResult("Run 1 Distinctive Topic");
      })
      .mockImplementationOnce(async (opts: unknown) => {
        pipelineCalls.push(opts as Parameters<ReturnType<typeof vi.fn>>[0]);
        return fakePipelineResult("Virtual Topic");
      });

    const session = buildSession();

    // ── Run 1: 3-turn session with a distinctive topic title ─────────────
    const events3 = buildEvents(3);
    const deps3 = buildDeps(store, runSessionPipeline);
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps3, {})).completed();

    // ── Run 2: 5-turn session -> virtual #v1 ─────────────────────────────
    const events5 = buildEvents(5);
    const deps5 = buildDeps(store, runSessionPipeline);
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    await (await analyzeSession(session, deps5, {})).completed();

    // Verify the virtual session pipeline call received a contextPrimer
    expect(pipelineCalls).toHaveLength(2);
    const virtualCall = pipelineCalls[1]!;
    expect(virtualCall.virtualSession).toBeDefined();
    const primer = virtualCall.virtualSession.contextPrimer;
    // Primer should carry the original session label
    expect(primer.originalSessionLabel).toBe("Test Session");
    // virtualSessionIndex for the first virtual is 1
    expect(primer.virtualSessionIndex).toBe(1);
    // priorTopics should include the distinctive topic from run 1
    expect(primer.priorTopics).toBeDefined();
    const topicTitles = primer.priorTopics.map((t: { title: string }) => t.title);
    expect(topicTitles).toContain("Run 1 Distinctive Topic");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// SQLite persistence: verify virtual session records survive store close/reopen
// ────────────────────────────────────────────────────────────────────────────

describe("virtual session SQLite persistence", () => {
  let tmpRoot: string;
  let storeDir: string;
  let sqliteStore: SqliteStore;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amm-virtual-"));
    storeDir = path.join(tmpRoot, "store");
    fs.mkdirSync(storeDir, { recursive: true });
    sqliteStore = new SqliteStore(path.join(storeDir, "store.db"));
    await sqliteStore.listProjectSummaries(); // force open
  });

  afterEach(async () => {
    await sqliteStore.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("persists original and virtual session records across store close/reopen", async () => {
    const pipelineCalls: Parameters<ReturnType<typeof vi.fn>>[0][] = [];
    const runSessionPipeline = vi.fn().mockImplementation(async (opts: unknown) => {
      pipelineCalls.push(opts as Parameters<ReturnType<typeof vi.fn>>[0]);
      return fakePipelineResult();
    });

    const session = buildSession();

    const buildDepsForSqlite = (): AnalyzeSessionDeps => {
      const deps = buildDeps(sqliteStore as unknown as Store, runSessionPipeline);
      // Override storeAccess to point at the real SQLite store + its dir
      (deps as unknown as { storeAccess: unknown }).storeAccess = {
        getStore: async () => sqliteStore,
        getStoreForDir: async () => sqliteStore,
        ensureStore: async () => {},
        getStoreDir: () => storeDir,
      };
      return deps;
    };

    // ── Run 1: 3-turn session -> original record written to SQLite ──────
    const events3 = buildEvents(3);
    const deps3 = buildDepsForSqlite();
    (deps3.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events3);
    await (await analyzeSession(session, deps3, {})).completed();

    expect(pipelineCalls).toHaveLength(1);
    expect(pipelineCalls[0]!.virtualSession).toBeUndefined();

    // ── Run 2: 5-turn session -> virtual #v1 written to SQLite ──────────
    const events5 = buildEvents(5);
    const deps5 = buildDepsForSqlite();
    (deps5.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    await (await analyzeSession(session, deps5, {})).completed();

    expect(pipelineCalls[1]!.virtualSession).toBeDefined();

    // ── Close and reopen the SQLite store ────────────────────────────────
    await sqliteStore.close();
    sqliteStore = new SqliteStore(path.join(storeDir, "store.db"));
    await sqliteStore.listProjectSummaries(); // force open

    // ── Both records survived the round-trip ─────────────────────────────
    const original = await sqliteStore.getRecord("test-project", "sess-1");
    expect(original).toBeDefined();
    expect(original!.meta.turnHashes).toHaveLength(3);
    expect(original!.meta.parentSessionId).toBeUndefined();

    const virtual = await sqliteStore.getRecord("test-project", "sess-1#v1");
    expect(virtual).toBeDefined();
    expect(virtual!.meta.parentSessionId).toBe("sess-1");
    expect(virtual!.meta.virtualSessionIndex).toBe(1);
    expect(virtual!.meta.startTurnIndex).toBe(3);
    expect(virtual!.meta.endTurnIndex).toBe(5);
    expect(virtual!.meta.turnHashes).toHaveLength(2);

    // ── Reopened store can serve a cache-hit merged view (run 3) ────────
    // This proves the virtual session is visible to listVirtualSessions
    // after reopen, not just to direct getRecord.
    const deps6 = buildDepsForSqlite();
    (deps6.hostAccess as unknown as { getActiveHost: () => Promise<unknown> }).getActiveHost =
      async () => makeHost(events5);
    const handle3 = await analyzeSession(session, deps6, {});
    // Pipeline not called again - cache hit on the reopened store
    expect(runSessionPipeline).toHaveBeenCalledTimes(2);
    expect(handle3.result.source).toBe("topic");
    expect(handle3.result.fromLibrary).toBe(true);
    // Merged view includes both Part 1 (original) and Part 2 (virtual)
    const children = handle3.result.mindMap?.children ?? [];
    expect(children.length).toBe(2);
    expect(children[0]!.data.text).toBe("Part 1");
    expect(children[1]!.data.text).toBe("Part 2");
  });
});
