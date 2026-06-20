import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapStore, JsonFsStore, STORE_LAYOUT, type SessionRecord } from "../../shared/src";
import { writeJsonAtomic } from "../../shared/src/atomicWrite";

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

async function writeSession(storeDir: string, record: SessionRecord): Promise<void> {
  const file = path.join(
    storeDir,
    STORE_LAYOUT.sessionsDir,
    record.meta.projectSlug,
    `${record.meta.sessionId}.json`
  );
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeJsonAtomic(file, record);
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
      // ignore — already closed or JsonFsStore (no close)
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

  it("migrates legacy JSON into a new SqliteStore when no DB exists", async () => {
    await writeSession(env.storeDir, sampleRecord({ projectSlug: "proj-a", sessionId: "s1" }));
    await writeSession(
      env.storeDir,
      sampleRecord({ projectSlug: "proj-a", sessionId: "s2", analyzedAt: 2000 })
    );

    const result = await bootstrapStore(env.storeDir);
    current = result;
    expect(result.kind).toBe("sqlite-migrated");
    expect(result.migrated).toBe(true);
    expect(result.migration?.sessionCount).toBe(2);

    const records = await result.store.listRecordsForProject("proj-a");
    expect(records.map((r) => r.meta.sessionId).sort()).toEqual(["s1", "s2"]);
  });

  it("reuses an existing store.db without migrating", async () => {
    // First launch creates + migrates.
    await writeSession(env.storeDir, sampleRecord({ sessionId: "s1" }));
    const first = await bootstrapStore(env.storeDir);
    current = first;
    expect(first.kind).toBe("sqlite-migrated");

    // Add a second JSON record after the DB exists. Second launch should NOT
    // migrate (DB already exists) — the late JSON file is ignored by bootstrap.
    await writeSession(env.storeDir, sampleRecord({ sessionId: "s2", analyzedAt: 2000 }));
    const second = await bootstrapStore(env.storeDir);
    // Close the first store before superseding it (two handles on one DB is fine
    // for reads, but be tidy).
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

  it("falls back to JsonFsStore when store.db exists but is corrupt", async () => {
    // Legacy JSON the fallback can read.
    await writeSession(env.storeDir, sampleRecord({ sessionId: "s1" }));
    // Poison store.db with non-SQLite content.
    await fs.writeFile(path.join(env.storeDir, "store.db"), "NOT A DATABASE\n");

    const result = await bootstrapStore(env.storeDir);
    current = result;
    expect(result.kind).toBe("sqlite-fallback-json");
    expect(result.warning).toMatch(/not a valid SQLite database/i);
    expect(result.store).toBeInstanceOf(JsonFsStore);

    const back = await result.store.getRecord("home-test-proj", "s1");
    expect(back?.meta.sessionId).toBe("s1");
  });
});
