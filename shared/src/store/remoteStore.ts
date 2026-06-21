import {
  McpSearchIndexCache,
  buildConceptTermIndex,
  buildRecordTokenSets,
  type ProjectSearchIndex,
} from "../searchIndex";
import type {
  McpIndexFile,
  MergeRecord,
  OntologyIndex,
  OntologyRecord,
  ProjectSummary,
  SearchHit,
  SegmentEquivalence,
  SessionRecord,
} from "../storeTypes";
import type { Store } from "./store";

/**
 * `RemoteStore` is the team-mode `Store` — an HTTP client over the Go team
 * service's REST API. See `agent-mindmap/docs/TEAM_MODE.md` §HTTP API for
 * the contract.
 *
 * Responsibilities:
 *   - GET endpoints → cached where the `Store` interface implies repeated
 *     reads (`getProjectRevision`, `listRecordsForProject`). The
 *     `McpSearchIndexCache` (LRU, from single-machine mode) backs the
 *     project search-index, validated against `GET …/revision` before use
 *     — exactly the logic in `mcp-server/src/handlers.ts:ensureProjectIndex`,
 *     just hitting HTTP instead of `fs.stat`.
 *   - POST `/v1/projects/:slug/sessions/:id` is the only write path in v1.
 *     Other `Store` mutators (write-merge, write-ontology,
 *     deleteProjectRecords, bumpProjectRevision) throw `RemoteStoreNotSupported`
 *     — those operations are server-side (merge worker) or out of scope (no
 *     DELETE in v1).
 *   - Bearer auth from the constructor arg (extension passes the key from
 *     SecretStorage). Never logged.
 *   - Retry with exponential backoff on 5xx + network errors; no retry on
 *     4xx (those are caller errors — bad payload, unauthorized, not found).
 *
 * `fetch` is injected (or `globalThis.fetch` by default) so tests can mock
 * without `msw`. The cache is injected too (or a fresh
 * `McpSearchIndexCache`) so multiple `RemoteStore` instances can share one
 * cache if a future caller wants that.
 */

/** Maximum retries on 5xx / network errors. Total attempts = 1 + this. */
const MAX_RETRIES = 4;
/** Base delay for exponential backoff (ms). Actual delay = base * 2^attempt. */
const BACKOFF_BASE_MS = 500;
/** Upper bound on a single backoff sleep (ms). Caps at 5 min per PR plan. */
const BACKOFF_MAX_MS = 5 * 60 * 1000;

/**
 * Thrown by `RemoteStore` mutators that have no team-mode equivalent. The
 * merge worker writes concept tries / ontology server-side; the client
 * never writes them. `deleteProjectRecords` has no v1 surface (no DELETE).
 * `bumpProjectRevision` is implicit in `upsertRecord` server-side.
 */
export class RemoteStoreNotSupported extends Error {
  constructor(method: string) {
    super(`RemoteStore.${method} is not supported in team mode`);
    this.name = "RemoteStoreNotSupported";
  }
}

/**
 * Thrown when the server returns a non-2xx status. `status` is the HTTP
 * code; `body` is the raw response body text (small — the team service
 * emits a JSON error envelope). 4xx → caller error (no retry). 5xx →
 * retried then rethrown if all attempts fail.
 */
export class RemoteStoreHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly url: string
  ) {
    super(`HTTP ${status} from ${url}: ${body}`);
    this.name = "RemoteStoreHttpError";
  }
}

export type RemoteStoreOptions = {
  /**
   * Override `fetch` (e.g. for tests). Defaults to `globalThis.fetch`.
   * Required to be a `fetch`-compatible function.
   */
  fetchImpl?: typeof fetch;
  /** Override the LRU cache (e.g. to share across stores). */
  cache?: McpSearchIndexCache;
  /** Override backoff params (tests). */
  maxRetries?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Injectable sleep for deterministic backoff tests. */
  sleep?: (ms: number) => Promise<void>;
};

export class RemoteStore implements Store {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache: McpSearchIndexCache;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Cached concept-trie merge + its revision, for cheap polling (P5.3). */
  private cachedConceptTrie: { revision: number; merge: MergeRecord } | undefined;

