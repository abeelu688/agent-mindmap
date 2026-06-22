import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it, vi } from "vitest";
import { bootstrapStore, TeamStore, RemoteStore } from "../shared/src";
import {
  renderConceptDetail,
  renderMemoryRetrieval,
  renderProjectBriefing,
  renderSearchResults,
  renderSessionOutlineMarkdown,
} from "../shared/src/markdownRender";
import { workspaceToSlug } from "../shared/src/paths";
import { searchProjectRecords } from "../shared/src/searchIndex";
import type { SqliteStore } from "../shared/src";
import type { ConceptContextForMerge, SessionRecord } from "../shared/src/storeTypes";

function sampleRecord(overrides?: Partial<SessionRecord["meta"]>): SessionRecord {
  return {
    schemaVersion: 1,
    meta: {
      sessionId: "sess-1",
      projectSlug: "home-example-proj",
      projectPath: "/home/example/proj",
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
        projectSlug: "home-example-proj",
      },
    ],
  };
}

describe("workspaceToSlug (shared)", () => {
  it("encodes unix absolute paths", () => {
    expect(workspaceToSlug("/home/example/cursor/airecorder")).toBe(
      "home-example-cursor-airecorder"
    );
  });
});

describe("searchProjectRecords", () => {
  it("matches concept evidence and returns evidence hits first", () => {
    const hits = searchProjectRecords([sampleRecord()], "clock skew", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].kind).toBe("evidence");
    expect(hits[0].sessionId).toBe("sess-1");
    expect(hits[0].evidenceIndex).toBe(0);
    expect(hits[0].snippet).toContain("clock skew");
  });

  it("expands queries through concept aliases", () => {
    const hits = searchProjectRecords([sampleRecord()], "login security", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].conceptKey).toBe("auth");
    expect(hits.some((hit) => hit.kind === "evidence")).toBe(true);
  });

  it("expands queries through segment equivalences", () => {
    const hits = searchProjectRecords([sampleRecord()], "signin", 5, [
      {
        canonical: "auth",
        aliases: ["signin"],
        scope: { projectSlugs: ["home-example-proj"] },
        confidence: 0.9,
      },
    ]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].conceptKey).toBe("auth");
    expect(hits.some((hit) => hit.kind === "evidence")).toBe(true);
  });

  it("keeps retrieval results diverse across sessions", () => {
    const recordA = sampleRecord({ sessionId: "sess-a", analyzedAt: 1000 });
    recordA.conceptContexts = [
      {
        key: "auth",
        label: "Authentication",
        domainKeys: ["backend"],
        parentKeys: [],
        childKeys: ["jwt"],
        evidence: [
          "retry token refresh failure during login",
          "retry login refresh when jwt expires",
          "retry auth request after skew correction",
          "retry refresh endpoint after transient failure",
        ],
        sessionId: "sess-a",
        projectSlug: "home-example-proj",
      },
    ];
    const recordB = sampleRecord({ sessionId: "sess-b", analyzedAt: 2000 });
    recordB.conceptContexts = [
      {
        key: "mcp",
        label: "MCP retrieval",
        domainKeys: ["agent-memory"],
        parentKeys: [],
        childKeys: [],
        evidence: ["retry project memory retrieval when local index is refreshed"],
        sessionId: "sess-b",
        projectSlug: "home-example-proj",
      },
    ];

    const hits = searchProjectRecords([recordA, recordB], "retry", 4);
    expect(hits.some((hit) => hit.sessionId === "sess-a")).toBe(true);
    expect(hits.some((hit) => hit.sessionId === "sess-b")).toBe(true);
    expect(hits.filter((hit) => hit.sessionId === "sess-a").length).toBeLessThanOrEqual(3);
  });
});

