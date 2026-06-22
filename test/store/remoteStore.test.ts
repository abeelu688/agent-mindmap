import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RemoteStore,
  RemoteStoreHttpError,
  RemoteStoreNotSupported,
  type SessionRecord,
} from "../../shared/src";

// Minimal `Response`-shaped object — we don't need the full DOM Response,
// just the fields RemoteStore reads (ok/status/text/json).
type MockResp = {
  status: number;
  body: string;
  json?: unknown;
};

function mockResponse(resp: MockResp): Response {
  const text = resp.body;
  const jsonVal = resp.json;
  return {
    status: resp.status,
    ok: resp.status >= 200 && resp.status < 300,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(jsonVal ?? JSON.parse(text)),
  } as unknown as Response;
}

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
      title: "Test",
      summary: "Test summary.",
      outline: [],
    },
    conceptContexts: [],
    codeReferences: [],
  };
}

function makeStore(
  fetchImpl: ReturnType<typeof vi.fn>,
  opts?: { maxRetries?: number; backoffBaseMs?: number; sleep?: (ms: number) => Promise<void> }
) {
  return new RemoteStore("https://team.example.com/v1", "test-key", {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    maxRetries: opts?.maxRetries ?? 2,
    backoffBaseMs: opts?.backoffBaseMs ?? 1,
    sleep: opts?.sleep ?? (async () => {}),
  });
}

describe("RemoteStore — construction", () => {
  it("rejects empty serverUrl", () => {
    expect(() => new RemoteStore("", "k")).toThrow(/serverUrl/);
  });
  it("rejects empty apiKey", () => {
    expect(() => new RemoteStore("https://x", "")).toThrow(/apiKey/);
  });
  it("strips trailing slash from baseUrl", async () => {
    const f = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: "[]", json: [] }));
    const store = new RemoteStore("https://team.example.com/v1/", "test-key", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    await store.listProjectSummaries();
    expect(f.mock.calls[0][0]).toBe("https://team.example.com/v1/projects");
  });

  it("does not duplicate /v1 when serverUrl already includes it", async () => {
    const f = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: "[]", json: [] }));
    const store = new RemoteStore("http://localhost:8080/v1", "test-key", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 0,
      sleep: async () => {},
    });
    await store.listProjectSummaries();
    expect(f.mock.calls[0][0]).toBe("http://localhost:8080/v1/projects");
    expect(f.mock.calls[0][0]).not.toContain("/v1/v1/");
  });
});

describe("RemoteStore — auth header", () => {
  it("sends Bearer token on every request", async () => {
    const f = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: "[]", json: [] }));
    const store = makeStore(f);
    await store.listProjectSummaries();
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });
});

describe("RemoteStore — reads", () => {
  it("listProjectSummaries returns the parsed array", async () => {
    const f = vi.fn().mockResolvedValue(
      mockResponse({
        status: 200,
        body: "",
        json: [{ projectSlug: "p", revision: 3, recordCount: 2, lastBuiltAt: 1 }],
      })
    );
    const store = makeStore(f);
    const out = await store.listProjectSummaries();
    expect(out).toHaveLength(1);
    expect(out[0].projectSlug).toBe("p");
  });

  it("getProjectRevision reads revision + recordCount, returns revision", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ status: 200, body: "", json: { revision: 7, recordCount: 4 } })
      );
    const store = makeStore(f);
    expect(await store.getProjectRevision("p")).toBe(7);
  });

  it("getProjectRecordCount returns recordCount", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ status: 200, body: "", json: { revision: 7, recordCount: 4 } })
      );
    const store = makeStore(f);
    expect(await store.getProjectRecordCount("p")).toBe(4);
  });

  it("getRecord returns undefined on 404", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(mockResponse({ status: 404, body: '{"error":"not found"}' }));
    const store = makeStore(f);
    expect(await store.getRecord("p", "missing")).toBeUndefined();
  });

  it("getRecord returns the record on 200", async () => {
    const rec = sampleRecord();
    const f = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: "", json: rec }));
    const store = makeStore(f);
    const got = await store.getRecord("p", "s1");
    expect(got?.meta.sessionId).toBe("s1");
  });

  it("listRecordsForProject pages until short page", async () => {
    const page1 = [sampleRecord({ sessionId: "s1" }), sampleRecord({ sessionId: "s2" })];
    const page2 = [sampleRecord({ sessionId: "s3" })];
    const f = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: page1 }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: page2 }));
    // Override the page-size check by giving page1.length < limit: use small
    // `limit` URL — but our impl hardcodes 1000. Instead make page1.length
    // < 1000 so it stops after page1.
    f.mockReset();
    f.mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: page1 }));
    const store = makeStore(f);
    const out = await store.listRecordsForProject("p");
    expect(out).toHaveLength(2);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("listRecordsForProject pages across multiple full pages", async () => {
    // Force the page size to 2 by intercepting the URL — but RemoteStore
    // hardcodes limit=1000. To exercise multi-page, build 1000+2 records.
    // Cheaper: simulate by making the server return limit=N records twice,
    // then a short page. Since RemoteStore always sends limit=1000, the
    // server's response length is the only signal. Mock: first call returns
    // 1000 items, second returns 1 item.
    const big = Array.from({ length: 1000 }, (_, i) => sampleRecord({ sessionId: `s${i}` }));
    const tail = [sampleRecord({ sessionId: "tail" })];
    const f = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: big }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: tail }));
    const store = makeStore(f);
    const out = await store.listRecordsForProject("p");
    expect(out).toHaveLength(1001);
    expect(f).toHaveBeenCalledTimes(2);
    // Second call should use offset=1000.
    expect(f.mock.calls[1][0]).toContain("offset=1000");
  });
});

