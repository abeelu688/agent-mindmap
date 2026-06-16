#!/usr/bin/env node
import {
  collectConceptContexts,
  findProjectSlugByPath,
  listProjectSummaries,
  listRecordsForProject,
  McpSearchIndexCache,
  projectRevision,
  readConceptTrieMerge,
  readMcpIndex,
  readRecord,
  renderConceptDetail,
  renderProjectBriefing,
  renderProjectList,
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

const storeDir = resolveStoreDir();
const indexCache = new McpSearchIndexCache();

async function ensureProjectIndex(projectSlug: string): Promise<ProjectSearchIndex> {
  const cached = indexCache.get(projectSlug);
  const mcpIndex = await readMcpIndex(storeDir);
  const revision = projectRevision(mcpIndex, projectSlug);
  if (cached && cached.revision === revision) {
    return cached;
  }
  const records = await listRecordsForProject(storeDir, projectSlug);
  const built: ProjectSearchIndex = {
    projectSlug,
    revision,
    records,
    builtAt: Date.now(),
  };
  indexCache.set(built);
  return built;
}

async function resolveSlug(opts: {
  projectPath?: string;
  projectSlug?: string;
}): Promise<string | undefined> {
  const direct = resolveProjectSlug(opts);
  if (direct && (await listRecordsForProject(storeDir, direct)).length) {
    return direct;
  }
  if (opts.projectPath) {
    const summaries = await listProjectSummaries(storeDir);
    return findProjectSlugByPath(summaries, opts.projectPath);
  }
  return direct;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "agent-mindmap",
    version: "0.2.3",
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
        return textResult(
          "Error: provide projectPath or projectSlug, and ensure the project has been analyzed in Agent Mind Map."
        );
      }
      const index = await ensureProjectIndex(slug);
      if (!index.records.length) {
        return textResult(
          `Error: no analyzed sessions for project \`${slug}\`. Run **Analyze All Sessions (Current Project)** first.`
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
        return textResult("Error: provide projectPath or projectSlug.");
      }
      const index = await ensureProjectIndex(slug);
      const hits = searchProjectRecords(index.records, query, limit);
      return textResult(renderSearchResults(query, hits, limit));
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
        return textResult("Error: provide projectPath or projectSlug.");
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
        return textResult("Error: provide projectPath or projectSlug.");
      }
      const record = await readRecord(storeDir, slug, sessionId);
      if (!record) {
        return textResult(`Error: session \`${sessionId}\` not found for project \`${slug}\`.`);
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
