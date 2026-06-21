import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { RemoteStore, SqliteStore, type SessionRecord } from "../../shared/src";
import { runBulkPushIfNeeded, BULK_PUSH_DONE_KEY } from "../../extension/src/store/bulkPush";
import { PushQueue, WATERMARK_PREFIX, PENDING_PREFIX } from "../../extension/src/store/pushQueue";

function sampleRecord(overrides?: Partial<SessionRecord["meta"]>): SessionRecord {
  return {
    schemaVersion: 1,
    meta: {
      sessionId: "s1",
      projectSlug: "proj-a",
      projectPath: "/home/test/proj",
      transcriptPath: "/tmp/s1.jsonl",
      transcriptMtimeMs: 1,
      transcriptFreshnessToken: "1",
      analyzedAt: 1000,
      llm: { provider: "cursor-cli" },
      promptParams: { maxTopics: 8, maxItemsPerTopic: 6 },
      sessionLabel: "Test session",
      ...overrides,
    },
    outline: {
      title: "T",
      summary: "s",
      outline: [{ title: "Node", details: [{ text: "detail" }] }],
    },
    conceptContexts: [],
    codeReferences: [],
  };
}

function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Minimal fake ExtensionContext — just globalState (secrets not needed). */
function makeFakeContext(): vscode.ExtensionContext & {
  globalState: {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Promise<void>;
  };
} {
  const map = new Map<string, unknown>();
  return {
    globalState: {
      get: <T>(key: string): T | undefined => map.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        if (value === undefined) {
          map.delete(key);
        } else {
          map.set(key, value);
        }
      },
    },
  } as unknown as vscode.ExtensionContext & {
    globalState: {
      get<T>(key: string): T | undefined;
      update(key: string, value: unknown): Promise<void>;
    };
  };
}

