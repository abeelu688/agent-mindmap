import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SqliteStore,
  STORE_LAYOUT,
  migrateJsonToSqlite,
  type SessionRecord,
} from "../../shared/src";
import { writeJsonAtomic } from "../../shared/src/atomicWrite";
import type {
  MergeRecord,
  OntologyIndex,
  OntologyRecord,
  SegmentEquivalence,
} from "../../shared/src/storeTypes";

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

async function makeTmp(): Promise<{
  storeDir: string;
  dbPath: string;
  cleanup: () => Promise<void>;
}> {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "migrate-json-"));
  const dbPath = path.join(storeDir, "store.db");
  return {
    storeDir,
    dbPath,
    cleanup: async () => {
      await fs.rm(storeDir, { recursive: true, force: true });
    },
  };
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

describe("migrateJsonToSqlite — session records", () => {
  let env: Awaited<ReturnType<typeof makeTmp>>;
  let sqlite: SqliteStore;

  beforeEach(async () => {
    env = await makeTmp();
    sqlite = new SqliteStore(env.dbPath);
    await sqlite.listProjectSummaries();
  });

  afterEach(async () => {
    await sqlite.close();
    await env.cleanup();
  });

  it("imports session records so SqliteStore reads them back identically", async () => {
    await writeSession(env.storeDir, sampleRecord({ projectSlug: "proj-a", sessionId: "s1" }));
    await writeSession(
      env.storeDir,
      sampleRecord({ projectSlug: "proj-a", sessionId: "s2", analyzedAt: 2000 })
    );
    await writeSession(env.storeDir, sampleRecord({ projectSlug: "proj-b", sessionId: "b1" }));

    const result = await migrateJsonToSqlite(env.storeDir, sqlite);

    expect(result.sessionCount).toBe(3);
    expect(result.skippedSessionCount).toBe(0);
    expect(result.projectSlugs).toEqual(["proj-a", "proj-b"]);

    const aRecords = await sqlite.listRecordsForProject("proj-a");
    expect(aRecords.map((r) => r.meta.sessionId).sort()).toEqual(["s1", "s2"]);
    const b1 = await sqlite.getRecord("proj-b", "b1");
    expect(b1?.outline.title).toBe("Authentication fix");
    expect(b1?.graph).toBeDefined();
  });

  it("is a no-op on re-run (skip-if-identical, no duplicate, no revision bump)", async () => {
    await writeSession(env.storeDir, sampleRecord({ sessionId: "s1" }));
    const first = await migrateJsonToSqlite(env.storeDir, sqlite);
    expect(first.sessionCount).toBe(1);
    const revAfterFirst = await sqlite.getProjectRevision("home-test-proj");

    const second = await migrateJsonToSqlite(env.storeDir, sqlite);
    expect(second.sessionCount).toBe(0);
    expect(second.skippedSessionCount).toBe(1);
    const revAfterSecond = await sqlite.getProjectRevision("home-test-proj");
    expect(revAfterSecond).toBe(revAfterFirst);

    const records = await sqlite.listRecordsForProject("home-test-proj");
    expect(records).toHaveLength(1);
  });

  it("re-imports a record whose analyzedAt changed", async () => {
    await writeSession(env.storeDir, sampleRecord({ sessionId: "s1", analyzedAt: 1000 }));
    await migrateJsonToSqlite(env.storeDir, sqlite);

    await writeSession(env.storeDir, sampleRecord({ sessionId: "s1", analyzedAt: 5000 }));
    const second = await migrateJsonToSqlite(env.storeDir, sqlite);
    expect(second.sessionCount).toBe(1);
    expect(second.skippedSessionCount).toBe(0);

    const back = await sqlite.getRecord("home-test-proj", "s1");
    expect(back?.meta.analyzedAt).toBe(5000);
  });

  it("skips unreadable / non-record JSON files without throwing", async () => {
    const file = path.join(env.storeDir, STORE_LAYOUT.sessionsDir, "proj-a", "garbage.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{not valid json");
    await writeSession(env.storeDir, sampleRecord({ projectSlug: "proj-a", sessionId: "s1" }));

    const result = await migrateJsonToSqlite(env.storeDir, sqlite);
    expect(result.sessionCount).toBe(1);
    expect(await sqlite.getRecord("proj-a", "s1")).toBeDefined();
  });

  it("returns empty result for a store dir with no JSON", async () => {
    const result = await migrateJsonToSqlite(env.storeDir, sqlite);
    expect(result.sessionCount).toBe(0);
    expect(result.projectSlugs).toEqual([]);
    expect(result.migratedConceptTrie).toBe(false);
    expect(result.snapshotFiles).toEqual([]);
  });
});

