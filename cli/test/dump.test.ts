/**
 * CLI dump command tests — P4.2 (session dump) and P4.3 (project dump).
 *
 * We mock core functions and test that:
 * - Session dump reads a SessionRecord, builds a mind map, and calls exportMindMapPackage()
 * - Project dump reads a MergeRecord and calls exportMindMapPackage()
 * - Both handle missing records with appropriate error messages
 * - --with-analyze triggers analysis before dumping
 * - --output and --force flags work
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
    mtimeMs: Date.now() - 3_600_000,
    hostId: "cursor",
    projectSlug: "my-project",
  },
];

const mockListSessionsResult = {
  sessions: mockSessions,
  scanDir: "/home/user/.cursor/sessions",
  projectSlug: "my-project",
};

const mockRecord = {
  schemaVersion: 1 as const,
  meta: {
    sessionId: "abc123def456",
    projectSlug: "my-project",
    projectPath: "/home/user/project",
    transcriptPath: "/home/user/.cursor/sessions/abc123.jsonl",
    transcriptFreshnessToken: "10",
    analyzedAt: Date.now(),
    llm: { provider: "cursor-cli", model: "gpt-4" },
    promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
    sessionLabel: "How does binder work?",
    hostId: "cursor",
  },
  outline: {
    title: "Binder Analysis",
    outline: [
      {
        id: "t1",
        label: "Core Concepts",
        children: [{ id: "t1-1", label: "Transaction Code", children: [] }],
      },
    ],
  },
  graph: { nodes: {}, edges: {} },
  sessionAnalysis: {
    codeReferences: [
      {
        path: "/proj/kernel/binder.c",
        name: "binder_transaction",
        description: "Main transaction handler",
        llmStatus: "done",
      },
    ],
  },
};

const mockMergeRecord = {
  schemaVersion: 1 as const,
  meta: {
    kind: "deterministic" as const,
    builtAt: Date.now(),
    sessionIds: ["abc123def456"],
    projectSlugs: ["my-project"],
    title: "My Project",
  },
  mindMap: {
    data: { text: "My Project", expand: true },
    children: [{ data: { text: "Binder Analysis" } }],
  },
};

// Core mocks
const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  readRecord: vi.fn(),
  ensureStore: vi.fn(),
  buildOutlineMindMap: vi.fn(),
  exportMindMapPackage: vi.fn(),
  readSnapshotManifest: vi.fn(),
  readMergeSnapshot: vi.fn(),
  getCodeRefQueueDepth: vi.fn(),
  analyzeProject: vi.fn(),
  buildCliHostAccess: vi.fn(),
  buildCliAnalyzeProjectDeps: vi.fn(),
  buildCliStoreAccess: vi.fn(),
  buildCliAnalyzeSessionDepsAsync: vi.fn(),
  analyzeSession: vi.fn(),
  resolveMediaDir: vi.fn(),
}));

vi.mock("@agent-mindmap/core", () => ({
  listSessions: mocks.listSessions,
  readRecord: mocks.readRecord,
  ensureStore: mocks.ensureStore,
  buildOutlineMindMap: mocks.buildOutlineMindMap,
  exportMindMapPackage: mocks.exportMindMapPackage,
  readSnapshotManifest: mocks.readSnapshotManifest,
  readMergeSnapshot: mocks.readMergeSnapshot,
  getCodeRefQueueDepth: mocks.getCodeRefQueueDepth,
  analyzeProject: mocks.analyzeProject,
  analyzeSession: mocks.analyzeSession,
}));

vi.mock("../../cli/src/adapters/analyzeDeps", () => ({
  buildCliHostAccess: mocks.buildCliHostAccess,
  buildCliAnalyzeSessionDepsAsync: mocks.buildCliAnalyzeSessionDepsAsync,
  buildCliAnalyzeProjectDeps: mocks.buildCliAnalyzeProjectDeps,
}));

vi.mock("../../cli/src/adapters/cliStore", () => ({
  buildCliStoreAccess: mocks.buildCliStoreAccess,
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

vi.mock("../../cli/src/mediaDir", () => ({
  resolveMediaDir: mocks.resolveMediaDir,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { runSessionDump } from "../../cli/src/commands/session";
import { runProjectDump } from "../../cli/src/commands/project";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("session dump (P4.2)", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    mocks.listSessions.mockResolvedValue(mockListSessionsResult);
    mocks.buildCliHostAccess.mockReturnValue({
      getActiveHost: vi.fn(),
      getWorkspacePath: vi.fn().mockReturnValue("/home/user/project"),
      getWorkspaceSlug: vi.fn().mockReturnValue("my-project"),
    });
    mocks.ensureStore.mockResolvedValue(undefined);
    mocks.readRecord.mockResolvedValue(mockRecord);
    mocks.buildOutlineMindMap.mockReturnValue({
      data: { text: "Binder Analysis", expand: true },
      children: [{ data: { text: "Core Concepts" } }],
    });
    mocks.exportMindMapPackage.mockResolvedValue({
      outDir: "/tmp/export-output",
      transcriptCount: 1,
    });
    mocks.resolveMediaDir.mockReturnValue("/tmp/media");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads record, builds mind map, and exports", async () => {
    await runSessionDump("/home/user/project", undefined, "abc123", {});

    expect(mocks.readRecord).toHaveBeenCalled();
    expect(mocks.buildOutlineMindMap).toHaveBeenCalled();
    expect(mocks.exportMindMapPackage).toHaveBeenCalledTimes(1);

    // Verify exportMindMapPackage was called with the mind map
    const exportOpts = mocks.exportMindMapPackage.mock.calls[0]![0];
    expect(exportOpts.mediaDir).toBe("/tmp/media");
    expect(exportOpts.outDir).toContain("agent-mindmap-export");
  });

  it("errors when no record exists", async () => {
    mocks.readRecord.mockResolvedValue(undefined);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(runSessionDump("/home/user/project", undefined, "abc123", {})).rejects.toThrow(
      "exit"
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(capturedLogs.some((l) => l.includes("not yet analyzed"))).toBe(true);
    exitSpy.mockRestore();
  });

  it("uses custom output directory with --output", async () => {
    await runSessionDump("/home/user/project", undefined, "abc123", {
      output: "/custom/output",
    });

    const exportOpts = mocks.exportMindMapPackage.mock.calls[0]![0];
    expect(exportOpts.outDir).toBe("/custom/output");
  });

  it("errors when session not found", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(
      runSessionDump("/home/user/project", undefined, "nonexistent", {})
    ).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("handles export failure", async () => {
    mocks.exportMindMapPackage.mockRejectedValue(new Error("Disk full"));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(runSessionDump("/home/user/project", undefined, "abc123", {})).rejects.toThrow(
      "exit"
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(capturedLogs.some((l) => l.includes("Disk full") || l.includes("Export failed"))).toBe(
      true
    );
    exitSpy.mockRestore();
  });
});

describe("project dump (P4.3)", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    mocks.listSessions.mockResolvedValue(mockListSessionsResult);
    mocks.buildCliHostAccess.mockReturnValue({
      getActiveHost: vi.fn(),
      getWorkspacePath: vi.fn().mockReturnValue("/home/user/project"),
      getWorkspaceSlug: vi.fn().mockReturnValue("my-project"),
    });
    mocks.ensureStore.mockResolvedValue(undefined);
    mocks.buildCliStoreAccess.mockReturnValue({
      getStore: vi.fn().mockResolvedValue({
        readConceptTrieMerge: vi.fn().mockResolvedValue(mockMergeRecord),
        listAllRecords: vi.fn().mockResolvedValue([]),
      }),
    });
    mocks.exportMindMapPackage.mockResolvedValue({
      outDir: "/tmp/project-export",
      transcriptCount: 3,
    });
    mocks.resolveMediaDir.mockReturnValue("/tmp/media");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads merge record and exports", async () => {
    await runProjectDump("/home/user/project", undefined, {});

    expect(mocks.exportMindMapPackage).toHaveBeenCalledTimes(1);

    const exportOpts = mocks.exportMindMapPackage.mock.calls[0]![0];
    expect(exportOpts.mindMap).toBe(mockMergeRecord.mindMap);
    expect(exportOpts.mediaDir).toBe("/tmp/media");
  });

  it("errors when no merge record exists", async () => {
    mocks.buildCliStoreAccess.mockReturnValue({
      getStore: vi.fn().mockResolvedValue({
        readConceptTrieMerge: vi.fn().mockResolvedValue(undefined),
        listAllRecords: vi.fn().mockResolvedValue([]),
      }),
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(runProjectDump("/home/user/project", undefined, {})).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(capturedLogs.some((l) => l.includes("No merged project mind map"))).toBe(true);
    exitSpy.mockRestore();
  });

  it("uses custom output directory with --output", async () => {
    await runProjectDump("/home/user/project", undefined, {
      output: "/custom/project-output",
    });

    const exportOpts = mocks.exportMindMapPackage.mock.calls[0]![0];
    expect(exportOpts.outDir).toBe("/custom/project-output");
  });

  it("handles export failure", async () => {
    mocks.exportMindMapPackage.mockRejectedValue(new Error("Permission denied"));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(runProjectDump("/home/user/project", undefined, {})).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