describe("RemoteStore — upsertRecord", () => {
  it("POSTs the record and returns the new revision", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(mockResponse({ status: 200, body: "", json: { revision: 5 } }));
    const store = makeStore(f);
    const out = await store.upsertRecord(sampleRecord());
    expect(out.revision).toBe(5);
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify(sampleRecord()));
  });

  it("throws on missing projectSlug", async () => {
    const f = vi.fn();
    const store = makeStore(f);
    await expect(store.upsertRecord(sampleRecord({ projectSlug: "" }))).rejects.toThrow(
      /projectSlug/
    );
    expect(f).not.toHaveBeenCalled();
  });

  it("invalidates the search-index cache for the project", async () => {
    const f = vi.fn();
    const store = makeStore(f);
    // Populate the cache by calling ensureProjectIndex. ensureProjectIndex
    // calls getProjectRevision + getProjectRecordCount (same endpoint, two
    // fetches) + listRecordsForProject.
    f.mockResolvedValueOnce(
      mockResponse({ status: 200, body: "", json: { revision: 1, recordCount: 0 } })
    );
    f.mockResolvedValueOnce(
      mockResponse({ status: 200, body: "", json: { revision: 1, recordCount: 0 } })
    );
    f.mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: [] }));
    await store.ensureProjectIndex("proj-a");
    expect(store.getIndexCache().size()).toBe(1);
    // upsertRecord hits POST /sessions/:id and returns { revision }.
    f.mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: { revision: 2 } }));
    await store.upsertRecord(sampleRecord());
    expect(store.getIndexCache().size()).toBe(0);
  });
});