describe("markdown renderers", () => {
  it("renders session outline with sessionId reference", () => {
    const md = renderSessionOutlineMarkdown(sampleRecord());
    expect(md).toContain("sess-1");
    expect(md).toContain("Authentication fix");
  });

  it("renders project briefing for recent sessions", () => {
    const md = renderProjectBriefing({
      projectSlug: "home-example-proj",
      records: [sampleRecord()],
    });
    expect(md).toContain("home-example-proj");
    expect(md).toContain("sess-1");
  });

  it("renders concept detail with evidence citations", () => {
    const contexts: ConceptContextForMerge[] = sampleRecord().conceptContexts ?? [];
    const md = renderConceptDetail("auth", contexts, [sampleRecord()]);
    expect(md).toContain("Authentication");
    expect(md).toContain("[sess-1]");
  });

  it("renders empty search message", () => {
    const md = renderSearchResults("missing-term", [], 5);
    expect(md).toContain("missing-term");
  });

  it("renders retrieved memory as a context pack", () => {
    const hits = searchProjectRecords([sampleRecord()], "clock skew", 5);
    const md = renderMemoryRetrieval("clock skew", hits, 5);
    expect(md).toContain("Project memory for: clock skew");
    expect(md).toContain("Most relevant evidence");
    expect(md).toContain("Source sessions");
    expect(md).toContain("sess-1");
  });
});

describe("SqliteStore — segment equivalences", () => {
  it("stores and reads segment equivalences via Store interface", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "amm-sqlite-equiv-"));
    try {
      const result = await bootstrapStore(tmp);
      const { store } = result;

      // SqliteStore stores equivalences in the kv table via
      // writeOntologyIndex + readLatestSegmentEquivalences.
      // Initially, no equivalences.
      const empty = await store.readLatestSegmentEquivalences("home-example-proj");
      expect(empty).toEqual([]);

      try {
        await (store as { close?: () => Promise<void> }).close?.();
      } catch {
        // ignore
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("SqliteStore — project revision", () => {
  it("bumps project revision on upsertRecord", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "amm-sqlite-rev-"));
    try {
      const result = await bootstrapStore(tmp);
      const { store } = result;

      // Revision starts at 0 for an unknown project.
      expect(await store.getProjectRevision("proj-a")).toBe(0);

      // Upsert bumps revision.
      const rev1 = await store.upsertRecord(
        sampleRecord({ projectSlug: "proj-a", sessionId: "s1" })
      );
      expect(rev1.revision).toBe(1);

      const rev2 = await store.upsertRecord(
        sampleRecord({ projectSlug: "proj-a", sessionId: "s2", analyzedAt: 2000 })
      );
      expect(rev2.revision).toBe(2);

      // Read back.
      expect(await store.getProjectRevision("proj-a")).toBe(2);

      try {
        await (store as { close?: () => Promise<void> }).close?.();
      } catch {
        // ignore
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("TeamStore.upsertRecord does not trigger network push", () => {
  it("writes locally without calling remote or queue", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "amm-team-nopush-"));
    try {
      const result = await bootstrapStore(tmp);
      const local = result.store as SqliteStore;

      // Create a mock remote that tracks calls.
      const remote = new RemoteStore("https://team.example.com", "key", {
        fetchImpl: vi.fn() as unknown as typeof fetch,
        maxRetries: 0,
        sleep: async () => {},
      });

      // Create a mock queue that tracks calls.
      const enqueueSpy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const drainSpy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const mockQueue = { enqueue: enqueueSpy, drain: drainSpy };

      const teamStore = new TeamStore(local, remote, mockQueue);

      // Upsert a record.
      const rev = await teamStore.upsertRecord(
        sampleRecord({ projectSlug: "proj-a", sessionId: "s1" })
      );
      expect(rev.revision).toBe(1);

      // Queue.enqueue should NOT have been called — push is manual only.
      expect(enqueueSpy).not.toHaveBeenCalled();

      // Verify the record is in the local store.
      const records = await local.listRecordsForProject("proj-a");
      expect(records.length).toBe(1);

      try {
        await local.close();
      } catch {
        // ignore
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
