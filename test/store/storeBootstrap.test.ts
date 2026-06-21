import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapStore, STORE_LAYOUT, type SessionRecord } from "../../shared/src";

function sampleRecord(overrides?: Partial<SessionRecord["meta"]>): SessionRecord {
  return {
    schemaVersion: 1,
    meta: {
      sessionId: "sess-1",
      projectSlug: "home-test-proj",
      projectPath: "/home/test/proj",
      transcriptPath: "/tmp/sess-1.jsonl",
      transcriptMtimeMs: 1,
      analyzedAt: 1000,
      llm: { provider: "cursor-cli" },
      promptParams: { maxTopics: 8, maxItemsPerTopic: 6 },
      sessionLabel: "Fix auth bug",
      ...overrides,
    },
    outline: {
      title: "Authentication fix",
      summary: "Investigated JWT refresh failures in login flow.",
      outline: [
        {
          title: "Token refresh",
          summary: "Refresh endpoint returned 401 when clock skew exceeded tolerance.",
          details: [{ text: "Adjusted leeway in verify options." }],
        },
      ],
    },
    conceptContexts: [
      {
        key: "auth",
        label: "Authentication",
        aliases: ["login security"],
        domainKeys: ["backend"],
        parentKeys: [],
        childKeys: ["jwt"],
        evidence: ["Refresh endpoint returned 401 under clock skew."],
        sessionId: "sess-1",
        projectSlug: "home-test-proj",
      },
    ],
  };
}

async function makeTmp(): Promise<{ storeDir: string; cleanup: () => Promise<void> }> {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "bootstrap-store-"));
  return { storeDir, cleanup: async () => fs.rm(storeDir, { recursive: true, force: true }) };
}

describe("bootstrapStore", () => {
  let env: Awaited<ReturnType<typeof makeTmp>>;
  let current: { store: { close?: () => Promise<void> } } | undefined;

  beforeEach(async () => {
    env = await makeTmp();
    current = undefined;
  });

  afterEach(async () => {
    // Close any SqliteStore the test created so file handles release before
    // tmp-dir cleanup. The Store interface has no close(); SqliteStore does.
    try {
      await current?.store?.close?.();
    } catch {
      // ignore — already closed
    }
    await env.cleanup();
  });

  it("returns an empty SqliteStore for a fresh dir (no DB, no JSON)", async () => {
    const result = await bootstrapStore(env.storeDir);
    current = result;
    expect(result.kind).toBe("sqlite");
    expect(result.migrated).toBeUndefined();
    expect(await result.store.listProjectSummaries()).toEqual([]);
    expect(await fs.access(path.join(env.storeDir, "store.db"))).toBeUndefined();
  });

  it("reuses an existing store.db without migrating", async () => {
    // First launch creates a DB.
    const first = await bootstrapStore(env.storeDir);
    current = first;
    // Write a record to the DB.
    await first.store.upsertRecord(sampleRecord({ sessionId: "s1" }));

    // Second launch should reuse the existing DB.
    const second = await bootstrapStore(env.storeDir);
    // Close the first store before superseding it.
    try {
      await (first.store as { close?: () => Promise<void> }).close?.();
    } catch {
      // ignore
    }
    current = second;
    expect(second.kind).toBe("sqlite");
    expect(second.migrated).toBeUndefined();

    const records = await second.store.listRecordsForProject("home-test-proj");
    expect(records.map((r) => r.meta.sessionId)).toEqual(["s1"]);
  });

  it("throws when store.db exists but is corrupt (no JsonFsStore fallback)", async () => {
    // Poison store.db with non-SQLite content.
    await fs.writeFile(path.join(env.storeDir, "store.db"), "NOT A DATABASE\n");
    await expect(bootstrapStore(env.storeDir)).rejects.toThrow(/not a valid SQLite database/);
  });

  it("deletes legacy JSON session dirs on first launch when DB is healthy", async () => {
    // Create a healthy DB first.
    const first = await bootstrapStore(env.storeDir);
    current = first;
    await first.store.upsertRecord(sampleRecord({ sessionId: "s1" }));

    // Create legacy JSON sessions dir (simulating pre-P2.4 data).
    const sessionsDir = path.join(env.storeDir, STORE_LAYOUT.sessionsDir, "proj-a");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(path.join(sessionsDir, "old.json"), "{}");

    // Second bootstrap should delete the legacy JSON dir.
    const second = await bootstrapStore(env.storeDir);
    try {
      await (first.store as { close?: () => Promise<void> }).close?.();
    } catch {
      // ignore
    }
    current = second;

    // Legacy JSON dir should be gone.
    await expect(fs.access(path.join(env.storeDir, STORE_LAYOUT.sessionsDir))).rejects.toThrow();
  });

  it("only deletes legacy JSON dirs once (idempotent across launches)", async () => {
    // Create a healthy DB first.
    const first = await bootstrapStore(env.storeDir);
    current = first;

    // Create legacy JSON sessions dir.
    const sessionsDir = path.join(env.storeDir, STORE_LAYOUT.sessionsDir, "proj-a");
    await fs.mkdir(sessionsDir, { recursive: true });

    // First bootstrap with legacy dir present → deletion + flag set.
    const second = await bootstrapStore(env.storeDir);
    try {
      await (first.store as { close?: () => Promise<void> }).close?.();
    } catch {
      // ignore
    }
    current = second;

    // Create the dir again manually. Third bootstrap should NOT delete it
    // (flag already set).
    await fs.mkdir(path.join(env.storeDir, STORE_LAYOUT.sessionsDir, "proj-b"), {
      recursive: true,
    });
    const third = await bootstrapStore(env.storeDir);
    try {
      await (second.store as { close?: () => Promise<void> }).close?.();
    } catch {
      // ignore
    }
    current = third;

    // The re-created dir should still exist (flag prevented re-deletion).
    await expect(
      fs.access(path.join(env.storeDir, STORE_LAYOUT.sessionsDir))
    ).resolves.toBeUndefined();
  });
});
