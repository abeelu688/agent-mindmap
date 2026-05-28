import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import { LlmProviderError } from "../extension/src/llm/types";
import type { TranscriptSession } from "../extension/src/transcript/types";
import type { LoadedSession } from "../extension/src/sessionLoader";
import {
  analyzeProjectSessions,
  runProjectSessionBatch,
} from "../extension/src/sessionLoader";
import type { AgentHost } from "../extension/src/host/types";
import { createBatchItemProgress } from "../extension/src/progress";

const sessions: TranscriptSession[] = [
  {
    id: "session-ok",
    label: "OK session",
    filePath: "/tmp/ok.jsonl",
    mtimeMs: 1000,
  },
  {
    id: "session-fail",
    label: "Fail session",
    filePath: "/tmp/fail.jsonl",
    mtimeMs: 2000,
  },
  {
    id: "session-cache",
    label: "Cached session",
    filePath: "/tmp/cache.jsonl",
    mtimeMs: 3000,
  },
];

const mockHost = {
  id: "cursor",
  listSessions: vi.fn(async () => sessions),
  getSessionsScanDir: vi.fn(() => "/scan/dir"),
  emptyTranscriptsHint: (scanDir: string) => `No transcripts in ${scanDir}`,
} as unknown as AgentHost;

vi.mock("../extension/src/host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../extension/src/host")>();
  return {
    ...actual,
    getActiveHost: vi.fn(async () => mockHost),
    getWorkspacePath: vi.fn(() => "/workspace"),
    getWorkspaceSlug: vi.fn(() => "my-project"),
  };
});

const fakeContext = {
  globalStorageUri: { fsPath: "/tmp/storage" },
} as vscode.ExtensionContext;

describe("createBatchItemProgress", () => {
  it("prefixes sub-step messages with batch position", () => {
    const messages: string[] = [];
    const { progress, reportComplete } = createBatchItemProgress(
      { report: (u) => messages.push(typeof u === "string" ? u : (u.message ?? "")) },
      2,
      5,
      "Binder IPC 调研"
    );
    progress.report("正在生成大纲…");
    reportComplete("分析完成");
    expect(messages[0]).toBe("第 3/5 条 · Binder IPC 调研 — 正在生成大纲…");
    expect(messages[1]).toContain("第 3/5 条");
    expect(messages[1]).toContain("已完成 3/5");
  });
});

describe("runProjectSessionBatch", () => {
  const loadSessionFn = vi.fn<
    (
      session: TranscriptSession,
      deps: unknown,
      options?: { forceRefresh?: boolean; skipAutoMerge?: boolean },
      host?: AgentHost
    ) => Promise<LoadedSession>
  >();

  beforeEach(() => {
    loadSessionFn.mockReset();
  });

  it("aggregates success, cache hits, and failures", async () => {
    loadSessionFn
      .mockResolvedValueOnce({
        session: sessions[0]!,
        mindMap: { data: { text: "ok" } },
        source: "topic",
      })
      .mockRejectedValueOnce(new Error("llm failed"))
      .mockResolvedValueOnce({
        session: sessions[2]!,
        mindMap: { data: { text: "cache" } },
        source: "topic",
        fromLibrary: true,
      });

    const result = await runProjectSessionBatch(
      sessions,
      "my-project",
      mockHost,
      { context: fakeContext },
      {
        loadSessionFn,
        skipAutoMerge: true,
        forceRefresh: false,
      }
    );

    expect(result).toEqual({
      projectSlug: "my-project",
      total: 3,
      analyzed: 2,
      skippedFresh: 1,
      failed: 1,
      failures: [
        {
          sessionId: "session-fail",
          label: "Fail session",
          message: "llm failed",
        },
      ],
    });

    expect(loadSessionFn).toHaveBeenCalledTimes(3);
    for (const call of loadSessionFn.mock.calls) {
      expect(call[2]).toEqual({
        forceRefresh: false,
        skipAutoMerge: true,
      });
    }
  });

  it("re-throws cancellation", async () => {
    loadSessionFn.mockRejectedValue(
      new LlmProviderError("cancelled", "cancelled")
    );

    await expect(
      runProjectSessionBatch(sessions, "my-project", mockHost, {
        context: fakeContext,
      }, { loadSessionFn })
    ).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("analyzeProjectSessions", () => {
  it("returns undefined when no workspace", async () => {
    const host = await import("../extension/src/host");
    vi.mocked(host.getWorkspacePath).mockReturnValueOnce(undefined);

    const result = await analyzeProjectSessions({ context: fakeContext });
    expect(result).toBeUndefined();
  });
});
