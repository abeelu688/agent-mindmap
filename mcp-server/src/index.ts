#!/usr/bin/env node
import {
  bootstrapStore,
  collectConceptContexts,
  mergeOutlinesForDisplay,
  renderConceptDetail,
  renderMemoryRetrieval,
  renderProjectBriefing,
  renderProjectList,
  renderProjectSessionsList,
  renderSearchResults,
  renderSessionOutlineMarkdown,
  resolveStoreDir,
} from "@agent-mindmap/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  backFillStaleness,
  createMcpHandlerContext,
  ensureProjectIndex,
  resolveSlug,
  runProjectSearch,
} from "./handlers";
import { resolveMcpLocale } from "./mcpLocale";
import { createPathsResolver } from "./pathsMap";
import { resolveAllToolDescriptions } from "./toolDescriptions";

declare const __MCP_SERVER_VERSION__: string;
const SERVER_VERSION =
  typeof __MCP_SERVER_VERSION__ !== "undefined" ? __MCP_SERVER_VERSION__ : "0.0.0-dev";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/** Default pagination limits for MCP resources. */
const PAGINATION_DEFAULT_LIMIT = 20;
const PAGINATION_MAX_LIMIT = 100;

/**
 * Parse and clamp pagination params from URI search params.
 * Ensures limit is 1..100, offset is >= 0; invalid values fall back to defaults.
 */
function parsePaginationParams(
  searchParams: URLSearchParams,
  defaultLimit = PAGINATION_DEFAULT_LIMIT
): { limit: number; offset: number } {
  const rawLimit = Number(searchParams.get("limit") ?? defaultLimit);
  const rawOffset = Number(searchParams.get("offset") ?? 0);
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(Math.round(rawLimit), PAGINATION_MAX_LIMIT)
      : defaultLimit;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.round(rawOffset) : 0;
  return { limit, offset };
}

type ToolHandlerResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/**
 * Wrap a tool handler with a uniform try/catch that turns thrown errors into
 * `isError: true` text results.
 *
 * Intentionally non-generic: a `TArgs`-parameterized return type forces TS to
 * unify it against `ToolCallback<Args>`'s `ShapeOutput<Args>` at every call
 * site, which trips TS2589 on tools with 4+ schema fields. Letting the args
 * flow as `any` keeps inference shallow; the inner handler still gets field
 * names from its destructuring pattern.
 */
