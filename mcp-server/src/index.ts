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

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "agent-mindmap",
    version: SERVER_VERSION,
  });

  server.tool("list_projects", {}, async () => {
    const projects = await listProjectSummaries(storeDir);
    return textResult(renderProjectList(projects));
  });

  server.tool(
    "get_project_briefing",
    {
      projectPath: z.string().optional().describe("Workspace filesystem path"),
      projectSlug: z.string().optional().describe("Cursor project slug"),
      recentLimit: z.number().int().min(1).max(20).optional(),
      conceptLimit: z.number().int().min(1).max(30).optional(),
    },
    async ({ projectPath, projectSlug, recentLimit, conceptLimit }) => {
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
    }
  );

  server.tool(
    "list_project_sessions",
    {
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    },
    async ({ projectPath, projectSlug, limit = 20, offset = 0 }) => {
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
    }
  );

  server.tool(
    "search_project_history",
    {
      query: z.string().min(1),
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
      limit: z.number().int().min(1).max(30).optional(),
    },
    async ({ query, projectPath, projectSlug, limit = 10 }) => {
      const slug = await resolveSlug({ projectPath, projectSlug });
      if (!slug) {
        return errorResult("provide projectPath or projectSlug.");
      }
      const index = await ensureProjectIndex(slug);
      const equivalences = await readLatestProjectSegmentEquivalences(storeDir, slug);
      const hits = searchProjectRecords(
        index.records,
        query,
        limit,
        equivalences,
        index.conceptTerms,
        index.recordTokens
      );
      return textResult(renderSearchResults(query, hits, limit));
    }
  );

  server.tool(
    "retrieve_project_memory",
    {
      query: z.string().min(1),
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
      limit: z.number().int().min(1).max(20).optional(),
    },
    async ({ query, projectPath, projectSlug, limit = 8 }) => {
      const slug = await resolveSlug({ projectPath, projectSlug });
      if (!slug) {
        return errorResult("provide projectPath or projectSlug.");
      }
      const index = await ensureProjectIndex(slug);
      const equivalences = await readLatestProjectSegmentEquivalences(storeDir, slug);
      const hits = searchProjectRecords(
        index.records,
        query,
        limit,
        equivalences,
        index.conceptTerms,
        index.recordTokens
      );
      return textResult(renderMemoryRetrieval(query, hits, limit));
    }
  );

  server.tool(
    "get_concept_detail",
    {
      conceptKey: z.string().min(1),
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
    },
    async ({ conceptKey, projectPath, projectSlug }) => {
      const slug = await resolveSlug({ projectPath, projectSlug });
      if (!slug) {
        return errorResult("provide projectPath or projectSlug.");
      }
      const index = await ensureProjectIndex(slug);
      const contexts = collectConceptContexts(index.records);
      return textResult(renderConceptDetail(conceptKey, contexts, index.records));
    }
  );

  server.tool(
    "get_session_outline",
    {
      sessionId: z.string().min(1),
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
    },
    async ({ sessionId, projectPath, projectSlug }) => {
      const slug = await resolveSlug({ projectPath, projectSlug });
      if (!slug) {
        return errorResult("provide projectPath or projectSlug.");
      }
      const record = await readRecord(storeDir, slug, sessionId);
      if (!record) {
        return errorResult(`session \`${sessionId}\` not found for project \`${slug}\`.`);
      }
      return textResult(renderSessionOutlineMarkdown(record));
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("agent-mindmap-mcp failed:", err);
  process.exit(1);
});
