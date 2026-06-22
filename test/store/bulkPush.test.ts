import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { RemoteStore, SqliteStore, type SessionRecord } from "../../shared/src";
import { pushLocalRecordsToTeam } from "../../extension/src/store/bulkPush";
import { PushQueue, WATERMARK_PREFIX, PENDING_PREFIX } from "@agent-mindmap/core";

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

describe("pushLocalRecordsToTeam", () => {
  let tmpRoot: string;
  let local: SqliteStore;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amm-bulkpush-"));
    const storeDir = path.join(tmpRoot, "store");
    fs.mkdirSync(storeDir, { recursive: true });
    local = new SqliteStore(path.join(storeDir, "store.db"));
    await local.listProjectSummaries(); // force open
  });

  afterEach(async () => {
    await local.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("skips when team mode is off", async () => {
    const isTeamModeEnabled = vi.fn().mockResolvedValue(false);
    const getLocalStore = vi.fn().mockResolvedValue(local);
    const drainAllPushQueues = vi.fn().mockResolvedValue(undefined);
    const result = await pushLocalRecordsToTeam({
      isTeamModeEnabled,
      getLocalStore,
      drainAllPushQueues,
    });
    expect(result).toEqual({ kind: "skipped", reason: "team-mode-off" });
    expect(getLocalStore).not.toHaveBeenCalled();
    expect(drainAllPushQueues).not.toHaveBeenCalled();
  });

  it("skips when local store is unavailable", async () => {
    const isTeamModeEnabled = vi.fn().mockResolvedValue(true);
    const getLocalStore = vi.fn().mockResolvedValue(undefined);
    const drainAllPushQueues = vi.fn().mockResolvedValue(undefined);
    const result = await pushLocalRecordsToTeam({
      isTeamModeEnabled,
      getLocalStore,
      drainAllPushQueues,
    });
    expect(result).toEqual({ kind: "skipped", reason: "no-local-store" });
    expect(drainAllPushQueues).not.toHaveBeenCalled();
  });

  it("noops when local store has no records", async () => {
    const isTeamModeEnabled = vi.fn().mockResolvedValue(true);
    const getLocalStore = vi.fn().mockResolvedValue(local);
    const drainAllPushQueues = vi.fn().mockResolvedValue(undefined);
    const result = await pushLocalRecordsToTeam({
      isTeamModeEnabled,
      getLocalStore,
      drainAllPushQueues,
    });
    expect(result).toEqual({ kind: "noop", totalRecords: 0 });
    expect(drainAllPushQueues).not.toHaveBeenCalled();
  });

  it("sets pending flags, drains, and returns done when records exist", async () => {
    const rec1 = sampleRecord({ sessionId: "s1", analyzedAt: 1000 });
    const rec2 = sampleRecord({ sessionId: "s2", projectSlug: "proj-b", analyzedAt: 2000 });
    await local.upsertRecord(rec1);
    await local.upsertRecord(rec2);

    const isTeamModeEnabled = vi.fn().mockResolvedValue(true);
    const getLocalStore = vi.fn().mockResolvedValue(local);
    const drainAllPushQueues = vi.fn().mockResolvedValue(undefined);
    const result = await pushLocalRecordsToTeam({
      isTeamModeEnabled,
      getLocalStore,
      drainAllPushQueues,
    });

    expect(result).toEqual({ kind: "done", totalRecords: 2 });
    expect(drainAllPushQueues).toHaveBeenCalledTimes(1);

    // Pending flags set to max analyzedAt per project.
    expect(await local.readKvJson<number>(PENDING_PREFIX + "proj-a")).toBe(1000);
    expect(await local.readKvJson<number>(PENDING_PREFIX + "proj-b")).toBe(2000);
  });

  it("does not overwrite a higher existing pending value", async () => {
    // Pre-set a pending value higher than any record's analyzedAt — push
    // should NOT lower it (e.g. a concurrent enqueue set it).
    const rec = sampleRecord({ sessionId: "s1", analyzedAt: 1000 });
    await local.upsertRecord(rec);
    await local.writeKvJson(PENDING_PREFIX + "proj-a", 5000);

    const drainAllPushQueues = vi.fn().mockResolvedValue(undefined);
    await pushLocalRecordsToTeam({
      isTeamModeEnabled: async () => true,
      getLocalStore: async () => local,
      drainAllPushQueues,
    });

    expect(await local.readKvJson<number>(PENDING_PREFIX + "proj-a")).toBe(5000);
  });

  it("propagates drain error (caller handles partial failure)", async () => {
    const rec = sampleRecord({ sessionId: "s1", analyzedAt: 1000 });
    await local.upsertRecord(rec);

    const drainAllPushQueues = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(
      pushLocalRecordsToTeam({
        isTeamModeEnabled: async () => true,
        getLocalStore: async () => local,
        drainAllPushQueues,
      })
    ).rejects.toThrow("network down");
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

    await pushLocalRecordsToTeam({
      isTeamModeEnabled: async () => true,
      getLocalStore: async () => local,
      drainAllPushQueues: async () => queue.drain(),
    });

    // Both records should have been POSTed.
    expect(f).toHaveBeenCalledTimes(2);
    // Watermarks advanced.
    expect(await local.readKvJson<number>(WATERMARK_PREFIX + "proj-a")).toBe(2000);
    expect(await local.readKvJson<number>(PENDING_PREFIX + "proj-a")).toBeUndefined();
    queue.dispose();
  });
});
