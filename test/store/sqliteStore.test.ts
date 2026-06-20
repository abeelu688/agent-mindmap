import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStore, type SessionRecord } from "../../shared/src";
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

async function makeDbPath(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sqlite-store-"));
  return path.join(tmp, "store.db");
}

describe("SqliteStore.listProjectSummaries", () => {
  let dbPath: string;
  let store: SqliteStore;

  beforeEach(async () => {
    dbPath = await makeDbPath();
    store = new SqliteStore(dbPath);
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("returns empty list for an empty store", async () => {
    const summaries = await store.listProjectSummaries();
    expect(summaries).toEqual([]);
  });

  it("lists projects after bumpProjectRevision", async () => {
    await store.bumpProjectRevision("proj-a", 1, {
      lastAnalyzedAt: 1000,
      projectPath: "/home/test/proj",
    });
    const summaries = await store.listProjectSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].projectSlug).toBe("proj-a");
    expect(summaries[0].sessionCount).toBe(1);
    expect(summaries[0].projectPath).toBe("/home/test/proj");
  });

  it("sorts projects by lastAnalyzedAt descending", async () => {
    await store.bumpProjectRevision("older", 1, { lastAnalyzedAt: 1000 });
    await store.bumpProjectRevision("newer", 1, { lastAnalyzedAt: 3000 });
    const summaries = await store.listProjectSummaries();
    expect(summaries.map((s) => s.projectSlug)).toEqual(["newer", "older"]);
  });
});

describe("SqliteStore.getRecord / listRecordsForProject", () => {
  let dbPath: string;
  let store: SqliteStore;

  beforeEach(async () => {
    dbPath = await makeDbPath();
    store = new SqliteStore(dbPath);
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("returns undefined for missing record", async () => {
    expect(await store.getRecord("proj-a", "missing")).toBeUndefined();
  });

  it("reads back a record written by upsertRecord", async () => {
    const record = sampleRecord();
    await store.upsertRecord(record);
    const back = await store.getRecord("home-test-proj", "sess-1");
    expect(back?.meta.sessionId).toBe("sess-1");
    expect(back?.outline.title).toBe("Authentication fix");
    // graph is backfilled from outline on read (validateAndBackfillRecord).
    expect(back?.graph).toBeDefined();
  });

  it("lists records for a project", async () => {
    await store.upsertRecord(sampleRecord({ sessionId: "s1" }));
    await store.upsertRecord(sampleRecord({ sessionId: "s2", analyzedAt: 2000 }));
    const records = await store.listRecordsForProject("home-test-proj");
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.meta.sessionId).sort()).toEqual(["s1", "s2"]);
  });
});

