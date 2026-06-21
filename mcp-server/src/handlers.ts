import * as fs from "fs/promises";
import * as path from "path";
import {
  buildConceptTermIndex,
  buildRecordTokenSets,
  computeStaleness,
  findProjectSlugByPath,
  McpSearchIndexCache,
  resolveProjectSlug,
  searchProjectRecords,
  STORE_LAYOUT,
  type ProjectSearchIndex,
  type SearchHit,
  type Staleness,
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
  /**
   * Resolves `CodeReference.path` against the local clone for a project slug
   * via the paths map the extension writes. Used by Q4 staleness verification.
   * Optional — absent when paths-map resolution is not wired (pre-Q4).
   */
  pathsResolver?: {
    resolvePath: (slug: string, relPath: string) => import("./pathsMap").ResolvePathResult;
    resetCache: () => void;
  };
};

export function createMcpHandlerContext(
  store: Store,
  storeDir?: string,
  pathsResolver?: McpHandlerContext["pathsResolver"]
): McpHandlerContext {
  return { store, storeDir, indexCache: new McpSearchIndexCache(), pathsResolver };
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

  // P5.4: In team mode, delegate search to the team service (Go token-scorer)
  // instead of building a local index. Staleness is still back-filled locally
  // after getting hits from either path.
  let hits: SearchHit[];
  if (ctx.store.search) {
    hits = await ctx.store.search(slug, opts.query, opts.limit, { verbose: opts.verbose });
  } else {
    const index = await ensureProjectIndex(ctx, slug);
    if (!index.records.length) {
      return {
        kind: "error",
        message: `no analyzed sessions for project \`${slug}\`. Run **Analyze All Sessions (Current Project)** first.`,
      };
    }
    const equivalences = await ctx.store.readLatestSegmentEquivalences(slug);
    hits = searchProjectRecords(
      index.records,
      opts.query,
      opts.limit,
      equivalences,
      index.conceptTerms,
      index.recordTokens,
      opts.verbose ?? false
    );
  }

  return { kind: "ok", hits };
}

export async function readSessionRecord(
  ctx: McpHandlerContext,
  projectSlug: string,
  sessionId: string
) {
  return ctx.store.getRecord(projectSlug, sessionId);
}

/**
 * Resolve a `CodeReference.path` against the local clone via the paths map
 * (P2.7) and read the file content. Returns `undefined` when the path does
 * not resolve (slug miss → `unknown` staleness) or the file cannot be read
 * (missing/unreadable → `stale` staleness). The caller distinguishes the two
 * via the `ResolvePathResult` from `pathsResolver`.
 */
async function readFileForCodeRef(
  ctx: McpHandlerContext,
  projectSlug: string,
  codePath: string
): Promise<{ kind: "unknown" } | { kind: "stale" } | { kind: "content"; text: string }> {
  if (!ctx.pathsResolver) {
    return { kind: "unknown" };
  }
  const resolved = ctx.pathsResolver.resolvePath(projectSlug, codePath);
  if (
    resolved.kind === "empty-rel-path" ||
    resolved.kind === "miss" ||
    resolved.kind === "path-escape"
  ) {
    return { kind: "unknown" };
  }
  try {
    const text = await fs.readFile(resolved.absPath, "utf8");
    return { kind: "content", text };
  } catch {
    return { kind: "stale" };
  }
}

/**
 * Compute staleness for a single `CodeReference` (Q4 §Decided design item 3).
 * Uses a per-response file-content cache so multiple refs to the same file
 * share one read.
 */
async function computeCodeRefStaleness(
  ctx: McpHandlerContext,
  projectSlug: string,
  codePath: string,
  markCode: string[] | undefined,
  fileCache: Map<
    string,
    { kind: "unknown" } | { kind: "stale" } | { kind: "content"; text: string }
  >
): Promise<Staleness> {
  const cacheKey = `${projectSlug}\0${codePath}`;
  let entry = fileCache.get(cacheKey);
  if (!entry) {
    entry = await readFileForCodeRef(ctx, projectSlug, codePath);
    fileCache.set(cacheKey, entry);
  }
  if (entry.kind === "unknown") {
    return "unknown";
  }
  if (entry.kind === "stale") {
    return "stale";
  }
  return computeStaleness(markCode, entry.text);
}

/**
 * Back-fill `staleness` on every code `SearchHit` in-place (Q4.4 — MCP server
 * is the single place where staleness is computed in both modes; team service
 * hits arrive without staleness). One file read per distinct `(slug, path)`
 * pair per call (same-path dedup via `fileCache`).
 */
export async function backFillStaleness(
  ctx: McpHandlerContext,
  hits: {
    kind: string;
    projectSlug: string;
    codePath?: string;
    codeMarkCode?: string[];
    staleness?: Staleness;
  }[]
): Promise<void> {
  if (!ctx.pathsResolver) {
    return;
  }
  const fileCache = new Map<
    string,
    { kind: "unknown" } | { kind: "stale" } | { kind: "content"; text: string }
  >();
  for (const hit of hits) {
    if (hit.kind !== "code" || !hit.codePath) {
      continue;
    }
    hit.staleness = await computeCodeRefStaleness(
      ctx,
      hit.projectSlug,
      hit.codePath,
      hit.codeMarkCode,
      fileCache
    );
  }
}
