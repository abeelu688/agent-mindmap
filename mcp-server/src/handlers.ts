import {
  buildConceptTermIndex,
  buildRecordTokenSets,
  findProjectSlugByPath,
  listProjectSummaries,
  listRecordsForProject,
  McpSearchIndexCache,
  projectRecordCount,
  projectRevision,
  projectSessionsLatestMtimeMs,
  readLatestProjectSegmentEquivalences,
  readMcpIndex,
  readRecord,
  resolveProjectSlug,
  searchProjectRecords,
  type ProjectSearchIndex,
} from "@agent-mindmap/shared";

export type McpHandlerContext = {
  storeDir: string;
  indexCache: McpSearchIndexCache;
};

export function createMcpHandlerContext(storeDir: string): McpHandlerContext {
  return { storeDir, indexCache: new McpSearchIndexCache() };
}

export async function ensureProjectIndex(
  ctx: McpHandlerContext,
  projectSlug: string
): Promise<ProjectSearchIndex> {
  const { storeDir, indexCache } = ctx;
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

export async function resolveSlug(
  ctx: McpHandlerContext,
  opts: { projectPath?: string; projectSlug?: string }
): Promise<string | undefined> {
  const direct = resolveProjectSlug(opts);
  if (direct) {
    return direct;
  }
  if (opts.projectPath) {
    const summaries = await listProjectSummaries(ctx.storeDir);
    return findProjectSlugByPath(summaries, opts.projectPath);
  }
  return undefined;
}

export type RunProjectSearchResult =
  | { kind: "ok"; hits: ReturnType<typeof searchProjectRecords> }
  | { kind: "error"; message: string };

export async function runProjectSearch(
  ctx: McpHandlerContext,
  opts: {
    query: string;
    projectPath?: string;
    projectSlug?: string;
    limit: number;
    verbose?: boolean;
  }
): Promise<RunProjectSearchResult> {
  const slug = await resolveSlug(ctx, {
    projectPath: opts.projectPath,
    projectSlug: opts.projectSlug,
  });
  if (!slug) {
    return { kind: "error", message: "provide projectPath or projectSlug." };
  }
  const index = await ensureProjectIndex(ctx, slug);
  if (!index.records.length) {
    return {
      kind: "error",
      message: `no analyzed sessions for project \`${slug}\`. Run **Analyze All Sessions (Current Project)** first.`,
    };
  }
  const equivalences = await readLatestProjectSegmentEquivalences(ctx.storeDir, slug);
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

export async function readSessionRecord(
  ctx: McpHandlerContext,
  projectSlug: string,
  sessionId: string
) {
  return readRecord(ctx.storeDir, projectSlug, sessionId);
}
