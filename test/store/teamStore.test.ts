import { describe, expect, it, vi } from "vitest";
import {
  RemoteStore,
  RemoteStoreNotSupported,
  TeamStore,
  type PushQueueLike,
  type SessionRecord,
  type Store,
} from "../../shared/src";

function sampleRecord(overrides?: Partial<SessionRecord["meta"]>): SessionRecord {
  return {
    schemaVersion: 1,
    meta: {
      sessionId: "s1",
      projectSlug: "proj-a",
      projectPath: "/p",
      transcriptPath: "/t",
      transcriptMtimeMs: 1,
      transcriptFreshnessToken: "1",
      analyzedAt: 1000,
      llm: { provider: "cursor-cli" },
      promptParams: { maxTopics: 8, maxItemsPerTopic: 6 },
      sessionLabel: "L",
      ...overrides,
    },
    outline: {
      title: "T",
      summary: "s",
      outline: [{ title: "N", details: [{ text: "d" }] }],
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

/** Minimal local Store stub — records upsert calls + returns canned reads. */
function makeLocalStub(): Store & {
  upsurtCalls: SessionRecord[];
  upsurtResult: { revision: number };
} {
  const stub: Store & { upsurtCalls: SessionRecord[]; upsurtResult: { revision: number } } = {
    upsurtCalls: [],
    upsurtResult: { revision: 1 },
    async listProjectSummaries() {
      return [];
    },
    async getProjectRevision() {
      return 0;
    },
    async getProjectRecordCount() {
      return undefined;
    },
    async getRecord() {
      return undefined;
    },
    async listRecordsForProject() {
      return [];
    },
    async listAllRecords() {
      return [];
    },
    async upsertRecord(record: SessionRecord) {
      this.upsurtCalls.push(record);
      return this.upsurtResult;
    },
    async deleteProjectRecords() {
      throw new Error("not implemented in stub");
    },
    async readConceptTrieMerge() {
      return undefined;
    },
    async writeConceptTrieMerge() {},
    async readDeterministicMerge() {
      return undefined;
    },
    async writeDeterministicMerge() {},
    async readLlmRefinedMerge() {
      return undefined;
    },
    async writeLlmRefinedMerge() {},
    async readLlmMergeCache() {
      return undefined;
    },
    async writeLlmMergeCache() {},
    async readOntologyIndex() {
      return undefined;
    },
    async writeOntologyIndex() {},
    async readOntologyRecord() {
      return undefined;
    },
    async writeOntologyRecord() {},
    async clearOntologyCache() {},
    async readLatestSegmentEquivalences() {
      return [];
    },
    async bumpProjectRevision() {
      return {
        schemaVersion: 1,
        updatedAt: 0,
        projects: {},
      };
    },
  };
  return stub;
}

function makeQueue(): PushQueueLike & { enqueued: SessionRecord[]; drainCalls: number } {
  const q: PushQueueLike & { enqueued: SessionRecord[]; drainCalls: number } = {
    enqueued: [],
    drainCalls: 0,
    async enqueue(record: SessionRecord) {
      this.enqueued.push(record);
    },
    async drain() {
      this.drainCalls += 1;
    },
  };
  return q;
}

describe("TeamStore — session record reads (local only)", () => {
  it("listProjectSummaries calls remote", async () => {
    const f = vi.fn().mockResolvedValue(mockResponse(200, []));
    const remote = new RemoteStore("https://x/v1", "k", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    const ts = new TeamStore(makeLocalStub(), remote, makeQueue());
    await ts.listProjectSummaries();
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("https://x/v1/projects");
  });

  it("getRecord reads local only and does not call remote", async () => {
    const localRec = sampleRecord({ analyzedAt: 2000 });
    const local = makeLocalStub();
    local.getRecord = vi.fn().mockResolvedValue(localRec);
    const f = vi.fn();
    const remote = new RemoteStore("https://x", "k", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    const ts = new TeamStore(local, remote, makeQueue());
    const got = await ts.getRecord("proj-a", "s1");
    expect(got?.meta.analyzedAt).toBe(2000);
    expect(local.getRecord).toHaveBeenCalledWith("proj-a", "s1");
    expect(f).not.toHaveBeenCalled();
  });

  it("getRecord returns undefined when local has no record (no remote fallback)", async () => {
    const local = makeLocalStub();
    local.getRecord = vi.fn().mockResolvedValue(undefined);
    const rec = sampleRecord();
    const f = vi.fn().mockResolvedValue(mockResponse(200, rec));
    const remote = new RemoteStore("https://x", "k", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    const ts = new TeamStore(local, remote, makeQueue());
    const got = await ts.getRecord("proj-a", "s1");
    expect(got).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it("listRecordsForProject reads local only", async () => {
    const localRec = sampleRecord();
    const local = makeLocalStub();
    local.listRecordsForProject = vi.fn().mockResolvedValue([localRec]);
    const f = vi.fn().mockResolvedValue(mockResponse(200, [sampleRecord({ sessionId: "remote" })]));
    const remote = new RemoteStore("https://x", "k", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    const ts = new TeamStore(local, remote, makeQueue());
    const got = await ts.listRecordsForProject("proj-a");
    expect(got).toHaveLength(1);
    expect(got[0]?.meta.sessionId).toBe("s1");
    expect(f).not.toHaveBeenCalled();
  });
});

describe("TeamStore — upsertRecord writes local only (no auto-push)", () => {
  it("writes to local store without calling queue or remote", async () => {
    const f = vi.fn().mockResolvedValue(mockResponse(200, { revision: 1 }));
    const remote = new RemoteStore("https://x", "k", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    const local = makeLocalStub();
    const queue = makeQueue();
    const ts = new TeamStore(local, remote, queue);
    const rec = sampleRecord();
    const result = await ts.upsertRecord(rec);
    expect(result.revision).toBe(1);
    expect(local.upsurtCalls).toHaveLength(1);
    expect(local.upsurtCalls[0]).toBe(rec);
    // upsertRecord no longer calls queue.enqueue — push is manual only.
    expect(queue.enqueued).toHaveLength(0);
    // Should NOT have POSTed synchronously.
    expect(f).not.toHaveBeenCalled();
  });
});

describe("TeamStore — unsupported mutators throw", () => {
  it("deleteProjectRecords throws RemoteStoreNotSupported", async () => {
    const f = vi.fn();
    const remote = new RemoteStore("https://x", "k", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    const ts = new TeamStore(makeLocalStub(), remote, makeQueue());
    await expect(ts.deleteProjectRecords("p")).rejects.toBeInstanceOf(RemoteStoreNotSupported);
  });
});

describe("TeamStore — merge/ontology reads and writes (local only)", () => {
  it("writeConceptTrieMerge writes to local, not remote", async () => {
    const f = vi.fn();
    const remote = new RemoteStore("https://x", "k", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    const local = makeLocalStub();
    const writeSpy = vi.spyOn(local, "writeConceptTrieMerge");
    const ts = new TeamStore(local, remote, makeQueue());
    const merge = { schemaVersion: 1 } as never;
    await ts.writeConceptTrieMerge(merge);
    expect(writeSpy).toHaveBeenCalledWith(merge);
    expect(f).not.toHaveBeenCalled();
  });

  it("readConceptTrieMerge reads from local", async () => {
    const merge = { schemaVersion: 1, meta: {}, mindMap: { data: { text: "t" } } } as never;
    const local = makeLocalStub();
    local.readConceptTrieMerge = vi.fn().mockResolvedValue(merge);
    const f = vi.fn();
    const remote = new RemoteStore("https://x", "k", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    const ts = new TeamStore(local, remote, makeQueue());
    const got = await ts.readConceptTrieMerge();
    expect(got).toBe(merge);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("TeamStore — bumpProjectRevision (local)", () => {
  it("bumpProjectRevision delegates to local store", async () => {
    const f = vi.fn();
    const remote = new RemoteStore("https://x", "k", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    const local = makeLocalStub();
    const bumpSpy = vi.spyOn(local, "bumpProjectRevision").mockResolvedValue({
      schemaVersion: 1,
      updatedAt: 42,
      projects: { "proj-a": { revision: 3, recordCount: 5, lastBuiltAt: 42 } },
    });
    const ts = new TeamStore(local, remote, makeQueue());
    const result = await ts.bumpProjectRevision("proj-a", 5);
    expect(bumpSpy).toHaveBeenCalledWith("proj-a", 5, undefined);
    expect(result.projects["proj-a"]?.revision).toBe(3);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("TeamStore — accessors", () => {
  it("getRemoteStore returns the wrapped RemoteStore", () => {
    const f = vi.fn();
    const remote = new RemoteStore("https://x", "k", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    const ts = new TeamStore(makeLocalStub(), remote, makeQueue());
    expect(ts.getRemoteStore()).toBe(remote);
  });

  it("getLocalStore returns the wrapped local store", () => {
    const f = vi.fn();
    const remote = new RemoteStore("https://x", "k", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    const local = makeLocalStub();
    const ts = new TeamStore(local, remote, makeQueue());
    expect(ts.getLocalStore()).toBe(local);
  });

  it("getPushQueue returns the wrapped queue", () => {
    const f = vi.fn();
    const remote = new RemoteStore("https://x", "k", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    const queue = makeQueue();
    const ts = new TeamStore(makeLocalStub(), remote, queue);
    expect(ts.getPushQueue()).toBe(queue);
  });
});