describe("migrateJsonToSqlite — concept-trie and ontology", () => {
  let env: Awaited<ReturnType<typeof makeTmp>>;
  let sqlite: SqliteStore;

  beforeEach(async () => {
    env = await makeTmp();
    sqlite = new SqliteStore(env.dbPath);
    await sqlite.listProjectSummaries();
  });

  afterEach(async () => {
    await sqlite.close();
    await env.cleanup();
  });

  it("migrates the concept-trie merge", async () => {
    const merge: MergeRecord = {
      schemaVersion: 1,
      meta: { kind: "deterministic", builtAt: 12345, sessionIds: ["s1"], projectSlugs: ["proj-a"] },
      mindMap: { data: { text: "Root" } },
    };
    await fs.mkdir(path.join(env.storeDir, STORE_LAYOUT.mergesDir), { recursive: true });
    await writeJsonAtomic(path.join(env.storeDir, STORE_LAYOUT.conceptTrieFile), merge);

    const result = await migrateJsonToSqlite(env.storeDir, sqlite);
    expect(result.migratedConceptTrie).toBe(true);

    const back = await sqlite.readConceptTrieMerge();
    expect(back?.schemaVersion).toBe(1);
    expect(back?.mindMap.data.text).toBe("Root");
  });

  it("migrates the ontology index and referenced cache records", async () => {
    const eq: SegmentEquivalence[] = [
      {
        canonical: "auth",
        aliases: ["signin"],
        scope: { projectSlugs: ["proj-a"] },
        confidence: 0.9,
      },
    ];
    const index: OntologyIndex = {
      schemaVersion: 1,
      updatedAt: 5000,
      entries: [{ cacheKey: "k1", builtAt: 1000, sessionIds: ["s1"], projectSlugs: ["proj-a"] }],
    };
    const record: OntologyRecord = {
      schemaVersion: 1,
      meta: { builtAt: 1000, sessionIds: ["s1"], projectSlugs: ["proj-a"] },
      segmentEquivalences: eq,
    };
    await fs.mkdir(path.join(env.storeDir, STORE_LAYOUT.ontologyCacheDir), { recursive: true });
    await writeJsonAtomic(path.join(env.storeDir, STORE_LAYOUT.ontologyIndexFile), index);
    await writeJsonAtomic(
      path.join(env.storeDir, STORE_LAYOUT.ontologyCacheDir, "k1.json"),
      record
    );

    const result = await migrateJsonToSqlite(env.storeDir, sqlite);
    expect(result.migratedOntologyIndex).toBe(true);
    expect(result.ontologyRecordCount).toBe(1);

    const back = await sqlite.readLatestSegmentEquivalences("proj-a");
    expect(back).toEqual(eq);
  });
});

describe("migrateJsonToSqlite — snapshot boundary", () => {
  let env: Awaited<ReturnType<typeof makeTmp>>;
  let sqlite: SqliteStore;

  beforeEach(async () => {
    env = await makeTmp();
    sqlite = new SqliteStore(env.dbPath);
    await sqlite.listProjectSummaries();
  });

  afterEach(async () => {
    await sqlite.close();
    await env.cleanup();
  });

  it("a JSON file added after the first migration is absent until a re-run", async () => {
    await writeSession(env.storeDir, sampleRecord({ sessionId: "s1" }));
    await migrateJsonToSqlite(env.storeDir, sqlite);
    expect(await sqlite.getRecord("home-test-proj", "s1")).toBeDefined();

    // Late write — not part of the already-completed migration's snapshot.
    await writeSession(env.storeDir, sampleRecord({ sessionId: "s2", analyzedAt: 2000 }));
    expect(await sqlite.getRecord("home-test-proj", "s2")).toBeUndefined();

    // Re-run picks it up; the unchanged s1 is skipped.
    const second = await migrateJsonToSqlite(env.storeDir, sqlite);
    expect(second.sessionCount).toBe(1);
    expect(second.skippedSessionCount).toBe(1);
    expect(await sqlite.getRecord("home-test-proj", "s2")).toBeDefined();
  });
});