  constructor(serverUrl: string, apiKey: string, opts: RemoteStoreOptions = {}) {
    if (!serverUrl) {
      throw new Error("RemoteStore: serverUrl is required");
    }
    if (!apiKey) {
      throw new Error("RemoteStore: apiKey is required");
    }
    // Strip trailing slash so `baseUrl + "/v1/..."` produces single slashes.
    this.baseUrl = serverUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.cache = opts.cache ?? new McpSearchIndexCache();
    this.maxRetries = opts.maxRetries ?? MAX_RETRIES;
    this.backoffBaseMs = opts.backoffBaseMs ?? BACKOFF_BASE_MS;
    this.backoffMaxMs = opts.backoffMaxMs ?? BACKOFF_MAX_MS;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ─── Project-level ─────────────────────────────────────────────────────────

  async listProjectSummaries(): Promise<ProjectSummary[]> {
    const raw = await this.getJson<ProjectSummary[]>("/v1/projects");
    return raw ?? [];
  }

  async getProjectRevision(projectSlug: string): Promise<number> {
    const body = await this.getJson<{ revision: number; recordCount: number }>(
      `/v1/projects/${encodeURIComponent(projectSlug)}/revision`
    );
    return body.revision;
  }

  async getProjectRecordCount(projectSlug: string): Promise<number | undefined> {
    const body = await this.getJson<{ revision: number; recordCount: number }>(
      `/v1/projects/${encodeURIComponent(projectSlug)}/revision`
    );
    return body.recordCount;
  }

  // ─── Session records ───────────────────────────────────────────────────────

  async getRecord(projectSlug: string, sessionId: string): Promise<SessionRecord | undefined> {
    try {
      return await this.getJson<SessionRecord>(
        `/v1/projects/${encodeURIComponent(projectSlug)}/sessions/${encodeURIComponent(sessionId)}`
      );
    } catch (err) {
      if (err instanceof RemoteStoreHttpError && err.status === 404) {
        return undefined;
      }
      throw err;
    }
  }

  async listRecordsForProject(projectSlug: string): Promise<SessionRecord[]> {
    // Page until the server returns fewer than `limit` records. The team
    // service clamps limit to 1000, so use that as our page size.
    const limit = 1000;
    const out: SessionRecord[] = [];
    let offset = 0;
    // Safety cap: 1000 pages × 1000 records = 1M records. Real projects are
    // far smaller; this just prevents an infinite loop if the server has a
    // paging bug.
    for (let i = 0; i < 1000; i++) {
      const page = await this.getJson<SessionRecord[]>(
        `/v1/projects/${encodeURIComponent(projectSlug)}/sessions?limit=${limit}&offset=${offset}`
      );
      if (!page || page.length === 0) {
        break;
      }
      out.push(...page);
      if (page.length < limit) {
        break;
      }
      offset += limit;
    }
    return out;
  }

  /**
   * Team mode: no cross-project list endpoint in v1. Iterate
   * `listProjectSummaries` + `listRecordsForProject`. Used by jump-to-origin
   * and the local merge worker (rare; team mode prefers the server-side
   * merge worker for cross-session concepts).
   */
  async listAllRecords(): Promise<SessionRecord[]> {
    const summaries = await this.listProjectSummaries();
    const out: SessionRecord[] = [];
    for (const s of summaries) {
      const records = await this.listRecordsForProject(s.projectSlug);
      out.push(...records);
    }
    return out;
  }

  async upsertRecord(record: SessionRecord): Promise<{ revision: number }> {
    const slug = record.meta.projectSlug;
    const sessionId = record.meta.sessionId;
    if (!slug || !sessionId) {
      throw new Error(
        `RemoteStore.upsertRecord: record.meta.projectSlug + sessionId required (got slug=${slug}, sessionId=${sessionId})`
      );
    }
    const body = JSON.stringify(record);
    const resp = await this.postJson<{ revision: number }>(
      `/v1/projects/${encodeURIComponent(slug)}/sessions/${encodeURIComponent(sessionId)}`,
      body
    );
    // Invalidate the local search-index cache for this project — the
    // revision bumped and records changed.
    this.cache.invalidate(slug);
    return resp;
  }

  async deleteProjectRecords(_projectSlug: string): Promise<void> {
    throw new RemoteStoreNotSupported("deleteProjectRecords");
  }

  // ─── Merge / ontology (read paths hit REST; writes are server-side) ─────────

  async readConceptTrieMerge(): Promise<MergeRecord | undefined> {
    // P5.3: poll the cheap revision endpoint first. If the revision matches the
    // cached merge, return it without fetching the full trie. This mirrors the
    // pattern in ensureProjectIndex (revision-gated cache) and avoids pulling
    // the potentially large MergeRecord payload on every call.
    const revision = await this.readConceptTrieRevision();
    if (this.cachedConceptTrie && this.cachedConceptTrie.revision === revision) {
      return this.cachedConceptTrie.merge;
    }
    try {
      const merge = await this.getJson<MergeRecord>("/v1/merges/concept-trie");
      this.cachedConceptTrie = { revision, merge };
      return merge;
    } catch (err) {
      if (err instanceof RemoteStoreHttpError && err.status === 404) {
        return undefined;
      }
      throw err;
    }
  }

  /**
   * Cheap cache-validation endpoint: returns just the revision counter the
   * merge worker bumps on each rewrite. The MCP server uses this to skip
   * re-fetching the full trie when nothing changed.
   */
  async readConceptTrieRevision(): Promise<number> {
    const body = await this.getJson<{ revision: number }>("/v1/merges/concept-trie/revision");
    return body.revision;
  }

  async writeConceptTrieMerge(_merge: MergeRecord): Promise<void> {
    throw new RemoteStoreNotSupported("writeConceptTrieMerge");
  }

  async readDeterministicMerge(): Promise<MergeRecord | undefined> {
    // The team service does not expose deterministic / llm-refined merges
    // as separate endpoints in v1 — the concept-trie endpoint serves the
    // merged view. Return undefined; callers fall back to concept-trie.
    return undefined;
  }

  async writeDeterministicMerge(_merge: MergeRecord): Promise<void> {
    throw new RemoteStoreNotSupported("writeDeterministicMerge");
  }

  async readLlmRefinedMerge(): Promise<MergeRecord | undefined> {
    return undefined;
  }

  async writeLlmRefinedMerge(_merge: MergeRecord): Promise<void> {
    throw new RemoteStoreNotSupported("writeLlmRefinedMerge");
  }

  async readLlmMergeCache(_cacheKey: string): Promise<MergeRecord | undefined> {
    return undefined;
  }

  async writeLlmMergeCache(_cacheKey: string, _merge: MergeRecord): Promise<void> {
    throw new RemoteStoreNotSupported("writeLlmMergeCache");
  }

  async readOntologyIndex(): Promise<OntologyIndex | undefined> {
    // Not exposed as a dedicated endpoint in v1. The equivalences endpoint
    // serves the derived view callers need.
    return undefined;
  }

  async writeOntologyIndex(_index: OntologyIndex): Promise<void> {
    throw new RemoteStoreNotSupported("writeOntologyIndex");
  }

  async readOntologyRecord(_cacheKey: string): Promise<OntologyRecord | undefined> {
    return undefined;
  }

  async writeOntologyRecord(_cacheKey: string, _record: OntologyRecord): Promise<void> {
    throw new RemoteStoreNotSupported("writeOntologyRecord");
  }

  async clearOntologyCache(): Promise<void> {
    throw new RemoteStoreNotSupported("clearOntologyCache");
  }

  async readLatestSegmentEquivalences(projectSlug: string): Promise<SegmentEquivalence[]> {
    try {
      const raw = await this.getJson<
        SegmentEquivalence[] | { segmentEquivalences: SegmentEquivalence[] }
      >(`/v1/projects/${encodeURIComponent(projectSlug)}/equivalences`);
      if (!raw) {
        return [];
      }
      if (Array.isArray(raw)) {
        return raw;
      }
      return raw.segmentEquivalences ?? [];
    } catch (err) {
      if (err instanceof RemoteStoreHttpError && err.status === 404) {
        return [];
      }
      throw err;
    }
  }

  /**
   * In team mode the project revision is bumped server-side by `upsertRecord`.
   * Clients don't bump it directly.
   */
  async bumpProjectRevision(
    _projectSlug: string,
    _recordCount: number,
    _opts?: { lastAnalyzedAt?: number; projectPath?: string }
  ): Promise<McpIndexFile> {
    throw new RemoteStoreNotSupported("bumpProjectRevision");
  }

  // ─── Search (P5.4 — team mode delegates to Go token-scorer) ──────────────────

  /**
   * Server-side search via `POST /v1/projects/:slug/search`. The Go team
   * service runs the token scorer (a port of `searchProjectRecords`) and
   * optionally the embedding scorer, then returns ranked `SearchHit[]`.
   * No caching — search is stateless per query.
   */
  async search(
    projectSlug: string,
    query: string,
    limit: number,
    opts?: { verbose?: boolean }
  ): Promise<SearchHit[]> {
    const body = JSON.stringify({
      query,
      limit,
      verbose: opts?.verbose ?? false,
    });
    const raw = await this.postJson<SearchHit[]>(
      `/v1/projects/${encodeURIComponent(projectSlug)}/search`,
      body
    );
    return raw ?? [];
  }

  // ─── Search-index cache (mirrors mcp-server/handlers.ensureProjectIndex) ─────

  /**
   * Build (or return cached) `ProjectSearchIndex` for `projectSlug`,
   * validating the cache against `GET …/revision`. The team service has no
   * mtime signal (it's a remote service), so cache invalidation is
   * revision-only — same shape as `ensureProjectIndex` with `storeDir`
   * undefined.
   */
  async ensureProjectIndex(projectSlug: string): Promise<ProjectSearchIndex> {
    const cached = this.cache.get(projectSlug);
    const revision = await this.getProjectRevision(projectSlug);
    const expectedRecordCount = await this.getProjectRecordCount(projectSlug);
    if (
      cached &&
      cached.revision === revision &&
      (expectedRecordCount === undefined || cached.records.length === expectedRecordCount)
    ) {
      return cached;
    }
    // Stale or missing — drop the cache entry before calling `build`,
    // because `McpSearchIndexCache.build` returns a present entry as-is
    // (it dedupes concurrent builds, not rebuild requests).
    this.cache.invalidate(projectSlug);
    return this.cache.build(projectSlug, async () => {
      const records = await this.listRecordsForProject(projectSlug);
      const built: ProjectSearchIndex = {
        projectSlug,
        revision,
        sourceMtimeMs: 0,
        records,
        conceptTerms: buildConceptTermIndex(records),
        recordTokens: buildRecordTokenSets(records),
        builtAt: Date.now(),
      };
      return built;
    });
  }

  /** Exposed for tests + the MCP server's `indexCache` field. */
  getIndexCache(): McpSearchIndexCache {
    return this.cache;
  }

  // ─── HTTP plumbing ──────────────────────────────────────────────────────────

  private async getJson<T>(path: string): Promise<T> {
    const resp = await this.request("GET", path, undefined);
    return (await resp.json()) as T;
  }

  private async postJson<T>(path: string, body: string): Promise<T> {
    const resp = await this.request("POST", path, body);
    return (await resp.json()) as T;
  }

  /**
   * Single fetch with retry. GETs are idempotent → retry on 5xx/network.
   * POST `/sessions/:id` is idempotent by design (server upserts keyed on
   * session id, LWW on analyzedAt) → safe to retry on 5xx/network too.
   */
  private async request(
    method: "GET" | "POST",
    path: string,
    body: string | undefined
  ): Promise<Response> {
    const url = this.baseUrl + path;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const resp = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body,
        });
        if (resp.status >= 500) {
          // 5xx → retry with backoff.
          lastErr = new RemoteStoreHttpError(resp.status, await resp.text(), url);
        } else if (resp.status >= 400) {
          // 4xx → caller error, no retry.
          throw new RemoteStoreHttpError(resp.status, await resp.text(), url);
        } else {
          return resp;
        }
      } catch (err) {
        // Network error (fetch rejected) → retry. RemoteStoreHttpError on
        // 4xx is rethrown (not retried) — it's already a caller error.
        if (err instanceof RemoteStoreHttpError && err.status < 500) {
          throw err;
        }
        lastErr = err;
      }
      if (attempt < this.maxRetries) {
        await this.sleep(this.backoffDelay(attempt));
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`RemoteStore: exhausted retries for ${method} ${path}`);
  }

  private backoffDelay(attempt: number): number {
    const raw = this.backoffBaseMs * Math.pow(2, attempt);
    return Math.min(raw, this.backoffMaxMs);
  }
}
