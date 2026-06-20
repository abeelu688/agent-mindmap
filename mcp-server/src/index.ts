#!/usr/bin/env node
import {
  buildConceptTermIndex,
  buildRecordTokenSets,
  collectConceptContexts,
  findProjectSlugByPath,
  listProjectSummaries,
  listRecordsForProject,
  McpSearchIndexCache,
  projectRecordCount,
  projectRevision,
  projectSessionsLatestMtimeMs,
  readConceptTrieMerge,
  readLatestProjectSegmentEquivalences,
  readMcpIndex,
  readRecord,
  renderConceptDetail,
  renderMemoryRetrieval,
  renderProjectBriefing,
  renderProjectList,
  renderProjectSessionsList,
  renderSearchResults,
  renderSessionOutlineMarkdown,
  resolveProjectSlug,
  resolveStoreDir,
  searchProjectRecords,
  type ProjectSearchIndex,
} from "@agent-mindmap/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

declare const __MCP_SERVER_VERSION__: string;
const SERVER_VERSION =
  typeof __MCP_SERVER_VERSION__ !== "undefined" ? __MCP_SERVER_VERSION__ : "0.0.0-dev";

const storeDir = resolveStoreDir();
const indexCache = new McpSearchIndexCache();

async function ensureProjectIndex(projectSlug: string): Promise<ProjectSearchIndex> {
  const cached = indexCache.get(projectSlug);
  const mcpIndex = await readMcpIndex(storeDir);
  const revision = projectRevision(mcpIndex, projectSlug);
  const expectedRecordCount = projectRecordCount(mcpIndex, projectSlug);
  const latestMtime = await projectSessionsLatestMtimeMs(storeDir, projectSlug);
  if (
    cached &&
    cached.revision === revision &&
    cached.sourceMtimeMs >= latestMtime &&
    (expectedRecordCount === undefined || cached.records.length === expectedRecordCount)
  ) {
    return cached;
  }
  return indexCache.build(projectSlug, async () => {
    const records = await listRecordsForProject(storeDir, projectSlug);
    const built: ProjectSearchIndex = {
      projectSlug,
      revision,
      sourceMtimeMs: latestMtime,
      records,
      conceptTerms: buildConceptTermIndex(records),
      recordTokens: buildRecordTokenSets(records),
      builtAt: Date.now(),
    };
    return built;
  });
}

async function resolveSlug(opts: {
  projectPath?: string;
  projectSlug?: string;
}): Promise<string | undefined> {
  const direct = resolveProjectSlug(opts);
  if (direct) {
    return direct;
  }
  if (opts.projectPath) {
    const summaries = await listProjectSummaries(storeDir);
    return findProjectSlugByPath(summaries, opts.projectPath);
  }
  return undefined;
}

async function runProjectSearch(opts: {
  query: string;
  projectPath?: string;
  projectSlug?: string;
  limit: number;
  verbose?: boolean;
}): Promise<
  { kind: "ok"; hits: ReturnType<typeof searchProjectRecords> } | { kind: "error"; message: string }