describe("SqliteStore.upsertRecord", () => {
  let dbPath: string;
  let store: SqliteStore;

  beforeEach(async () => {
    dbPath = await makeDbPath();
    store = new SqliteStore(dbPath);
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("is idempotent on (projectSlug, sessionId) and bumps revision", async () => {
    const first = await store.upsertRecord(sampleRecord());
    expect(first.revision).toBe(1);
    const second = await store.upsertRecord(sampleRecord());
    expect(second.revision).toBe(2);
    const records = await store.listRecordsForProject("home-test-proj");
    expect(records).toHaveLength(1);
  });

  it("overwrites prior content on re-upsert", async () => {
    await store.upsertRecord(sampleRecord());
    const updated = sampleRecord({ sessionLabel: "Updated label" });
    updated.outline.title = "Updated title";
    await store.upsertRecord(updated);
    const back = await store.getRecord("home-test-proj", "sess-1");
    expect(back?.meta.sessionLabel).toBe("Updated label");
    expect(back?.outline.title).toBe("Updated title");
  });

  it("bumps revision independently per project", async () => {
    await store.upsertRecord(sampleRecord({ projectSlug: "proj-a", sessionId: "a1" }));
    await store.upsertRecord(sampleRecord({ projectSlug: "proj-b", sessionId: "b1" }));
    expect(await store.getProjectRevision("proj-a")).toBe(1);
    expect(await store.getProjectRevision("proj-b")).toBe(1);
    await store.upsertRecord(sampleRecord({ projectSlug: "proj-a", sessionId: "a1" }));
    expect(await store.getProjectRevision("proj-a")).toBe(2);
    expect(await store.getProjectRevision("proj-b")).toBe(1);
  });

  it("updates record_count in the projects row", async () => {
    await store.upsertRecord(sampleRecord({ sessionId: "s1" }));
    await store.upsertRecord(sampleRecord({ sessionId: "s2" }));
    expect(await store.getProjectRecordCount("home-test-proj")).toBe(2);
    const summaries = await store.listProjectSummaries();
    expect(summaries[0].sessionCount).toBe(2);
  });
});

describe("SqliteStore.getProjectRevision / getProjectRecordCount", () => {
  let dbPath: string;
  let store: SqliteStore;

  beforeEach(async () => {
    dbPath = await makeDbPath();
    store = new SqliteStore(dbPath);
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("returns 0 / undefined for an unknown project", async () => {
    expect(await store.getProjectRevision("unknown")).toBe(0);
    expect(await store.getProjectRecordCount("unknown")).toBeUndefined();
  });

  it("returns the current revision after bumpProjectRevision", async () => {
    await store.bumpProjectRevision("proj-a", 0);
    expect(await store.getProjectRevision("proj-a")).toBe(1);
    await store.bumpProjectRevision("proj-a", 1);
    expect(await store.getProjectRevision("proj-a")).toBe(2);
  });
});

describe("SqliteStore.readConceptTrieMerge / readLatestSegmentEquivalences", () => {
  let dbPath: string;
  let store: SqliteStore;

  beforeEach(async () => {
    dbPath = await makeDbPath();
    store = new SqliteStore(dbPath);
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("returns undefined when no merge snapshot exists", async () => {
    expect(await store.readConceptTrieMerge()).toBeUndefined();
  });

  it("returns empty equivalences when no ontology index exists", async () => {
    expect(await store.readLatestSegmentEquivalences("proj-a")).toEqual([]);
  });

  it("round-trips a concept-trie merge through writeConceptTrieMerge", async () => {
    const merge: MergeRecord = {
      schemaVersion: 1,
      meta: { kind: "deterministic", builtAt: 12345, sessionIds: ["s1"], projectSlugs: ["proj-a"] },
      mindMap: { data: { text: "Root" } },
    };
    await store.writeConceptTrieMerge(merge);
    const back = await store.readConceptTrieMerge();
    expect(back?.schemaVersion).toBe(1);
    expect(back?.meta.kind).toBe("deterministic");
    expect(back?.mindMap.data.text).toBe("Root");
  });

  it("returns the latest equivalences whose index entry includes the project", async () => {
    const olderEq: SegmentEquivalence[] = [
      {
        canonical: "auth",
        aliases: ["signin"],
        scope: { projectSlugs: ["proj-a"] },
        confidence: 0.8,
      },
    ];
    const newerEq: SegmentEquivalence[] = [
      {
        canonical: "auth",
        aliases: ["signin", "log-in"],
        scope: { projectSlugs: ["proj-a"] },
        confidence: 0.9,
      },
    ];
    const index: OntologyIndex = {
      schemaVersion: 1,
      updatedAt: 5000,
      entries: [
        { cacheKey: "older", builtAt: 1000, sessionIds: ["s1"], projectSlugs: ["proj-a"] },
        { cacheKey: "newer", builtAt: 2000, sessionIds: ["s2"], projectSlugs: ["proj-a"] },
      ],
    };
    const olderRecord: OntologyRecord = {
      schemaVersion: 1,
      meta: { builtAt: 1000, sessionIds: ["s1"], projectSlugs: ["proj-a"] },
      segmentEquivalences: olderEq,
    };
    const newerRecord: OntologyRecord = {
      schemaVersion: 1,
      meta: { builtAt: 2000, sessionIds: ["s2"], projectSlugs: ["proj-a"] },
      segmentEquivalences: newerEq,
    };
    await store.writeOntologyIndex(index);
    await store.writeOntologyRecord("older", olderRecord);
    await store.writeOntologyRecord("newer", newerRecord);

    const back = await store.readLatestSegmentEquivalences("proj-a");
    expect(back).toEqual(newerEq);
  });

  it("skips equivalences whose index entry does not include the project", async () => {
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
    await store.writeOntologyIndex(index);
    await store.writeOntologyRecord("k1", {
      schemaVersion: 1,
      meta: { builtAt: 1000, sessionIds: ["s1"], projectSlugs: ["proj-a"] },
      segmentEquivalences: eq,
    });
    expect(await store.readLatestSegmentEquivalences("proj-b")).toEqual([]);
    expect(await store.readLatestSegmentEquivalences("proj-a")).toEqual(eq);
  });
});

describe("SqliteStore.bumpProjectRevision", () => {
  let dbPath: string;
  let store: SqliteStore;

  beforeEach(async () => {
    dbPath = await makeDbPath();
    store = new SqliteStore(dbPath);
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("preserves lastAnalyzedAt from previous bump when not re-supplied", async () => {
    await store.bumpProjectRevision("proj-a", 1, { lastAnalyzedAt: 1000 });
    await store.bumpProjectRevision("proj-a", 2);
    const summaries = await store.listProjectSummaries();
    expect(summaries[0].lastAnalyzedAt).toBe(1000);
    expect(summaries[0].sessionCount).toBe(2);
  });

  it("preserves projectPath from previous bump when not re-supplied", async () => {
    await store.bumpProjectRevision("proj-a", 1, { projectPath: "/home/a" });
    await store.bumpProjectRevision("proj-a", 2);
    const summaries = await store.listProjectSummaries();
    expect(summaries[0].projectPath).toBe("/home/a");
  });

  it("returns an McpIndexFile-shaped result with all projects", async () => {
    await store.bumpProjectRevision("proj-a", 1, { lastAnalyzedAt: 1000 });
    const index = await store.bumpProjectRevision("proj-b", 2, { lastAnalyzedAt: 2000 });
    expect(index.schemaVersion).toBe(1);
    expect(Object.keys(index.projects).sort()).toEqual(["proj-a", "proj-b"]);
    expect(index.projects["proj-a"].revision).toBe(1);
    expect(index.projects["proj-b"].revision).toBe(1);
  });
});

describe("SqliteStore schema is idempotent", () => {
  it("opens and re-opens the same DB file without error", async () => {
    const dbPath = await makeDbPath();
    const store1 = new SqliteStore(dbPath);
    await store1.upsertRecord(sampleRecord());
    await store1.close();
    const store2 = new SqliteStore(dbPath);
    const back = await store2.getRecord("home-test-proj", "sess-1");
    expect(back?.meta.sessionId).toBe("sess-1");
    await store2.close();
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });
});
