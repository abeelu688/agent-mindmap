import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteStore, SqliteStore, type SessionRecord } from "../../shared/src";
import { PushQueue, __testing } from "@agent-mindmap/core";

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

describe("PushQueue", () => {
  let tmpRoot: string;
  let storeDir: string;
  let local: SqliteStore;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amm-push-"));
    storeDir = path.join(tmpRoot, "store");
    fs.mkdirSync(storeDir, { recursive: true });
    local = new SqliteStore(path.join(storeDir, "store.db"));
    await local.listProjectSummaries(); // force open
  });

  afterEach(async () => {
    await local.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeRemote() {
    const f = vi.fn();
    const remote = new RemoteStore("https://team.example.com", "key", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0, // fail fast in tests
      sleep: async () => {},
    });
    return { remote, f };
  }

  it("enqueue writes pending flag but does NOT trigger drain (no fetch)", async () => {
    const rec = sampleRecord({ analyzedAt: 1000 });
    await local.upsertRecord(rec);
    const { remote, f } = makeRemote();
    const q = new PushQueue(local, remote);
    await q.enqueue(rec);
    // Pending flag should be set.
    expect(await local.readKvJson<number>(__testing.PENDING_PREFIX + "proj-a")).toBe(1000);
    // No drain was triggered — no fetch call.
    expect(f).not.toHaveBeenCalled();
  });

  it("explicit drain pushes records and clears pending", async () => {
    const rec = sampleRecord({ analyzedAt: 1000 });
    await local.upsertRecord(rec);
    const { remote, f } = makeRemote();
    f.mockResolvedValue(mockResponse(200, { revision: 1 }));
    const q = new PushQueue(local, remote);
    await q.enqueue(rec);
    // No fetch yet — enqueue doesn't drain.
    expect(f).not.toHaveBeenCalled();
    // Explicit drain pushes.
    await q.drain();
    expect(f).toHaveBeenCalledTimes(1);
    // Watermark should now be 1000; pending flag cleared.
    expect(await local.readKvJson<number>(__testing.WATERMARK_PREFIX + "proj-a")).toBe(1000);
    expect(await local.listKvKeys(__testing.PENDING_PREFIX)).toEqual([]);
  });

  it("drain only pushes records with analyzedAt > watermark", async () => {
    const rec1 = sampleRecord({ sessionId: "s1", analyzedAt: 1000 });
    const rec2 = sampleRecord({ sessionId: "s2", analyzedAt: 2000 });
    await local.upsertRecord(rec1);
    await local.upsertRecord(rec2);
    const { remote, f } = makeRemote();
    f.mockResolvedValue(mockResponse(200, { revision: 1 }));
    const q = new PushQueue(local, remote);
    await q.enqueue(rec2);
    // Drain pushes ALL local records with analyzedAt > watermark (0) — that's
    // both rec1 (at=1000) and rec2 (at=2000).
    await q.drain();
    expect(f).toHaveBeenCalledTimes(2);
    // Second drain should not push again (watermark at 2000, no records above).
    await q.drain();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("drain advances watermark incrementally on partial failure", async () => {
    const rec1 = sampleRecord({ sessionId: "s1", analyzedAt: 1000 });
    const rec2 = sampleRecord({ sessionId: "s2", analyzedAt: 2000 });
    await local.upsertRecord(rec1);
    await local.upsertRecord(rec2);
    const { remote, f } = makeRemote();
    // First push succeeds (rec1, at=1000); second push fails (rec2, at=2000).
    f.mockResolvedValueOnce(mockResponse(200, { revision: 1 })).mockResolvedValueOnce(
      mockResponse(500, "boom")
    );
    const q = new PushQueue(local, remote);
    await q.enqueue(rec2);
    // Drain should fail after partial progress.
    await expect(q.drain()).rejects.toThrow(/HTTP 500/);
    // Watermark should be at 1000 (rec1 pushed); pending flag still set for 2000.
    expect(await local.readKvJson<number>(__testing.WATERMARK_PREFIX + "proj-a")).toBe(1000);
    expect(await local.readKvJson<number>(__testing.PENDING_PREFIX + "proj-a")).toBe(2000);
  });

  it("drain rethrows so callers can surface HTTP failures", async () => {
    const rec = sampleRecord({ analyzedAt: 1000 });
    await local.upsertRecord(rec);
    const { remote, f } = makeRemote();
    f.mockResolvedValue(mockResponse(404, '{"error":"not found"}'));
    const q = new PushQueue(local, remote);
    await q.enqueue(rec);
    await expect(q.drain()).rejects.toThrow(/HTTP 404/);
    expect(f).toHaveBeenCalled();
  });

  it("drain failure does not auto-retry; user re-runs drain to retry", async () => {
    const rec = sampleRecord({ analyzedAt: 1000 });
    await local.upsertRecord(rec);
    const { remote, f } = makeRemote();
    // All pushes fail.
    f.mockResolvedValue(mockResponse(500, "down"));
    const q = new PushQueue(local, remote);
    await q.enqueue(rec);
    // First drain attempt — fails after retries; must propagate to caller.
    await expect(q.drain()).rejects.toThrow(/HTTP 500/);
    const callsAfterFirst = f.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1);
    // Wait a bit to verify no auto-retry happens.
    await new Promise((r) => setTimeout(r, 200));
    expect(f.mock.calls.length).toBe(callsAfterFirst); // No retry.
    // Watermark not advanced; pending flag still set.
    expect(await local.readKvJson<number>(__testing.WATERMARK_PREFIX + "proj-a")).toBeUndefined();
    expect(await local.readKvJson<number>(__testing.PENDING_PREFIX + "proj-a")).toBe(1000);
    // Now make push succeed and re-run drain (user re-runs command).
    f.mockResolvedValue(mockResponse(200, { revision: 1 }));
    await q.drain();
    expect(f.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    expect(await local.readKvJson<number>(__testing.WATERMARK_PREFIX + "proj-a")).toBe(1000);
    expect(await local.listKvKeys(__testing.PENDING_PREFIX)).toEqual([]);
  });

  it("enqueue dedupes concurrent drains", async () => {
    const rec = sampleRecord({ analyzedAt: 1000 });
    await local.upsertRecord(rec);
    const { remote, f } = makeRemote();
    f.mockResolvedValue(mockResponse(200, { revision: 1 }));
    const q = new PushQueue(local, remote);
    // Set pending flag first so drain has something to do.
    await q.enqueue(rec);
    // Fire 2 drains concurrently — only one should actually run.
    await Promise.all([q.drain(), q.drain()]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("enqueue ignores records without projectSlug", async () => {
    const rec = sampleRecord({ projectSlug: "" });
    const { remote, f } = makeRemote();
    const q = new PushQueue(local, remote);
    await q.enqueue(rec);
    expect(f).not.toHaveBeenCalled();
    expect(await local.listKvKeys(__testing.PENDING_PREFIX)).toEqual([]);
  });

  it("drain handles multiple projects", async () => {
    const rec1 = sampleRecord({ sessionId: "s1", projectSlug: "proj-a", analyzedAt: 1000 });
    const rec2 = sampleRecord({ sessionId: "s2", projectSlug: "proj-b", analyzedAt: 2000 });
    await local.upsertRecord(rec1);
    await local.upsertRecord(rec2);
    const { remote, f } = makeRemote();
    f.mockResolvedValue(mockResponse(200, { revision: 1 }));
    const q = new PushQueue(local, remote);
    await q.enqueue(rec1);
    await q.enqueue(rec2);
    await q.drain();
    expect(f.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(await local.readKvJson<number>(__testing.WATERMARK_PREFIX + "proj-a")).toBe(1000);
    expect(await local.readKvJson<number>(__testing.WATERMARK_PREFIX + "proj-b")).toBe(2000);
  });

  it("dispose is a no-op (no retry timers to clear)", () => {
    const { remote } = makeRemote();
    const q = new PushQueue(local, remote);
    // Should not throw.
    q.dispose();
  });
});

describe("PushQueue — constants", () => {
  it("uses the documented key prefixes", () => {
    expect(__testing.WATERMARK_PREFIX).toBe("push-watermark:");
    expect(__testing.PENDING_PREFIX).toBe("push-pending:");
  });
});