describe("runBulkPushIfNeeded", () => {
  let tmpRoot: string;
  let local: SqliteStore;
  let withProgressSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amm-bulkpush-"));
    const storeDir = path.join(tmpRoot, "store");
    fs.mkdirSync(storeDir, { recursive: true });
    local = new SqliteStore(path.join(storeDir, "store.db"));
    await local.listProjectSummaries(); // force open

    // Stub vscode.window.withProgress to just run the callback synchronously.
    withProgressSpy = vi.fn().mockImplementation((_opts, cb) => cb({ report: () => {} }));
    const vscodeAny = vscode as unknown as {
      window: { withProgress: unknown };
      ProgressLocation: unknown;
    };
    vscodeAny.window.withProgress = withProgressSpy;
    vscodeAny.ProgressLocation = { Notification: 15 };
  });

  afterEach(async () => {
    await local.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("skips when bulkPushDone is already true", async () => {
    const ctx = makeFakeContext();
    await ctx.globalState.update(BULK_PUSH_DONE_KEY, true);
    const isTeamModeEnabled = vi.fn().mockResolvedValue(true);
    const getLocalStore = vi.fn().mockResolvedValue(local);
    const drainAllPushQueues = vi.fn().mockResolvedValue(undefined);
    const result = await runBulkPushIfNeeded(ctx, {
      isTeamModeEnabled,
      getLocalStore,
      drainAllPushQueues,
    });
    expect(result).toEqual({ kind: "skipped", reason: "already-done" });
    expect(isTeamModeEnabled).not.toHaveBeenCalled();
    expect(drainAllPushQueues).not.toHaveBeenCalled();
  });

  it("skips when team mode is off", async () => {
    const ctx = makeFakeContext();
    const isTeamModeEnabled = vi.fn().mockResolvedValue(false);
    const getLocalStore = vi.fn().mockResolvedValue(local);
    const drainAllPushQueues = vi.fn().mockResolvedValue(undefined);
    const result = await runBulkPushIfNeeded(ctx, {
      isTeamModeEnabled,
      getLocalStore,
      drainAllPushQueues,
    });
    expect(result).toEqual({ kind: "skipped", reason: "team-mode-off" });
    expect(getLocalStore).not.toHaveBeenCalled();
    expect(drainAllPushQueues).not.toHaveBeenCalled();
    // Flag should NOT be set — team mode might be enabled later.
    expect(ctx.globalState.get<boolean>(BULK_PUSH_DONE_KEY)).toBeUndefined();
  });

  it("skips when local store is unavailable", async () => {
    const ctx = makeFakeContext();
    const isTeamModeEnabled = vi.fn().mockResolvedValue(true);
    const getLocalStore = vi.fn().mockResolvedValue(undefined);
    const drainAllPushQueues = vi.fn().mockResolvedValue(undefined);
    const result = await runBulkPushIfNeeded(ctx, {
      isTeamModeEnabled,
      getLocalStore,
      drainAllPushQueues,
    });
    expect(result).toEqual({ kind: "skipped", reason: "no-local-store" });
    expect(drainAllPushQueues).not.toHaveBeenCalled();
  });

  it("noops + marks done when local store has no records", async () => {
    const ctx = makeFakeContext();
    const isTeamModeEnabled = vi.fn().mockResolvedValue(true);
    const getLocalStore = vi.fn().mockResolvedValue(local);
    const drainAllPushQueues = vi.fn().mockResolvedValue(undefined);
    const result = await runBulkPushIfNeeded(ctx, {
      isTeamModeEnabled,
      getLocalStore,
      drainAllPushQueues,
    });
    expect(result).toEqual({ kind: "noop", totalRecords: 0 });
    expect(drainAllPushQueues).not.toHaveBeenCalled();
    expect(ctx.globalState.get<boolean>(BULK_PUSH_DONE_KEY)).toBe(true);
  });

  it("sets pending flags, drains, and marks done when records exist", async () => {
    const rec1 = sampleRecord({ sessionId: "s1", analyzedAt: 1000 });
    const rec2 = sampleRecord({ sessionId: "s2", projectSlug: "proj-b", analyzedAt: 2000 });
    await local.upsertRecord(rec1);
    await local.upsertRecord(rec2);

    const ctx = makeFakeContext();
    const isTeamModeEnabled = vi.fn().mockResolvedValue(true);
    const getLocalStore = vi.fn().mockResolvedValue(local);
    const drainAllPushQueues = vi.fn().mockResolvedValue(undefined);
    const result = await runBulkPushIfNeeded(ctx, {
      isTeamModeEnabled,
      getLocalStore,
      drainAllPushQueues,
    });

    expect(result).toEqual({ kind: "done", totalRecords: 2 });
    expect(drainAllPushQueues).toHaveBeenCalledTimes(1);
    expect(withProgressSpy).toHaveBeenCalledTimes(1);

    // Pending flags set to max analyzedAt per project.
    expect(await local.readKvJson<number>(PENDING_PREFIX + "proj-a")).toBe(1000);
    expect(await local.readKvJson<number>(PENDING_PREFIX + "proj-b")).toBe(2000);

    // Flag marked done.
    expect(ctx.globalState.get<boolean>(BULK_PUSH_DONE_KEY)).toBe(true);
  });

  it("does not overwrite a higher existing pending value", async () => {
    // Pre-set a pending value higher than any record's analyzedAt — bulk push
    // should NOT lower it (e.g. a concurrent enqueue set it).
    const rec = sampleRecord({ sessionId: "s1", analyzedAt: 1000 });
    await local.upsertRecord(rec);
    await local.writeKvJson(PENDING_PREFIX + "proj-a", 5000);

    const ctx = makeFakeContext();
    const drainAllPushQueues = vi.fn().mockResolvedValue(undefined);
    await runBulkPushIfNeeded(ctx, {
      isTeamModeEnabled: async () => true,
      getLocalStore: async () => local,
      drainAllPushQueues,
    });

    expect(await local.readKvJson<number>(PENDING_PREFIX + "proj-a")).toBe(5000);
  });

  it("marks done even if drain throws (best-effort)", async () => {
    const rec = sampleRecord({ sessionId: "s1", analyzedAt: 1000 });
    await local.upsertRecord(rec);

    const ctx = makeFakeContext();
    const drainAllPushQueues = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(
      runBulkPushIfNeeded(ctx, {
        isTeamModeEnabled: async () => true,
        getLocalStore: async () => local,
        drainAllPushQueues,
      })
    ).rejects.toThrow("network down");
    // Flag should NOT be set on failure — next activation retries.
    expect(ctx.globalState.get<boolean>(BULK_PUSH_DONE_KEY)).toBeUndefined();
  });

  it("end-to-end: pushes records via RemoteStore when wired to a real PushQueue", async () => {
    const rec1 = sampleRecord({ sessionId: "s1", analyzedAt: 1000 });
    const rec2 = sampleRecord({ sessionId: "s2", analyzedAt: 2000 });
    await local.upsertRecord(rec1);
    await local.upsertRecord(rec2);

    const f = vi.fn().mockResolvedValue(mockResponse(200, { revision: 1 }));
    const remote = new RemoteStore("https://team.example.com", "key", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    const queue = new PushQueue(local, remote);

    const ctx = makeFakeContext();
    await runBulkPushIfNeeded(ctx, {
      isTeamModeEnabled: async () => true,
      getLocalStore: async () => local,
      drainAllPushQueues: async () => queue.drain(),
    });

    // Both records should have been POSTed.
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    // Watermarks advanced.
    expect(await local.readKvJson<number>(WATERMARK_PREFIX + "proj-a")).toBe(2000);
    expect(await local.readKvJson<number>(PENDING_PREFIX + "proj-a")).toBeUndefined();
    // Flag set.
    expect(ctx.globalState.get<boolean>(BULK_PUSH_DONE_KEY)).toBe(true);
    queue.dispose();
  });
});