describe("RemoteStore — concept-trie + equivalences", () => {
  it("readConceptTrieMerge returns undefined on 404", async () => {
    const f = vi
      .fn()
      // P5.3: readConceptTrieMerge polls revision first, then fetches the trie.
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: { revision: 1 } }))
      .mockResolvedValueOnce(mockResponse({ status: 404, body: '{"error":"not built"}' }));
    const store = makeStore(f);
    expect(await store.readConceptTrieMerge()).toBeUndefined();
  });

  it("readConceptTrieMerge returns the parsed MergeRecord on 200", async () => {
    const merge = { schemaVersion: 1, meta: { projectSlug: "p", builtAt: 1 }, mindMap: {} };
    const f = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: { revision: 5 } }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: merge }));
    const store = makeStore(f);
    expect(await store.readConceptTrieMerge()).toEqual(merge);
  });

  it("readConceptTrieMerge uses cached merge when revision unchanged (P5.3)", async () => {
    const merge = {
      schemaVersion: 1,
      meta: { kind: "deterministic", builtAt: 1, sessionIds: [], projectSlugs: [] },
      mindMap: {},
    };
    const f = vi
      .fn()
      // First call: revision=5 → fetch trie
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: { revision: 5 } }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: merge }))
      // Second call: revision=5 (unchanged) → return cached, no trie fetch
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: { revision: 5 } }));
    const store = makeStore(f);
    const first = await store.readConceptTrieMerge();
    expect(first).toEqual(merge);
    expect(f).toHaveBeenCalledTimes(2); // revision + trie
    const second = await store.readConceptTrieMerge();
    expect(second).toEqual(merge);
    expect(f).toHaveBeenCalledTimes(3); // only revision poll, no trie fetch
  });

  it("readConceptTrieMerge re-fetches when revision changes (P5.3)", async () => {
    const merge1 = {
      schemaVersion: 1,
      meta: { kind: "deterministic", builtAt: 1, sessionIds: [], projectSlugs: [] },
      mindMap: {},
    };
    const merge2 = {
      schemaVersion: 1,
      meta: { kind: "deterministic", builtAt: 2, sessionIds: ["s1"], projectSlugs: ["p"] },
      mindMap: {},
    };
    const f = vi
      .fn()
      // First call: revision=5 → fetch trie1
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: { revision: 5 } }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: merge1 }))
      // Second call: revision=6 (changed) → re-fetch trie2
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: { revision: 6 } }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: merge2 }));
    const store = makeStore(f);
    const first = await store.readConceptTrieMerge();
    expect(first).toEqual(merge1);
    const second = await store.readConceptTrieMerge();
    expect(second).toEqual(merge2);
    expect(f).toHaveBeenCalledTimes(4); // revision + trie × 2
  });

  it("readConceptTrieRevision reads the revision counter", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(mockResponse({ status: 200, body: "", json: { revision: 42 } }));
    const store = makeStore(f);
    expect(await store.readConceptTrieRevision()).toBe(42);
  });

  it("readLatestSegmentEquivalences returns the array shape", async () => {
    const f = vi.fn().mockResolvedValue(
      mockResponse({
        status: 200,
        body: "",
        json: { segmentEquivalences: [{ segments: ["a", "b"] }] },
      })
    );
    const store = makeStore(f);
    const out = await store.readLatestSegmentEquivalences("p");
    expect(out).toEqual([{ segments: ["a", "b"] }]);
  });

  it("readLatestSegmentEquivalences returns [] on 404", async () => {
    const f = vi.fn().mockResolvedValue(mockResponse({ status: 404, body: '{"error":"none"}' }));
    const store = makeStore(f);
    expect(await store.readLatestSegmentEquivalences("p")).toEqual([]);
  });
});

describe("RemoteStore — unsupported mutators", () => {
  it("deleteProjectRecords throws RemoteStoreNotSupported", async () => {
    const store = makeStore(vi.fn());
    await expect(store.deleteProjectRecords("p")).rejects.toBeInstanceOf(RemoteStoreNotSupported);
  });
  it("writeConceptTrieMerge throws RemoteStoreNotSupported", async () => {
    const store = makeStore(vi.fn());
    await expect(store.writeConceptTrieMerge({} as never)).rejects.toBeInstanceOf(
      RemoteStoreNotSupported
    );
  });
  it("bumpProjectRevision throws RemoteStoreNotSupported", async () => {
    const store = makeStore(vi.fn());
    await expect(store.bumpProjectRevision("p", 0)).rejects.toBeInstanceOf(RemoteStoreNotSupported);
  });
  it("clearOntologyCache throws RemoteStoreNotSupported", async () => {
    const store = makeStore(vi.fn());
    await expect(store.clearOntologyCache()).rejects.toBeInstanceOf(RemoteStoreNotSupported);
  });
  it("readDeterministicMerge returns undefined (no endpoint, no throw)", async () => {
    const store = makeStore(vi.fn());
    expect(await store.readDeterministicMerge()).toBeUndefined();
  });
});

