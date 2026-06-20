import * as fs from "fs/promises";
import * as path from "path";
import {
  buildConceptTermIndex,
  buildRecordTokenSets,
  findProjectSlugByPath,
  McpSearchIndexCache,
  resolveProjectSlug,
  searchProjectRecords,
  STORE_LAYOUT,
  type ProjectSearchIndex,
  type Store,
} from "@agent-mindmap/shared";

export type McpHandlerContext = {
  store: Store;
  /**
   * Filesystem path to the on-disk store, used only for the mtime-based
   * cache-invalidation fast path. Undefined when the store is not backed by
   * a local directory (e.g. RemoteStore over HTTP); in that case the cache
   * falls back to revision-only invalidation.
   */
  storeDir?: string;
  indexCache: McpSearchIndexCache;
};

export function createMcpHandlerContext(store: Store, storeDir?: string): McpHandlerContext {
  return { store, storeDir, indexCache: new McpSearchIndexCache() };
}

async function getLatestSourceMtime(ctx: McpHandlerContext, projectSlug: string): Promise<number> {
  if (!ctx.storeDir) {
    return 0;
  }
  const slugDir = path.join(ctx.storeDir, STORE_LAYOUT.sessionsDir, projectSlug);
  let entries: string[];
  try {
    entries = await fs.readdir(slugDir);
  } catch {
    return 0;
  }
  let latest = 0;
  for (const file of entries) {
    if (!file.endsWith(".json")) {
      continue;
    }
    try {
      const stat = await fs.stat(path.join(slugDir, file));
      if (stat.mtimeMs > latest) {
        latest = stat.mtimeMs;
      }
    } catch {
      // skip unreadable files
    }
  }
  return latest;
}

export async function ensureProjectIndex(
  ctx: McpHandlerContext,
  projectSlug: string
): Promise<ProjectSearchIndex> {
  const { store, indexCache } = ctx;
  const cached = indexCache.get(projectSlug);
  const revision = await store.getProjectRevision(projectSlug);
  const expectedRecordCount = await store.getProjectRecordCount(projectSlug);
  const latestMtime = await getLatestSourceMtime(ctx, projectSlug);
  if (
    cached &&
    cached.revision === revision &&
    cached.sourceMtimeMs >= latestMtime &&
    (expectedRecordCount === undefined || cached.records.length === expectedRecordCount)
  ) {
    return cached;
  }
  return indexCache.build(projectSlug, async () => {
    const records = await store.listRecordsForProject(projectSlug);
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
    const summaries = await ctx.store.listProjectSummaries();
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
  const equivalences = await ctx.store.readLatestSegmentEquivalences(slug);
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
  return ctx.store.getRecord(projectSlug, sessionId);
}
