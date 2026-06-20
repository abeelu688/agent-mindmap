import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { JsonFsStore, STORE_LAYOUT, type SessionRecord } from "../../shared/src";
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

async function makeStoreDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "jsonfs-store-"));
}

describe("JsonFsStore.listProjectSummaries", () => {
  it("returns empty list for an empty store", async () => {
    const tmp = await makeStoreDir();
    const store = new JsonFsStore(tmp);
    const summaries = await store.listProjectSummaries();
    expect(summaries).toEqual([]);
  });

  it("lists projects from the MCP index when present", async () => {
    const tmp = await makeStoreDir();
    await fs.mkdir(path.join(tmp, STORE_LAYOUT.sessionsDir, "proj-a"), { recursive: true });
    await writeJsonAtomic(
      path.join(tmp, STORE_LAYOUT.sessionsDir, "proj-a", "s1.json"),
      sampleRecord({ projectSlug: "proj-a", sessionId: "s1" })
    );
    const store = new JsonFsStore(tmp);
    await store.bumpProjectRevision("proj-a", 1, {
      lastAnalyzedAt: 1000,
      projectPath: "/home/test/proj",
    });
    const summaries = await store.listProjectSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].projectSlug).toBe("proj-a");
    expect(summaries[0].sessionCount).toBe(1);
  });
});

describe("JsonFsStore.getRecord / listRecordsForProject", () => {
  it("returns undefined for missing record", async () => {
    const tmp = await makeStoreDir();
    const store = new JsonFsStore(tmp);
    expect(await store.getRecord("proj-a", "missing")).toBeUndefined();
  });

  it("reads back a record written by upsertRecord", async () => {
    const tmp = await makeStoreDir();
    const store = new JsonFsStore(tmp);
    const record = sampleRecord();
    await store.upsertRecord(record);
    const back = await store.getRecord("home-test-proj", "sess-1");
    expect(back?.meta.sessionId).toBe("sess-1");
    expect(back?.outline.title).toBe("Authentication fix");
  });

  it("lists records for a project", async () => {
    const tmp = await makeStoreDir();
    const store = new JsonFsStore(tmp);
    await store.upsertRecord(sampleRecord({ sessionId: "s1" }));
    await store.upsertRecord(sampleRecord({ sessionId: "s2", analyzedAt: 2000 }));
    const records = await store.listRecordsForProject("home-test-proj");
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.meta.sessionId).sort()).toEqual(["s1", "s2"]);
  });
});

describe("JsonFsStore.upsertRecord", () => {
  it("is idempotent on (projectSlug, sessionId) and bumps revision", async () => {
    const tmp = await makeStoreDir();
    const store = new JsonFsStore(tmp);
    const first = await store.upsertRecord(sampleRecord());
    expect(first.revision).toBe(1);
    const second = await store.upsertRecord(sampleRecord());
    expect(second.revision).toBe(2);
    const records = await store.listRecordsForProject("home-test-proj");
    expect(records).toHaveLength(1);
  });

  it("overwrites prior content on re-upsert", async () => {
    const tmp = await makeStoreDir();
    const store = new JsonFsStore(tmp);
    await store.upsertRecord(sampleRecord());
    const updated = sampleRecord({ sessionLabel: "Updated label" });
    updated.outline.title = "Updated title";
    await store.upsertRecord(updated);
    const back = await store.getRecord("home-test-proj", "sess-1");
    expect(back?.meta.sessionLabel).toBe("Updated label");
    expect(back?.outline.title).toBe("Updated title");
  });
});

describe("JsonFsStore.getProjectRevision", () => {
  it("returns 0 for an unknown project", async () => {
    const tmp = await makeStoreDir();
    const store = new JsonFsStore(tmp);
    expect(await store.getProjectRevision("unknown")).toBe(0);
  });

  it("returns the current revision after bumpProjectRevision", async () => {
    const tmp = await makeStoreDir();
    const store = new JsonFsStore(tmp);
    await store.bumpProjectRevision("proj-a", 0);
    expect(await store.getProjectRevision("proj-a")).toBe(1);
    await store.bumpProjectRevision("proj-a", 1);
    expect(await store.getProjectRevision("proj-a")).toBe(2);
  });
});

describe("JsonFsStore.readConceptTrieMerge / readLatestSegmentEquivalences", () => {
  it("returns undefined when no merge snapshot exists", async () => {
    const tmp = await makeStoreDir();
    const store = new JsonFsStore(tmp);
    expect(await store.readConceptTrieMerge()).toBeUndefined();
  });

  it("returns empty equivalences when no ontology index exists", async () => {
    const tmp = await makeStoreDir();
    const store = new JsonFsStore(tmp);
    expect(await store.readLatestSegmentEquivalences("proj-a")).toEqual([]);
  });
});
