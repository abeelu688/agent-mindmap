import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { bumpMcpProjectRevision, JsonFsStore } from "../shared/src";
import { writeJsonAtomic } from "../shared/src/atomicWrite";
import { STORE_LAYOUT } from "../shared/src/storeLayout";
import {
  createMcpHandlerContext,
  ensureProjectIndex,
  resolveSlug,
  runProjectSearch,
} from "../mcp-server/src/handlers";
import type { SessionRecord } from "../shared/src/storeTypes";

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

async function setupTempStore(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-handlers-"));
  await fs.mkdir(path.join(tmp, STORE_LAYOUT.sessionsDir, "home-test-proj"), {
    recursive: true,
  });
  const record = sampleRecord();
  await writeJsonAtomic(
    path.join(tmp, STORE_LAYOUT.sessionsDir, "home-test-proj", "sess-1.json"),
    record
  );
  await bumpMcpProjectRevision(tmp, "home-test-proj", 1, {
    lastAnalyzedAt: 1000,
    projectPath: "/home/test/proj",
  });
  return tmp;
}

describe("resolveSlug", () => {
  it("returns direct slug when projectSlug provided", async () => {
    const tmp = await setupTempStore();
    const ctx = createMcpHandlerContext(new JsonFsStore(tmp), tmp);
    const slug = await resolveSlug(ctx, { projectSlug: "home-test-proj" });
    expect(slug).toBe("home-test-proj");
  });

  it("resolves via projectPath when direct slug not provided", async () => {
    const tmp = await setupTempStore();
    const ctx = createMcpHandlerContext(new JsonFsStore(tmp), tmp);
    const slug = await resolveSlug(ctx, { projectPath: "/home/test/proj" });
    expect(slug).toBe("home-test-proj");
  });

  it("returns undefined when neither option matches", async () => {
    const tmp = await setupTempStore();
    const ctx = createMcpHandlerContext(new JsonFsStore(tmp), tmp);
    const slug = await resolveSlug(ctx, {});
    expect(slug).toBeUndefined();
  });
});

describe("ensureProjectIndex", () => {
  it("loads records from the store and builds concept/token indexes", async () => {
    const tmp = await setupTempStore();
    const ctx = createMcpHandlerContext(new JsonFsStore(tmp), tmp);
    const index = await ensureProjectIndex(ctx, "home-test-proj");
    expect(index.records).toHaveLength(1);
    expect(index.records[0].meta.sessionId).toBe("sess-1");
    expect(index.conceptTerms.length).toBe(1);
    expect(index.conceptTerms[0].ctx.key).toBe("auth");
    expect(index.recordTokens).toHaveLength(1);
    expect(index.recordTokens[0].size).toBeGreaterThan(0);
  });

  it("caches index across calls when revision and mtime are stable", async () => {
    const tmp = await setupTempStore();
    const ctx = createMcpHandlerContext(new JsonFsStore(tmp), tmp);
    const first = await ensureProjectIndex(ctx, "home-test-proj");
    const second = await ensureProjectIndex(ctx, "home-test-proj");
    expect(second).toBe(first);
  });
});

describe("runProjectSearch", () => {
  it("returns error when slug cannot be resolved", async () => {
    const tmp = await setupTempStore();
    const ctx = createMcpHandlerContext(new JsonFsStore(tmp), tmp);
    const result = await runProjectSearch(ctx, {
      query: "auth",
      limit: 5,
    });
    expect(result.kind).toBe("error");
  });

  it("returns hits when query matches concept evidence", async () => {
    const tmp = await setupTempStore();
    const ctx = createMcpHandlerContext(new JsonFsStore(tmp), tmp);
    const result = await runProjectSearch(ctx, {
      query: "clock skew",
      projectSlug: "home-test-proj",
      limit: 5,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits[0].sessionId).toBe("sess-1");
    }
  });

  it("attaches score breakdown when verbose", async () => {
    const tmp = await setupTempStore();
    const ctx = createMcpHandlerContext(new JsonFsStore(tmp), tmp);
    const result = await runProjectSearch(ctx, {
      query: "clock skew",
      projectSlug: "home-test-proj",
      limit: 5,
      verbose: true,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits[0].scoreBreakdown).toBeDefined();
    }
  });

  it("returns error for project with no analyzed sessions", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-empty-"));
    await fs.mkdir(path.join(tmp, STORE_LAYOUT.sessionsDir, "empty-proj"), {
      recursive: true,
    });
    await bumpMcpProjectRevision(tmp, "empty-proj", 0);
    const ctx = createMcpHandlerContext(new JsonFsStore(tmp), tmp);
    const result = await runProjectSearch(ctx, {
      query: "anything",
      projectSlug: "empty-proj",
      limit: 5,
    });
    expect(result.kind).toBe("error");
  });
});
