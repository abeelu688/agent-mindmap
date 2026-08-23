import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { bootstrapStore, STORE_LAYOUT, type SessionRecord } from "../shared/src";
import {
  backFillStaleness,
  createMcpHandlerContext,
  ensureProjectIndex,
  readSessionRecord,
  resolveSlug,
  runProjectSearch,
} from "../mcp-server/src/handlers";
import { createPathsResolver } from "../mcp-server/src/pathsMap";

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

async function setupTempStore(): Promise<{
  tmp: string;
  cleanup: () => Promise<void>;
}> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-handlers-"));
  const result = await bootstrapStore(tmp);
  await result.store.upsertRecord(sampleRecord());
  return {
    tmp,
    cleanup: async () => {
      try {
        await (result.store as { close?: () => Promise<void> }).close?.();
      } catch {
        // ignore
      }
      await fs.rm(tmp, { recursive: true, force: true });
    },
  };
}

describe("resolveSlug", () => {
  it("returns direct slug when projectSlug provided", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp);
      const slug = await resolveSlug(ctx, { projectSlug: "home-test-proj" });
      expect(slug).toBe("home-test-proj");
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });

  it("resolves via projectPath when direct slug not provided", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp);
      const slug = await resolveSlug(ctx, { projectPath: "/home/test/proj" });
      expect(slug).toBe("home-test-proj");
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });

  it("returns undefined when neither option matches", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp);
      const slug = await resolveSlug(ctx, {});
      expect(slug).toBeUndefined();
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });

  it("resolves repo slug from repo-paths.json in repo mode (not workspace slug)", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      await fs.writeFile(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "repo" }));
      await fs.writeFile(
        path.join(tmp, "repo-paths.json"),
        JSON.stringify({ "org/repo.git": "/home/test/proj" })
      );
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp, createPathsResolver(tmp));
      const slug = await resolveSlug(ctx, { projectPath: "/home/test/proj" });
      expect(slug).toBe("org/repo.git");
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });

  it("does not fall back to workspace slug in repo mode when path is unknown", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      await fs.writeFile(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "repo" }));
      await fs.writeFile(path.join(tmp, "repo-paths.json"), JSON.stringify({}));
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(
        result.store,
        tmp,
        createPathsResolver(tmp),
        async () => undefined
      );
      const slug = await resolveSlug(ctx, { projectPath: "/unknown/path" });
      expect(slug).toBeUndefined();
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });
});

describe("ensureProjectIndex", () => {
  it("loads records from the store and builds concept/token indexes", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp);
      const index = await ensureProjectIndex(ctx, "home-test-proj");
      expect(index.records).toHaveLength(1);
      expect(index.records[0].meta.sessionId).toBe("sess-1");
      expect(index.conceptTerms.length).toBe(1);
      expect(index.conceptTerms[0].ctx.key).toBe("auth");
      expect(index.recordTokens).toHaveLength(1);
      expect(index.recordTokens[0].size).toBeGreaterThan(0);
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });

  it("caches index across calls when revision and mtime are stable", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp);
      const first = await ensureProjectIndex(ctx, "home-test-proj");
      const second = await ensureProjectIndex(ctx, "home-test-proj");
      expect(second).toBe(first);
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });
});

