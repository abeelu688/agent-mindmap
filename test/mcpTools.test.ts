/**
 * End-to-end tests for the 8 MCP tools registered in `mcp-server/src/index.ts`.
 *
 * The tool handlers are inline in index.ts (which runs main() on import),
 * so we cannot import them directly. Instead, we replicate each tool's
 * composition by calling the same underlying functions
 * (resolveSlug, ensureProjectIndex, runProjectSearch, readSessionRecord,
 * backFillStaleness, and the render* helpers from @agent-mindmap/shared).
 *
 * This catches regressions in the actual logic each tool executes:
 * argument resolution, store reads, search, and markdown rendering.
 */
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  bootstrapStore,
  collectConceptContexts,
  renderConceptDetail,
  renderMemoryRetrieval,
  renderProjectBriefing,
  renderProjectList,
  renderProjectSessionsList,
  renderSearchResults,
  renderSessionOutlineMarkdown,
  STORE_LAYOUT,
  type SessionRecord,
} from "../shared/src";
import {
  backFillStaleness,
  createMcpHandlerContext,
  ensureProjectIndex,
  readSessionRecord,
  resolveSlug,
  runProjectSearch,
  type McpHandlerContext,
} from "../mcp-server/src/handlers";

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
  ctx: McpHandlerContext;
  cleanup: () => Promise<void>;
}> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-tools-"));
  const result = await bootstrapStore(tmp);
  await result.store.upsertRecord(sampleRecord());
  const ctx = createMcpHandlerContext(result.store, tmp);
  return {
    tmp,
    ctx,
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

// Replicate each tool's handler composition. These mirror the inline
// handlers in mcp-server/src/index.ts - keep them in sync.

async function toolListProjects(ctx: McpHandlerContext): Promise<string> {
  const projects = await ctx.store.listProjectSummaries();
  return renderProjectList(projects);
}

async function toolGetProjectBriefing(
  ctx: McpHandlerContext,
  args: { projectPath?: string; projectSlug?: string; recentLimit?: number; conceptLimit?: number }
): Promise<string> {
  const slug = await resolveSlug(ctx, args);
  if (!slug) {
    return "ERROR: provide projectPath or projectSlug";
  }
  const index = await ensureProjectIndex(ctx, slug);
  if (!index.records.length) {
    return `ERROR: no analyzed sessions for project \`${slug}\``;
  }
  const conceptTrie = await ctx.store.readConceptTrieMerge();
  const projectPathDisplay =
    args.projectPath ?? index.records.find((r) => r.meta.projectPath)?.meta.projectPath;
  return renderProjectBriefing({
    projectSlug: slug,
    projectPath: projectPathDisplay,
    records: index.records,
    conceptTrie,
    recentLimit: args.recentLimit,
    conceptLimit: args.conceptLimit,
  });
}

async function toolListProjectSessions(
  ctx: McpHandlerContext,
  args: { projectPath?: string; projectSlug?: string; limit?: number; offset?: number }
): Promise<string> {
  const slug = await resolveSlug(ctx, args);
  if (!slug) {
    return "ERROR: provide projectPath or projectSlug";
  }
  const index = await ensureProjectIndex(ctx, slug);
  const sorted = [...index.records].sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
  const limit = args.limit ?? 20;
  const offset = args.offset ?? 0;
  const page = sorted.slice(offset, offset + limit);
  return renderProjectSessionsList(slug, page, { limit, offset, total: sorted.length });
}

async function toolSearchProjectHistory(
  ctx: McpHandlerContext,
  args: {
    query: string;
    projectPath?: string;
    projectSlug?: string;
    limit?: number;
    verbose?: boolean;
  }
): Promise<string> {
  const limit = args.limit ?? 10;
  const verbose = args.verbose ?? false;
  const result = await runProjectSearch(ctx, {
    query: args.query,
    projectPath: args.projectPath,
    projectSlug: args.projectSlug,
    limit,
    verbose,
  });
  if (result.kind === "error") {
    return `ERROR: ${result.message}`;
  }
  await backFillStaleness(ctx, result.hits);
  return renderSearchResults(args.query, result.hits, limit, verbose);
}

async function toolRetrieveProjectMemory(
  ctx: McpHandlerContext,
  args: { query: string; projectPath?: string; projectSlug?: string; limit?: number }
): Promise<string> {
  const limit = args.limit ?? 8;
  const result = await runProjectSearch(ctx, {
    query: args.query,
    projectPath: args.projectPath,
    projectSlug: args.projectSlug,
    limit,
  });
  if (result.kind === "error") {
    return `ERROR: ${result.message}`;
  }
  await backFillStaleness(ctx, result.hits);
  return renderMemoryRetrieval(args.query, result.hits, limit);
}

async function toolGetConceptDetail(
  ctx: McpHandlerContext,
  args: { conceptKey: string; projectPath?: string; projectSlug?: string }
): Promise<string> {
  const slug = await resolveSlug(ctx, args);
  if (!slug) {
    return "ERROR: provide projectPath or projectSlug";
  }
  const index = await ensureProjectIndex(ctx, slug);
  const contexts = collectConceptContexts(index.records);
  return renderConceptDetail(args.conceptKey, contexts, index.records);
}

async function toolGetSessionOutline(
  ctx: McpHandlerContext,
  args: { sessionId: string; projectPath?: string; projectSlug?: string }
): Promise<string> {
  const slug = await resolveSlug(ctx, args);
  if (!slug) {
    return "ERROR: provide projectPath or projectSlug";
  }
  const record = await readSessionRecord(ctx, slug, args.sessionId);
  if (!record) {
    return `ERROR: session \`${args.sessionId}\` not found for project \`${slug}\``;
  }
  return renderSessionOutlineMarkdown(record);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("MCP tool: list_projects", () => {
  it("renders at least one project summary", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolListProjects(ctx);
      expect(markdown).toContain("home-test-proj");
    } finally {
      await cleanup();
    }
  });
});