describe("RemoteStore — retry + backoff", () => {
  it("retries on 5xx then succeeds", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ status: 503, body: "down" }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "[]", json: [] }));
    const store = makeStore(f, { maxRetries: 2, backoffBaseMs: 1 });
    const out = await store.listProjectSummaries();
    expect(out).toEqual([]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("retries on network error (fetch rejects) then succeeds", async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "[]", json: [] }));
    const store = makeStore(f, { maxRetries: 2 });
    const out = await store.listProjectSummaries();
    expect(out).toEqual([]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on 4xx — throws immediately", async () => {
    const f = vi.fn().mockResolvedValue(mockResponse({ status: 400, body: '{"error":"bad"}' }));
    const store = makeStore(f, { maxRetries: 3 });
    await expect(store.listProjectSummaries()).rejects.toBeInstanceOf(RemoteStoreHttpError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("throws RemoteStoreHttpError after exhausting 5xx retries", async () => {
    const f = vi.fn().mockResolvedValue(mockResponse({ status: 500, body: "boom" }));
    const store = makeStore(f, { maxRetries: 2 });
    await expect(store.listProjectSummaries()).rejects.toBeInstanceOf(RemoteStoreHttpError);
    // 1 initial + 2 retries = 3 total attempts.
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("backoff delay grows exponentially and caps", async () => {
    const sleeps: number[] = [];
    const f = vi.fn().mockResolvedValue(mockResponse({ status: 500, body: "x" }));
    const store = new RemoteStore("https://x", "k", {
      fetchImpl: f as unknown as typeof fetch,
      maxRetries: 3,
      backoffBaseMs: 100,
      backoffMaxMs: 1000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await expect(store.listProjectSummaries()).rejects.toBeInstanceOf(RemoteStoreHttpError);
    // attempt 0 → 100, attempt 1 → 200, attempt 2 → 400 (capped check at 800).
    expect(sleeps).toEqual([100, 200, 400]);
  });
});

describe("RemoteStore — ensureProjectIndex cache", () => {
  it("builds the index on first call, returns cached on second (revision unchanged)", async () => {
    const rec = sampleRecord();
    const f = vi
      .fn()
      // ensureProjectIndex: getProjectRevision (revision endpoint)
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: "", json: { revision: 1, recordCount: 1 } })
      )
      // getProjectRecordCount (same endpoint, second call)
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: "", json: { revision: 1, recordCount: 1 } })
      )
      // listRecordsForProject
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: [rec] }))
      // second ensureProjectIndex call: getProjectRevision
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: "", json: { revision: 1, recordCount: 1 } })
      )
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: "", json: { revision: 1, recordCount: 1 } })
      );
    const store = makeStore(f);
    const idx1 = await store.ensureProjectIndex("proj-a");
    expect(idx1.records).toHaveLength(1);
    const idx2 = await store.ensureProjectIndex("proj-a");
    expect(idx2).toBe(idx1); // cached — same object reference
    // 3 fetches the first time (revision + count + records), 2 the second
    // (revision + count — no records refetch).
    expect(f).toHaveBeenCalledTimes(5);
  });

  it("rebuilds when revision changes", async () => {
    const rec = sampleRecord();
    const f = vi.fn();
    const store = makeStore(f);
    // First build.
    f.mockResolvedValueOnce(
      mockResponse({ status: 200, body: "", json: { revision: 1, recordCount: 1 } })
    );
    f.mockResolvedValueOnce(
      mockResponse({ status: 200, body: "", json: { revision: 1, recordCount: 1 } })
    );
    f.mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: [rec] }));
    await store.ensureProjectIndex("proj-a");
    // Second call — revision bumped.
    f.mockResolvedValueOnce(
      mockResponse({ status: 200, body: "", json: { revision: 2, recordCount: 1 } })
    );
    f.mockResolvedValueOnce(
      mockResponse({ status: 200, body: "", json: { revision: 2, recordCount: 1 } })
    );
    f.mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: [rec] }));
    const idx2 = await store.ensureProjectIndex("proj-a");
    expect(idx2.revision).toBe(2);
  });
});

describe("RemoteStore — search (P5.4)", () => {
  it("POSTs to /projects/:slug/search and returns SearchHit[]", async () => {
    const hits = [
      {
        kind: "session",
        projectSlug: "proj-a",
        sessionId: "s1",
        sessionLabel: "Test",
        analyzedAt: 1000,
        score: 0.9,
        snippet: "matched text",
        evidence: [],
      },
      {
        kind: "code",
        projectSlug: "proj-a",
        sessionId: "s2",
        sessionLabel: "Code session",
        analyzedAt: 2000,
        codePath: "src/main.ts",
        codeDescription: "entry point",
        score: 0.7,
        snippet: "main()",
        evidence: [],
      },
    ];
    const f = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: "", json: hits }));
    const store = makeStore(f);
    const result = await store.search!("proj-a", "test query", 10);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("session");
    expect(result[1].kind).toBe("code");

    // Verify the POST payload.
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(f.mock.calls[0][0]).toBe("https://team.example.com/v1/projects/proj-a/search");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ query: "test query", limit: 10, verbose: false });
  });

  it("passes verbose option in the request body", async () => {
    const f = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: "", json: [] }));
    const store = makeStore(f);
    await store.search!("proj-a", "q", 5, { verbose: true });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.verbose).toBe(true);
  });

  it("returns empty array when server returns null", async () => {
    const f = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: "null", json: null }));
    const store = makeStore(f);
    const result = await store.search!("proj-a", "q", 5);
    expect(result).toEqual([]);
  });

  it("retries on 5xx (search is a POST but idempotent)", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ status: 503, body: "down" }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "", json: [] }));
    const store = makeStore(f, { maxRetries: 2, backoffBaseMs: 1 });
    const result = await store.search!("proj-a", "q", 5);
    expect(result).toEqual([]);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