describe("runProjectSearch", () => {
  it("returns error when slug cannot be resolved", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp);
      const searchResult = await runProjectSearch(ctx, {
        query: "auth",
        limit: 5,
      });
      expect(searchResult.kind).toBe("error");
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });

  it("returns hits when query matches concept evidence", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp);
      const searchResult = await runProjectSearch(ctx, {
        query: "clock skew",
        projectSlug: "home-test-proj",
        limit: 5,
      });
      expect(searchResult.kind).toBe("ok");
      if (searchResult.kind === "ok") {
        expect(searchResult.hits.length).toBeGreaterThan(0);
        expect(searchResult.hits[0].sessionId).toBe("sess-1");
      }
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });

  it("attaches score breakdown when verbose", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp);
      const searchResult = await runProjectSearch(ctx, {
        query: "clock skew",
        projectSlug: "home-test-proj",
        limit: 5,
        verbose: true,
      });
      expect(searchResult.kind).toBe("ok");
      if (searchResult.kind === "ok") {
        expect(searchResult.hits.length).toBeGreaterThan(0);
        expect(searchResult.hits[0].scoreBreakdown).toBeDefined();
      }
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });

  it("returns error for project with no analyzed sessions", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-empty-"));
    try {
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp);
      const searchResult = await runProjectSearch(ctx, {
        query: "anything",
        projectSlug: "empty-proj",
        limit: 5,
      });
      expect(searchResult.kind).toBe("error");
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("readSessionRecord", () => {
  it("returns the record when sessionId exists in the project", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp);
      const record = await readSessionRecord(ctx, "home-test-proj", "sess-1");
      expect(record).toBeDefined();
      expect(record?.meta.sessionId).toBe("sess-1");
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });

  it("returns undefined when sessionId does not exist", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp);
      const record = await readSessionRecord(ctx, "home-test-proj", "nonexistent");
      expect(record).toBeUndefined();
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });

  it("returns undefined when project slug does not exist", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp);
      const record = await readSessionRecord(ctx, "nonexistent-proj", "sess-1");
      expect(record).toBeUndefined();
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });
});

describe("backFillStaleness", () => {
  it("is a no-op when ctx has no pathsResolver", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp);
      const hits = [
        {
          kind: "code",
          projectSlug: "home-test-proj",
          codePath: "src/auth.ts",
          codeMarkCode: ["line1"],
          staleness: undefined,
        },
      ];
      await backFillStaleness(ctx, hits);
      expect(hits[0].staleness).toBeUndefined();
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });

  it("marks staleness as stale when the resolved file is missing", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-ws-"));
      await fs.writeFile(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "workspace" }));
      await fs.writeFile(
        path.join(tmp, "workspace-paths.json"),
        JSON.stringify({ "home-test-proj": workspaceDir })
      );
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp, createPathsResolver(tmp));
      const hits = [
        {
          kind: "code",
          projectSlug: "home-test-proj",
          codePath: "src/missing.ts",
          codeMarkCode: ["line1"],
          staleness: undefined,
        },
      ];
      await backFillStaleness(ctx, hits);
      expect(hits[0].staleness).toBe("stale");
      await (result.store as { close?: () => Promise<void> }).close?.();
      await fs.rm(workspaceDir, { recursive: true, force: true });
    } finally {
      await cleanup();
    }
  });

  it("marks staleness as unknown when the slug is not in the paths map", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      await fs.writeFile(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "workspace" }));
      await fs.writeFile(path.join(tmp, "workspace-paths.json"), JSON.stringify({}));
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp, createPathsResolver(tmp));
      const hits = [
        {
          kind: "code",
          projectSlug: "home-test-proj",
          codePath: "src/auth.ts",
          codeMarkCode: ["line1"],
          staleness: undefined,
        },
      ];
      await backFillStaleness(ctx, hits);
      expect(hits[0].staleness).toBe("unknown");
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });

  it("skips non-code hits", async () => {
    const { tmp, cleanup } = await setupTempStore();
    try {
      const result = await bootstrapStore(tmp);
      const ctx = createMcpHandlerContext(result.store, tmp);
      const hits = [
        {
          kind: "concept",
          projectSlug: "home-test-proj",
          staleness: undefined,
        },
        {
          kind: "topic",
          projectSlug: "home-test-proj",
          staleness: undefined,
        },
      ];
      await backFillStaleness(ctx, hits);
      expect(hits[0].staleness).toBeUndefined();
      expect(hits[1].staleness).toBeUndefined();
      await (result.store as { close?: () => Promise<void> }).close?.();
    } finally {
      await cleanup();
    }
  });
});