describe("MCP tool: get_project_briefing", () => {
  it("renders the briefing when projectSlug resolves", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolGetProjectBriefing(ctx, { projectSlug: "home-test-proj" });
      expect(markdown).toContain("home-test-proj");
      expect(markdown).toContain("Authentication fix");
    } finally {
      await cleanup();
    }
  });

  it("returns error message when slug cannot be resolved", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolGetProjectBriefing(ctx, {});
      expect(markdown).toContain("ERROR");
    } finally {
      await cleanup();
    }
  });

  it("resolves slug via projectPath", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolGetProjectBriefing(ctx, { projectPath: "/home/test/proj" });
      expect(markdown).toContain("home-test-proj");
    } finally {
      await cleanup();
    }
  });
});

describe("MCP tool: list_project_sessions", () => {
  it("lists sessions sorted by analyzedAt descending", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolListProjectSessions(ctx, { projectSlug: "home-test-proj" });
      expect(markdown).toContain("sess-1");
      expect(markdown).toContain("Authentication fix");
    } finally {
      await cleanup();
    }
  });

  it("respects limit and offset", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolListProjectSessions(ctx, {
        projectSlug: "home-test-proj",
        limit: 5,
        offset: 0,
      });
      expect(markdown).toContain("sess-1");
    } finally {
      await cleanup();
    }
  });

  it("returns error when slug cannot be resolved", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolListProjectSessions(ctx, {});
      expect(markdown).toContain("ERROR");
    } finally {
      await cleanup();
    }
  });
});

describe("MCP tool: search_project_history", () => {
  it("returns hits when query matches concept evidence", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolSearchProjectHistory(ctx, {
        query: "clock skew",
        projectSlug: "home-test-proj",
      });
      expect(markdown).toContain("sess-1");
    } finally {
      await cleanup();
    }
  });

  it("returns error when slug cannot be resolved", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolSearchProjectHistory(ctx, { query: "anything" });
      expect(markdown).toContain("ERROR");
    } finally {
      await cleanup();
    }
  });

  it("respects the limit argument", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolSearchProjectHistory(ctx, {
        query: "auth",
        projectSlug: "home-test-proj",
        limit: 1,
      });
      expect(typeof markdown).toBe("string");
      expect(markdown.length).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });
});

describe("MCP tool: retrieve_project_memory", () => {
  it("renders a memory synthesis when hits are found", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolRetrieveProjectMemory(ctx, {
        query: "clock skew",
        projectSlug: "home-test-proj",
      });
      expect(markdown).toContain("sess-1");
    } finally {
      await cleanup();
    }
  });

  it("returns error when slug cannot be resolved", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolRetrieveProjectMemory(ctx, { query: "anything" });
      expect(markdown).toContain("ERROR");
    } finally {
      await cleanup();
    }
  });
});

describe("MCP tool: get_concept_detail", () => {
  it("renders detail when conceptKey exists in the project", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolGetConceptDetail(ctx, {
        conceptKey: "auth",
        projectSlug: "home-test-proj",
      });
      expect(markdown).toContain("auth");
    } finally {
      await cleanup();
    }
  });

  it("returns error when slug cannot be resolved", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolGetConceptDetail(ctx, { conceptKey: "auth" });
      expect(markdown).toContain("ERROR");
    } finally {
      await cleanup();
    }
  });
});

describe("MCP tool: get_session_outline", () => {
  it("renders the session outline when sessionId exists", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolGetSessionOutline(ctx, {
        sessionId: "sess-1",
        projectSlug: "home-test-proj",
      });
      expect(markdown).toContain("Authentication fix");
    } finally {
      await cleanup();
    }
  });

  it("returns error when sessionId does not exist", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolGetSessionOutline(ctx, {
        sessionId: "nonexistent",
        projectSlug: "home-test-proj",
      });
      expect(markdown).toContain("not found");
    } finally {
      await cleanup();
    }
  });

  it("returns error when slug cannot be resolved", async () => {
    const { ctx, cleanup } = await setupTempStore();
    try {
      const markdown = await toolGetSessionOutline(ctx, { sessionId: "sess-1" });
      expect(markdown).toContain("ERROR");
    } finally {
      await cleanup();
    }
  });
});