function withErrorHandler(
  fn: (args: any) => Promise<ToolHandlerResult>
): (args: any) => Promise<ToolHandlerResult> {
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
  const storeDir = resolveStoreDir();
  const bootstrap = await bootstrapStore(storeDir);
  if (bootstrap.warning) {
    // MCP stdio reserves stdout for protocol traffic; warnings go to stderr.
    console.error(`[agent-mindmap] store bootstrap: ${bootstrap.warning}`);
  }
  const ctx = createMcpHandlerContext(bootstrap.store, storeDir, createPathsResolver(storeDir));

  const server = new McpServer({
    name: "agent-mindmap",
    version: SERVER_VERSION,
  });

  const locale = resolveMcpLocale();
  const descriptions = resolveAllToolDescriptions(locale);

  server.tool("list_projects", descriptions.list_projects, {}, async () => {
    try {
      const projects = await ctx.store.listProjectSummaries();
      return textResult(renderProjectList(projects));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return errorResult(`internal error: ${detail}`);
    }
  });

  server.tool(
    "server_info",
    "Server orientation: capabilities, store path, and recommended call flow. " +
      "This server indexes past AI agent sessions (Cursor/Claude Code) analyzed by the Agent Mind Map VS Code extension. " +
      "Recommended flow: call `list_projects` first to discover `projectSlug`s, then `search_project_history` or `retrieve_project_memory` for content, `get_project_briefing` for a recap, `get_concept_detail` / `get_session_outline` to drill in.",
    {},
    async () => {
      const lines = [
        "# agent-mindmap MCP server",
        "",
        `- **name**: \`agent-mindmap\``,
        `- **version**: \`${SERVER_VERSION}\``,
        `- **storeDir**: \`${ctx.storeDir ?? "(remote)"}\``,
        `- **cached projects**: ${ctx.indexCache.size()}`,
        `- **example-locale**: \`${locale}\``,
        "",
        "**Recommended flow**",
        "1. `list_projects` → discover `projectSlug`s.",
        "2. `search_project_history` (semantic + keyword) or `retrieve_project_memory` (synthesis) for content.",
        "3. `get_project_briefing` for a high-level recap; `get_concept_detail` / `get_session_outline` to drill in.",
        "",
        "This server indexes past AI agent sessions (Cursor/Claude Code) analyzed by the Agent Mind Map VS Code extension. It does NOT see your current files or live code.",
      ];
      return textResult(lines.join("\n"));
    }
  );

  // @ts-expect-error TS2589: zod + MCP SDK deep type instantiation; withErrorHandler keeps inference shallow
  server.tool(
    "get_project_briefing",
    descriptions.get_project_briefing,
    {
      projectPath: z.string().optional().describe("Workspace folder filesystem path"),
      projectSlug: z
        .string()
        .optional()
        .describe(
          "Project store key (repo URI slug in repo mode, workspace slug in workspace mode)"
        ),
      recentLimit: z.number().int().min(1).max(20).optional(),
      conceptLimit: z.number().int().min(1).max(30).optional(),
    },
    withErrorHandler(async ({ projectPath, projectSlug, recentLimit, conceptLimit }) => {
      const slug = await resolveSlug(ctx, { projectPath, projectSlug });
      if (!slug) {
        return errorResult(
          "provide projectPath or projectSlug, and ensure the project has been analyzed in Agent Mind Map."
        );
      }
      const index = await ensureProjectIndex(ctx, slug);
      if (!index.records.length) {
        return errorResult(
          `no analyzed sessions for project \`${slug}\`. Run **Analyze All Sessions (Current Project)** first.`
        );
      }
      const conceptTrie = await ctx.store.readConceptTrieMerge();
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
    descriptions.list_project_sessions,
    {
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
      includeVirtual: z.boolean().optional(),
    },
    withErrorHandler(
      async ({ projectPath, projectSlug, limit = 20, offset = 0, includeVirtual = false }) => {
        const slug = await resolveSlug(ctx, { projectPath, projectSlug });
        if (!slug) {
          return errorResult("provide projectPath or projectSlug.");
        }
        const index = await ensureProjectIndex(ctx, slug);
        const filtered = includeVirtual
          ? index.records
          : index.records.filter((r) => r.meta.parentSessionId === undefined);
        const sorted = [...filtered].sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
        const page = sorted.slice(offset, offset + limit);
        return textResult(
          renderProjectSessionsList(slug, page, {
            limit,
            offset,
            total: sorted.length,
          })
        );
      }
    )
  );

  // @ts-expect-error TS2589: zod + MCP SDK deep type instantiation; withErrorHandler keeps inference shallow
  server.tool(
    "search_project_history",
    descriptions.search_project_history,
    {
      query: z.string().min(1),
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
      limit: z.number().int().min(1).max(30).optional(),
      verbose: z.boolean().optional(),
    },
    withErrorHandler(async ({ query, projectPath, projectSlug, limit = 10, verbose = false }) => {
      const result = await runProjectSearch(ctx, {
        query,
        projectPath,
        projectSlug,
        limit,
        verbose,
      });
      if (result.kind === "error") {
        return errorResult(result.message);
      }
      await backFillStaleness(ctx, result.hits);
      return textResult(renderSearchResults(query, result.hits, limit, verbose));
    })
  );

  server.tool(
    "retrieve_project_memory",
    descriptions.retrieve_project_memory,
    {
      query: z.string().min(1),
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
      limit: z.number().int().min(1).max(20).optional(),
    },
    withErrorHandler(async ({ query, projectPath, projectSlug, limit = 8 }) => {
      const result = await runProjectSearch(ctx, { query, projectPath, projectSlug, limit });
      if (result.kind === "error") {
        return errorResult(result.message);
      }
      await backFillStaleness(ctx, result.hits);
      return textResult(renderMemoryRetrieval(query, result.hits, limit));
    })
  );

  server.tool(
    "get_concept_detail",
    descriptions.get_concept_detail,
    {
      conceptKey: z.string().min(1),
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
    },
    withErrorHandler(async ({ conceptKey, projectPath, projectSlug }) => {
      const slug = await resolveSlug(ctx, { projectPath, projectSlug });
      if (!slug) {
        return errorResult("provide projectPath or projectSlug.");
      }
      const index = await ensureProjectIndex(ctx, slug);
      const contexts = collectConceptContexts(index.records);
      return textResult(renderConceptDetail(conceptKey, contexts, index.records));
    })
  );

  server.tool(
    "get_session_outline",
    descriptions.get_session_outline,
    {
      sessionId: z.string().min(1),
      projectPath: z.string().optional(),
      projectSlug: z.string().optional(),
    },
    withErrorHandler(async ({ sessionId, projectPath, projectSlug }) => {
      const slug = await resolveSlug(ctx, { projectPath, projectSlug });
      if (!slug) {
        return errorResult("provide projectPath or projectSlug.");
      }
      const record = await ctx.store.getRecord(slug, sessionId);
      if (!record) {
        return errorResult(`session \`${sessionId}\` not found for project \`${slug}\`.`);
      }
      // If this is an original session (no parent), merge in any virtual
      // sessions so the caller sees the full outline covering all turns.
      let view = record;
      if (!record.meta.parentSessionId && record.meta.turnHashes) {
        const all = await ctx.store.listRecordsForProject(slug);
        const virtuals = all.filter((r) => r.meta.parentSessionId === sessionId);
        if (virtuals.length > 0) {
          virtuals.sort(
            (a, b) => (a.meta.virtualSessionIndex ?? 0) - (b.meta.virtualSessionIndex ?? 0)
          );
          view = mergeOutlinesForDisplay([record, ...virtuals]) ?? record;
        }
      }
      return textResult(renderSessionOutlineMarkdown(view));
    })
  );

  server.registerResource(
    "project_sessions",
    new ResourceTemplate("agent-mindmap://project/{projectSlug}/sessions", {
      list: undefined,
    }),
    {
      description:
        "List analyzed sessions for a project. URI: agent-mindmap://project/{projectSlug}/sessions?limit=&offset=",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const projectSlug = String(variables.projectSlug ?? "");
      const { limit, offset } = parsePaginationParams(uri.searchParams);
      const index = await ensureProjectIndex(ctx, projectSlug);
      const sorted = [...index.records].sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
      const page = sorted.slice(offset, offset + limit);
      const markdown = renderProjectSessionsList(projectSlug, page, {
        limit,
        offset,
        total: sorted.length,
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: markdown,
          },
        ],
      };
    }
  );

  server.registerResource(
    "session_outline",
    new ResourceTemplate("agent-mindmap://session/{projectSlug}/{sessionId}", {
      list: undefined,
    }),
    {
      description: "Render a single session outline as markdown.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const projectSlug = String(variables.projectSlug ?? "");
      const sessionId = String(variables.sessionId ?? "");
      const record = await ctx.store.getRecord(projectSlug, sessionId);
      if (!record) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: `_session \`${sessionId}\` not found for project \`${projectSlug}\`._`,
            },
          ],
        };
      }
      // Merge virtual sessions for original sessions so the rendered outline
      // covers all turns, not just the original's [0, K) slice.
      let view = record;
      if (!record.meta.parentSessionId && record.meta.turnHashes) {
        const all = await ctx.store.listRecordsForProject(projectSlug);
        const virtuals = all.filter((r) => r.meta.parentSessionId === sessionId);
        if (virtuals.length > 0) {
          virtuals.sort(
            (a, b) => (a.meta.virtualSessionIndex ?? 0) - (b.meta.virtualSessionIndex ?? 0)
          );
          view = mergeOutlinesForDisplay([record, ...virtuals]) ?? record;
        }
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: renderSessionOutlineMarkdown(view),
          },
        ],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("agent-mindmap-mcp failed:", err);
  process.exit(1);
});
