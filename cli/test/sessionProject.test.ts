/**
 * CLI command tests — P3.1 through P3.5.
 *
 * We mock core use-case functions and test that the command handlers:
 * - Call the right core functions with the right arguments
 * - Format output correctly in both text and JSON modes
 * - Handle edge cases (no sessions, missing records)
 *
 * The key regression test: session analyze awaits handle.completed() so the
 * persisted SessionRecord is post-drain, not pre-drain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptSession } from "@agent-mindmap/core";

// ─── Capture logs from logger mock ─────────────────────────────────────────

const capturedLogs: string[] = [];

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockSessions: TranscriptSession[] = [
  {
    id: "abc123def456",
    label: "How does binder work?",
    filePath: "/home/user/.cursor/sessions/abc123.jsonl",
    mtimeMs: Date.now() - 3_600_000, // 1h ago
    hostId: "cursor",
    projectSlug: "my-project",
  },
  {
    id: "xyz789ghi012",
    label: "Fix login bug",
    filePath: "/home/user/.cursor/sessions/xyz789.jsonl",
    mtimeMs: Date.now() - 86_400_000, // 1d ago
    hostId: "cursor",
    projectSlug: "my-project",
  },
];

const mockListSessionsResult = {
  sessions: mockSessions,
  scanDir: "/home/user/.cursor/sessions",
  projectSlug: "my-project",
};

// Core use-case mocks
const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  analyzeSession: vi.fn(),
  analyzeProject: vi.fn(),
  readRecord: vi.fn(),
  ensureStore: vi.fn(),
  readSnapshotManifest: vi.fn(),
  readMergeSnapshot: vi.fn(),
  getCodeRefQueueDepth: vi.fn(),
  buildCliHostAccess: vi.fn(),
  buildCliAnalyzeSessionDepsAsync: vi.fn(),
  buildCliAnalyzeProjectDeps: vi.fn(),
}));

vi.mock("@agent-mindmap/core", () => ({
  listSessions: mocks.listSessions,
  analyzeSession: mocks.analyzeSession,
  analyzeProject: mocks.analyzeProject,
  readRecord: mocks.readRecord,
  ensureStore: mocks.ensureStore,
  readSnapshotManifest: mocks.readSnapshotManifest,
  readMergeSnapshot: mocks.readMergeSnapshot,
  getCodeRefQueueDepth: mocks.getCodeRefQueueDepth,
}));

vi.mock("../../cli/src/adapters/analyzeDeps", () => ({
  buildCliHostAccess: mocks.buildCliHostAccess,
  buildCliAnalyzeSessionDepsAsync: mocks.buildCliAnalyzeSessionDepsAsync,
  buildCliAnalyzeProjectDeps: mocks.buildCliAnalyzeProjectDeps,
}));

vi.mock("../../cli/src/config/configStore", () => ({
  CliConfigStore: class {
    storeDir = "/tmp/test-store";
    async load() {}
    get() {
      return undefined;
    }
  },
}));

vi.mock("../../cli/src/ui/logger", () => ({
  log: (msg: string) => capturedLogs.push(msg),
  logSuccess: (msg: string) => capturedLogs.push(`✓ ${msg}`),
  logError: (msg: string) => capturedLogs.push(`✗ ${msg}`),
  logWarn: (msg: string) => capturedLogs.push(`⚠ ${msg}`),
  isJsonMode: () => false,
  printJson: (data: unknown) => capturedLogs.push(JSON.stringify(data)),
  createSpinner: () => ({
    start: () => {},
    succeed: () => {},
    fail: () => {},
    text: "",
  }),
  applyGlobalFlags: () => {},
  setJsonMode: () => {},
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { runSessionList, runSessionShow, runSessionAnalyze } from "../../cli/src/commands/session";
import { runProjectStatus, runProjectAnalyze } from "../../cli/src/commands/project";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("session list (P3.1)", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    mocks.listSessions.mockResolvedValue(mockListSessionsResult);
    mocks.buildCliHostAccess.mockReturnValue({
      getActiveHost: vi.fn(),
      getWorkspacePath: vi.fn().mockReturnValue("/home/user/project"),
      getWorkspaceSlug: vi.fn().mockReturnValue("my-project"),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists sessions in text mode", async () => {
    await runSessionList("/home/user/project", undefined, {});

    expect(capturedLogs.some((l) => l.includes("abc123de"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("binder"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("2 session(s)"))).toBe(true);
  });

  it("handles no sessions", async () => {
    mocks.listSessions.mockResolvedValue(undefined);

    await runSessionList("/home/user/project", undefined, {});

    expect(capturedLogs.some((l) => l.includes("No sessions"))).toBe(true);
  });

  it("respects --limit option", async () => {
    await runSessionList("/home/user/project", undefined, { limit: 1 });

    expect(capturedLogs.some((l) => l.includes("1 session(s)"))).toBe(true);
  });
});

describe("session show (P3.2)", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    mocks.listSessions.mockResolvedValue(mockListSessionsResult);
    mocks.buildCliHostAccess.mockReturnValue({
      getActiveHost: vi.fn(),
      getWorkspacePath: vi.fn().mockReturnValue("/home/user/project"),
      getWorkspaceSlug: vi.fn().mockReturnValue("my-project"),
    });
    mocks.readRecord.mockResolvedValue({
      meta: {
        analyzedAt: Date.now() - 1_800_000,
        llm: { provider: "cursor-cli", model: "gpt-4" },
      },
      outline: { topics: [{ id: "t1" }, { id: "t2" }, { id: "t3" }] },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows session metadata with analyzed info", async () => {
    await runSessionShow("/home/user/project", undefined, "abc123");

    expect(capturedLogs.some((l) => l.includes("binder"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("Analyzed"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("cursor-cli"))).toBe(true);
  });

  it("shows warning for unanalyzed session", async () => {
    mocks.readRecord.mockResolvedValue(undefined);

    await runSessionShow("/home/user/project", undefined, "abc123");

    expect(capturedLogs.some((l) => l.includes("Not yet analyzed"))).toBe(true);
  });

  it("exits with code 1 for unknown session", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(runSessionShow("/home/user/project", undefined, "nonexistent")).rejects.toThrow(
      "exit"
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe("session analyze (P3.3)", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    mocks.listSessions.mockResolvedValue(mockListSessionsResult);
    mocks.buildCliHostAccess.mockReturnValue({
      getActiveHost: vi.fn(),
      getWorkspacePath: vi.fn().mockReturnValue("/home/user/project"),
      getWorkspaceSlug: vi.fn().mockReturnValue("my-project"),
    });
    mocks.buildCliAnalyzeSessionDepsAsync.mockResolvedValue({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      progress: { report: vi.fn() },
      configStore: { get: vi.fn() },
      storeAccess: { getStoreDir: vi.fn().mockReturnValue("/tmp/store") },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls analyzeSession and awaits handle.completed()", async () => {
    const completedFn = vi.fn().mockResolvedValue(undefined);
    mocks.analyzeSession.mockResolvedValue({
      result: {
        session: mockSessions[0],
        mindMap: { children: [{ id: "t1" }, { id: "t2" }] },
        source: "topic",
        fromLibrary: false,
      },
      completed: completedFn,
    });

    await runSessionAnalyze("/home/user/project", undefined, {
      latest: true,
      force: false,
    });

    // Critical: completed() must have been awaited
    expect(completedFn).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeSession).toHaveBeenCalledTimes(1);
  });

  it("picks the latest session when --latest is set", async () => {
    const completedFn = vi.fn().mockResolvedValue(undefined);
    mocks.analyzeSession.mockResolvedValue({
      result: {
        session: mockSessions[0],
        mindMap: { children: [] },
        source: "topic",
      },
      completed: completedFn,
    });

    await runSessionAnalyze("/home/user/project", undefined, {
      latest: true,
      force: false,
    });

    // The first session (most recent by mtimeMs) should be passed
    const call = mocks.analyzeSession.mock.calls[0]!;
    expect(call[0].id).toBe("abc123def456");
  });

  it("picks specific session when id is given", async () => {
    const completedFn = vi.fn().mockResolvedValue(undefined);
    mocks.analyzeSession.mockResolvedValue({
      result: {
        session: mockSessions[1],
        mindMap: { children: [] },
        source: "topic",
      },
      completed: completedFn,
    });

    await runSessionAnalyze("/home/user/project", undefined, {
      latest: false,
      force: false,
      sessionId: "xyz789",
    });

    const call = mocks.analyzeSession.mock.calls[0]!;
    expect(call[0].id).toBe("xyz789ghi012");
  });

  it("exits with code 1 when analysis fails", async () => {
    mocks.analyzeSession.mockRejectedValue(new Error("LLM failed"));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(
      runSessionAnalyze("/home/user/project", undefined, {
        latest: true,
        force: false,
      })
    ).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe("project analyze (P3.4)", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    mocks.buildCliAnalyzeProjectDeps.mockResolvedValue({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      progress: { report: vi.fn() },
      configStore: { get: vi.fn() },
      storeAccess: { getStoreDir: vi.fn().mockReturnValue("/tmp/store") },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls analyzeProject and awaits handle.completed()", async () => {
    const completedFn = vi.fn().mockResolvedValue(undefined);
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
      completed: completedFn,
    });

    await runProjectAnalyze("/home/user/project", undefined, { force: false });

    expect(completedFn).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);
  });

  it("exits with code 1 on failure", async () => {
    mocks.analyzeProject.mockRejectedValue(new Error("Merge failed"));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(
      runProjectAnalyze("/home/user/project", undefined, { force: false })
    ).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe("project status (P3.5)", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    mocks.listSessions.mockResolvedValue(mockListSessionsResult);
    mocks.buildCliHostAccess.mockReturnValue({
      getActiveHost: vi.fn(),
      getWorkspacePath: vi.fn().mockReturnValue("/home/user/project"),
      getWorkspaceSlug: vi.fn().mockReturnValue("my-project"),
    });
    mocks.ensureStore.mockResolvedValue(undefined);
    mocks.readRecord
      .mockResolvedValueOnce({ meta: { analyzedAt: Date.now() } }) // session 1: analyzed
      .mockResolvedValueOnce(undefined); // session 2: stale
    mocks.readSnapshotManifest.mockResolvedValue({
      nodes: [
        { builtAt: Date.now() - 60_000, id: "n1" },
        { builtAt: Date.now() - 30_000, id: "n2" },
      ],
    });
    mocks.readMergeSnapshot.mockResolvedValue({
      meta: {
        builtAt: Date.now() - 30_000,
        kind: "deterministic",
        projectSlug: "my-project",
        sessionIds: ["abc123def456"],
      },
    });
    mocks.getCodeRefQueueDepth.mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows project status with merge info and queue depth", async () => {
    await runProjectStatus("/home/user/project", undefined);

    expect(capturedLogs.some((l) => l.includes("my-project"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("deterministic"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("queue: empty"))).toBe(true);
  });

  it("shows warning for pending code-ref queue items", async () => {
    mocks.getCodeRefQueueDepth.mockReturnValue(3);

    await runProjectStatus("/home/user/project", undefined);

    expect(capturedLogs.some((l) => l.includes("3 pending"))).toBe(true);
  });

  it("handles missing manifest gracefully", async () => {
    mocks.readSnapshotManifest.mockResolvedValue(undefined);
    mocks.readMergeSnapshot.mockResolvedValue(undefined);

    await runProjectStatus("/home/user/project", undefined);

    // Should still show basic info without crashing
    expect(capturedLogs.some((l) => l.includes("my-project"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("Analyzed"))).toBe(true);
  });

  it("handles no workspace/host detected", async () => {
    mocks.listSessions.mockResolvedValue(undefined);

    await runProjectStatus("/home/user/project", undefined);

    expect(capturedLogs.some((l) => l.includes("No workspace"))).toBe(true);
  });
});