> {
  const slug = await resolveSlug({ projectPath: opts.projectPath, projectSlug: opts.projectSlug });
  if (!slug) {
    return { kind: "error", message: "provide projectPath or projectSlug." };
  }
  const index = await ensureProjectIndex(slug);
  if (!index.records.length) {
    return {
      kind: "error",
      message: `no analyzed sessions for project \`${slug}\`. Run **Analyze All Sessions (Current Project)** first.`,
    };
  }
  const equivalences = await readLatestProjectSegmentEquivalences(storeDir, slug);
  const hits = searchProjectRecords(
    index.records,
    opts.query,
    opts.limit,
    equivalences,
    index.conceptTerms,
    index.recordTokens,
    opts.verbose ?? false
  );
  return { kind: "ok", hits };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function withErrorHandler<TArgs extends Record<string, unknown>>(
  fn: (args: TArgs) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>
): (args: TArgs) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return errorResult(`internal error: ${detail}`);
    }
  };
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "agent-mindmap",
    version: SERVER_VERSION,
  });

  server.tool("list_projects", {}, async () => {
    try {
      const projects = await listProjectSummaries(storeDir);
      return textResult(renderProjectList(projects));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return errorResult(`internal error: ${detail}`);
    }
  });

  server.tool("server_info", {}, async () => {
    const lines = [
      "# agent-mindmap MCP server",
      "",
      `- **name**: \`agent-mindmap\``,
      `- **version**: \`${SERVER_VERSION}\``,
      `- **storeDir**: \`${storeDir}\``,
      `- **cached projects**: ${indexCache.size()}`,
    ];
    return textResult(lines.join("\n"));
  });

  server.tool(
    "get_project_briefing",
    {
      projectPath: z.string().optional().describe("Workspace filesystem path"),
      projectSlug: z.string().optional().describe("Cursor project slug"),
      recentLimit: z.number().int().min(1).max(20).optional(),
      conceptLimit: z.number().int().min(1).max(30).optional(),
    },
    withErrorHandler(async ({ projectPath, projectSlug, recentLimit, conceptLimit }) => {
      const slug = await resolveSlug({ projectPath, projectSlug });
      if (!slug) {
        return errorResult(
          "provide projectPath or projectSlug, and ensure the project has been analyzed in Agent Mind Map."
        );
      }
      const index = await ensureProjectIndex(slug);
      if (!index.records.length) {
        return errorResult(
          `no analyzed sessions for project \`${slug}\`. Run **Analyze All Sessions (Current Project)** first.`
        );
      }
      const conceptTrie = await readConceptTrieMerge(storeDir);
      const projectPathDisplay =
        projectPath ?? index.records.find((r) => r.meta.projectPath)?.meta.projectPath;
      return textResult(
        renderProjectBriefing({
          projectSlug: slug,
          projectPath: projectPathDisplay,
          records: index.records,
          conceptTrie,
          recentLimit,
          conceptLimit,
        })
      );
    })
  );

  server.tool(
    "list_project_sessions",
    {
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    },
    withErrorHandler(async ({ projectPath, projectSlug, limit = 20, offset = 0 }) => {
      const slug = await resolveSlug({ projectPath, projectSlug });
      if (!slug) {
        return errorResult("provide projectPath or projectSlug.");
      }
      const index = await ensureProjectIndex(slug);
      const sorted = [...index.records].sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
      const page = sorted.slice(offset, offset + limit);
      return textResult(
        renderProjectSessionsList(slug, page, {
          limit,
          offset,
          total: sorted.length,
        })
      );
    })
  );

  server.tool(
    "search_project_history",
    {
      query: z.string().min(1),
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
      limit: z.number().int().min(1).max(30).optional(),
      verbose: z.boolean().optional(),
    },
    withErrorHandler(async ({ query, projectPath, projectSlug, limit = 10, verbose = false }) => {
      const result = await runProjectSearch({ query, projectPath, projectSlug, limit, verbose });
      if (result.kind === "error") {
        return errorResult(result.message);
      }
      return textResult(renderSearchResults(query, result.hits, limit, verbose));
    })
  );

  server.tool(
    "retrieve_project_memory",
    {
      query: z.string().min(1),
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
      limit: z.number().int().min(1).max(20).optional(),
    },
    withErrorHandler(async ({ query, projectPath, projectSlug, limit = 8 }) => {
      const result = await runProjectSearch({ query, projectPath, projectSlug, limit });
      if (result.kind === "error") {
        return errorResult(result.message);
      }
      return textResult(renderMemoryRetrieval(query, result.hits, limit));
    })
  );

  server.tool(
    "get_concept_detail",
    {
      conceptKey: z.string().min(1),
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
    },
    withErrorHandler(async ({ conceptKey, projectPath, projectSlug }) => {
      const slug = await resolveSlug({ projectPath, projectSlug });
      if (!slug) {
        return errorResult("provide projectPath or projectSlug.");
      }
      const index = await ensureProjectIndex(slug);
      const contexts = collectConceptContexts(index.records);
      return textResult(renderConceptDetail(conceptKey, contexts, index.records));
    })
  );

  server.tool(
    "get_session_outline",
    {
      sessionId: z.string().min(1),
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
    },
    withErrorHandler(async ({ sessionId, projectPath, projectSlug }) => {
      const slug = await resolveSlug({ projectPath, projectSlug });
      if (!slug) {
        return errorResult("provide projectPath or projectSlug.");
      }
      const record = await readRecord(storeDir, slug, sessionId);
      if (!record) {
        return errorResult(`session \`${sessionId}\` not found for project \`${slug}\`.`);
      }
      return textResult(renderSessionOutlineMarkdown(record));
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("agent-mindmap-mcp failed:", err);
  process.exit(1);
});
