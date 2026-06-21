# Team Mode — PR Plan

> **Companion to**: [`TEAM_MODE.md`](TEAM_MODE.md). This document breaks the six-phase plan into concrete, reviewable PRs. Each PR is one logical change, independently mergeable, with the test coverage and rollback path noted.
>
> **Convention**: PRs are numbered `P<phase>.<sequence>` (e.g. `P1.2`). Phases must land in order; PRs within a phase land in sequence unless noted. Every PR keeps `npm run test:vitest` green and the extension buildable.

## Phase 1 — Introduce the `Store` interface

Goal: one storage abstraction, current JSON behavior preserved behind it. No new features. This is the foundation every later phase depends on.

### P1.1 — Define `Store` interface and `JsonFsStore` skeleton

**Scope**

- Add `shared/src/store/store.ts` exporting the `Store` interface (from `TEAM_MODE.md` §Store interface).
- Add `shared/src/store/jsonFsStore.ts` — a `JsonFsStore` class implementing `Store` by delegating to the existing functions in `storeReader.ts`, `mcpIndex.ts`, `atomicWrite.ts`. No behavior change; it's a thin wrapper.
- Export `Store`, `JsonFsStore` from `shared/src/index.ts`.
- Add unit tests in `test/store/jsonFsStore.test.ts` covering each method against a temp store dir (mirror the fixtures in `test/mcpShared.test.ts`).

**Not in scope**: switching any caller to use `Store` yet. The interface exists but nothing depends on it.

**Test**: new `jsonFsStore.test.ts` passes; existing 405 tests unchanged.

**Rollback**: revert single PR; no caller affected.

### P1.2 — Port MCP server to `Store`

**Scope**

- `mcp-server/src/handlers.ts`: `createMcpHandlerContext(storeDir)` becomes `createMcpHandlerContext(store: Store)`. The handler functions take `Store` instead of reading `storeDir`.
- `mcp-server/src/index.ts`: construct `new JsonFsStore(resolveStoreDir())` at startup, pass to context.
- Update `test/mcpHandlers.test.ts` to construct `JsonFsStore` and pass it in (instead of `createMcpHandlerContext(tmp)`).

**Test**: `mcpHandlers.test.ts` updated; all tests green.

**Rollback**: revert; MCP server returns to `storeDir`-based handlers.

### P1.3 — Port extension store READ callers to `Store`

**Scope**

- The extension has its own store layer at `extension/src/store/` (sessionStore, ontologyStore, mergeSnapshot, etc.) that reads/writes JSON directly. Add a memoized `getStore(): Store` accessor (`extension/src/store/storeClient.ts`) keyed on `getStoreDir()`, and route the extension's session-record **read** paths through it.
- Files touched: `store/storeClient.ts` (new), `commands/analyzeProject.ts`, `sessionLoader.ts`, `mindmap/rebuildMindMapFromStore.ts`, `mcp/mcpConfig.ts`, `pipeline/batchMergeCache.ts`.
- Read paths route through `Store.getRecord` / `Store.listRecordsForProject` / `Store.readConceptTrieMerge`. The existing MCP-index bump flow (`mcpConfig.ts` → `refreshMcpIndexForProject` / `refreshMcpIndexForWorkspace`) already routes through `Store.bumpProjectRevision`; those call sites swap their inline `new JsonFsStore(getStoreDir())` to `getStore()`.
- **Session-record writes stay on the raw `writeRecord` helper.** Routing them through `Store.upsertRecord` is NOT behavior-preserving: `upsertRecord` bumps the MCP project revision + rewrites `.mcp-index.json` + re-reads all project records on every call, while `writeRecord` writes only the file. With default `agentMindmap.mcp.autoRefreshOnAnalyze=false`, that turns ~0 `.mcp-index.json` writes per batch into 100+, and double-bumps when the flag is on. `upsertRecord`'s bump-on-write semantic is correct for team mode (it drives the P4.3 push queue + P5.1 merge worker), so it must not change. Write-routing lands in a follow-up PR alongside the P4.3 push queue, where bump-on-write is the correct semantic.
- Out of scope (stay raw): `writeRecord` (all sites); unfiltered `listRecords(storeDir)` list-all (no `listAllRecords` on `Store`); `rebuildIndex`/`readIndex` (extension-local `index.json`); all merge-snapshot / ontology / deterministic-merge / llm-refined-merge writers and readers (none on the `Store` interface — absorbed in a later team-mode phase); `codeRefQueue.ts` (uses `item.storeDir` captured at enqueue time; the queue's writes stay raw, so leaving it raw is consistent); `ensureStore`; equivalences reads (the extension's subset-matching loader has different semantics than `Store.readLatestSegmentEquivalences`).

**Not in scope**: changing what gets written or read. Same JSON files, same contents.

**Test**: existing extension tests green; add `test/store/extensionStoreRouting.test.ts` — a contract test asserting the `Store` methods P1.3 routes to are byte-compatible with the raw functions they replaced (read parity, `upsertRecord` write byte-compat, concept-trie read parity, `getRecord` does NOT mutate `.mcp-index.json`, `bumpProjectRevision` does). The heavier end-to-end "analyze a session, byte-compare on-disk JSON" smoke test is deferred to a follow-up.

**Rollback**: revert; extension returns to direct `sessionStore` reads. The raw functions are unchanged (they still back the un-ported writers), so `getStore()` simply becomes unused and `storeClient.ts` is deleted. `mcpConfig.ts` reverts to inline `new JsonFsStore(getStoreDir())`. On-disk JSON unchanged.

### P1.4 — Retire `storeReader.ts` direct exports from internal call sites

**Scope**

- After P1.3, no production code calls `listRecords`/`readRecord`/`readMcpIndex`/`bumpMcpProjectRevision` directly — all go through `Store`. Keep the functions in `storeReader.ts`/`mcpIndex.ts` as the `JsonFsStore` implementation internals, but stop re-exporting them from `shared/src/index.ts` (they become internal to `jsonFsStore.ts`).
- Update any tests that imported them directly to use `JsonFsStore` instead.

**Test**: all tests green; `shared/src/index.ts` no longer exports raw store functions.

**Rollback**: revert the re-export removal; functions become public again.

**End of phase 1**: storage access is fully behind `Store`. `JsonFsStore` is the only implementation. Behavior identical to today.

---

## Phase 2 — SQLite for single-machine mode

Goal: replace JSON files with `store.db` (SQLite). One schema, shared with the future Postgres backend. Ships before team mode.

### P2.1 — Add SQLite dependency and schema

**Scope**

- Add `better-sqlite3` (synchronous, no native async overhead for our read/write volume) to `shared/` deps. ❓ Confirm `better-sqlite3` vs `node:sqlite` (Node 22+ experimental) — recommend `better-sqlite3` for stability and VS Code's Node version compatibility.
- Add `shared/src/store/sqliteSchema.ts` with the three tables (`projects`, `sessions`, `kv`) from `TEAM_MODE.md` §SQLite schema. Schema creation is idempotent (`CREATE TABLE IF NOT EXISTS`).
- Add `shared/src/store/sqliteStore.ts` — `SqliteStore implements Store`, backed by `better-sqlite3`. Transactions via `db.transaction(...)`. `bumpProjectRevision` uses `INSERT ... ON CONFLICT ... UPDATE revision = revision + 1` inside a transaction (no file lock).
- Unit tests in `test/store/sqliteStore.test.ts` — same test cases as `jsonFsStore.test.ts`, parameterized over both implementations.

**Not in scope**: wiring `SqliteStore` into the extension; migration logic.

**Test**: `sqliteStore.test.ts` passes; `jsonFsStore.test.ts` still passes (both impls behind same interface).

**Rollback**: revert; `JsonFsStore` still the only wired impl.

### P2.2 — JSON → SQLite migration

**Scope**

- Add `shared/src/store/migrateJsonToSqlite.ts`: reads existing `~/.agent-mindmap/` JSON files, writes into a fresh `store.db`. Idempotent (snapshot file set first; re-run produces same DB).
- Handles concurrent-write safety per `TEAM_MODE.md` §Migration 1: snapshot JSON file list, import, then drain any writes that landed in JSON during import into the DB. Implementation detail: the extension pauses new write-through-to-JSON during the import window (a few seconds typically) and queues.
- On first launch after upgrade, `extension/src/extension.ts` detects no `store.db` but existing JSON files → run migration → switch to `SqliteStore`. If `store.db` exists, skip.
- Original JSON files are **not deleted** (kept for one release for downgrade safety, per decision 2).
- `JsonFsStore` remains as read-only fallback: if `SqliteStore` fails to open `store.db`, fall back to `JsonFsStore` + warn.

**Test**: migration test with a fixture JSON store; assert `SqliteStore` reads back identical data. Concurrent-write test: trigger a write during migration, assert it lands in the DB.

**Rollback**: user downgrades to pre-P2.2 extension → reads JSON files (still present) → continues working. The `store.db` is ignored by old code.

### P2.3 — Switch extension to `SqliteStore` by default

**Status**: landed. `SqliteStore` is the single-machine default; `JsonFsStore`
remains as the migration source and the corrupt-DB fallback.

**Scope**

- `extension/src/extension.ts` `activate()`: eagerly fires `getStore()` so the
  DB opens + JSON→SQLite migration runs at startup (first command does not pay
  the cost). Logs the bootstrap result via `mindMapLog`.
- MCP server (`mcp-server/src/index.ts` `main()`): `await bootstrapStore(storeDir)`
  → `createMcpHandlerContext(bootstrap.store, storeDir)`. Warnings go to stderr
  (MCP stdio reserves stdout for protocol traffic).
- `getStore()` is now `async` and memoizes `bootstrapStore(getStoreDir())`
  keyed on the dir string; `getStoreForDir(storeDir)` is the captured-at-enqueue
  variant for `codeRefQueue` (user may change `projectsDir` between enqueue and
  process).
- ALL extension store writes route through the `Store` interface (D1 widened it
  with 14 methods; D4 added them to `JsonFsStore`, D5 to `SqliteStore`, D6
  extended `migrateJsonToSqlite` to import the deterministic/llm-refined/llm-cache
  merges). Specifically: session upserts, concept-trie / deterministic /
  llm-refined / llm-cache merge writes, ontology index + record writes, project
  record deletion, and ontology cache clearing.
- Corresponding reads (P1.3 left some raw) route through `Store` too: cross-
  project `listAllRecords`, deterministic/llm-refined/llm-cache merge reads,
  ontology index + record reads.
- `ConceptOntologyRecord` (full type with nodes/mappings/topicPaths/reattach\*)
  moved from `extension/src/store/ontologyTypes.ts` to
  `shared/src/storeTypes.ts` (replacing the lite `OntologyRecord`). The
  extension file re-exports the shared type under the old names so existing
  import paths keep working.
- `bootstrapStore()` now `mkdir -p storeDir` before opening `store.db` —
  `@vscode/sqlite3` returns `SQLITE_CANTOPEN` if the parent dir is missing.

**Behavior shifts to note**

- `autoRefreshOnAnalyze` flag is now mostly redundant: `SqliteStore.upsertRecord`
  bumps revision in-transaction on every write, so per-write MCP-cache
  invalidation happens regardless. The flag still gates the explicit
  post-batch `refreshMcpIndexForProject` call; keep it for now, retire in a
  follow-up once SQLite bump-on-write is validated in the field.
- `index.json` (`readIndex`/`rebuildIndex`) is dead extension-local state and
  is no longer written. `readIndex` had zero callers; `rebuildIndex`'s output
  was read by neither `SqliteStore` nor the MCP server. Both functions stay
  defined in `sessionStore.ts` (P2.5 deletes them with `JsonFsStore`).
- `clearProjectAnalysisCache` deletes SQLite rows + `deleteSnapshotHierarchy`
  - `Store.clearOntologyCache()`. Pre-P2.3 it unlinked on-disk JSON files; the
    JSON unlink is now redundant (migration leaves them stale; P2.4 deletes
    them) but kept as belt-and-suspenders for downgrade-safety windows.
- On-disk JSON files go stale immediately after the first post-migration
  write. P2.4 deletes them later. Downgrade safety holds as long as the JSON
  files remain on disk (P2.4 is the no-downgrade commit point).

**Out of scope (follow-up PRs)**

- Merge-snapshot subsystem port (`mergeSnapshot.ts`:
  `writeMergeSnapshot`/`readMergeSnapshot`/manifests/`deleteSnapshotHierarchy`)
  → SQLite. Self-contained per-project FS blobs today; never read through
  `Store`. A proper port needs snapshot-table or kv-schema design and warrants
  its own PR. `clearProjectAnalysisCache` keeps calling `deleteSnapshotHierarchy`
  directly.
- `test/store/storeContract.test.ts` (parameterized contract over `JsonFsStore`
  - `SqliteStore` for all 14+ methods) and `test/store/bootstrapDefault.test.ts`
    (seed legacy JSON → bootstrap → assert `kind === "sqlite-migrated"` + writes
    land in `store.db` not JSON). The per-impl suites
    (`jsonFsStore.test.ts`, `sqliteStore.test.ts`, `migrateJsonToSqlite.test.ts`,
    `storeBootstrap.test.ts`, `extensionStoreRouting.test.ts`) cover the same
    behavior; the contract suite is a nice-to-have, not a blocker.

**Test**: all 478 vitest tests green. Manual smoke (Extension Development Host):
fresh test project → Analyze All Sessions → confirm `store.db` is created and
no new `sessions/<slug>/<id>.json` is written; pre-existing JSON store → first
activation runs migration (Output panel log shows `sqlite-migrated`) →
subsequent reads come from SQLite; MCP `search_project_history` returns
results from SQLite (verify by deleting a JSON file post-migration and
confirming the MCP search still finds the session);
`clearProjectAnalysisCache` command deletes SQLite rows.

**Rollback**: clean revert in three phases (C: `extension.ts` +
`mcp-server/index.ts` go back to `new JsonFsStore(storeDir)`; B: call sites go
back to raw `writeRecord`/`writeMergeRecord`/`readOntology*`; A: `Store`
interface shrinks, `JsonFsStore`/`SqliteStore` lose the new methods,
`ConceptOntologyRecord` moves back to extension). On-disk: `store.db` from the
P2.3 period is ignored by reverted code; JSON files are stale but present. No
data migration needed. P1.x stays intact.

### P2.4 — Deprecate `JsonFsStore` write path

**Scope** (ships one release after P2.3 is confirmed stable)

- Remove the read-only fallback to `JsonFsStore` from `extension.ts`.
- Remove `migrateJsonToSqlite.ts` (migration window closed).
- Delete original JSON files on first launch of this version (after confirming `store.db` is healthy). ❓ Or keep deletion manual via a command — recommend automatic with a one-time backup-to-zip for safety.
- `JsonFsStore` class stays in tree for one more release (tests still use it as a reference impl), then removed in P2.5.

**Test**: fresh-install test (no JSON, no DB → empty `SqliteStore`); upgrade test (JSON present → migrated in P2.2, now JSON deleted).

**Rollback**: this is the commit point. After this, downgrade to pre-SQLite is no longer supported. Ship only after P2.3 has been in a release with no migration bug reports.

### P2.5 — Remove `JsonFsStore`

**Scope**

- Delete `jsonFsStore.ts`, `storeReader.ts`, `mcpIndex.ts` raw functions, `atomicWrite.ts` (now unused — SQLite handles atomicity).
- Tests that used `JsonFsStore` as a reference switch to `SqliteStore` only, or to an in-memory `MemoryStore` test double.

**Test**: all tests green; bundle size drops.

**Rollback**: revert (but P2.4 already committed users to SQLite, so rollback only helps if caught before release).

**End of phase 2**: single-machine mode runs on SQLite. Schema is ready for the Postgres backend to mirror.

---

## Phase 3 — Team HTTP service (Go)

Goal: a standalone Go service with Postgres storage and the REST API. No MCP, no extension wiring yet. Testable via curl. The service is thin — storage and CRUD only; all search/render/eval stays on the TypeScript client.

### P3.1 — Go module, Postgres schema, storage layer

**Scope**

- **New separate repository** `agent-mindmap-team-service` (sibling to the `agent-mindmap` extension repo, not a subdirectory of it). Go module `github.com/agent-mindmap/agent-mindmap-team-service` (`agent-mindmap-team-service/go.mod`). Initialize its own git repo; version and release independently from the extension.
- Layout: `cmd/server/main.go`, `internal/storage/` (Postgres access), `internal/api/` (HTTP handlers), `internal/worker/` (P5 merge worker), `internal/config/`, `migrations/` (SQL files).
- `internal/storage/postgres.go` — `pgx`-backed (`database/sql` + `pgxstdlib`) storage layer. Schema mirrors the SQLite schema adapted to Postgres types: `projects(project_slug TEXT PK, project_path TEXT, revision BIGINT, record_count BIGINT, last_analyzed_at BIGINT, last_built_at BIGINT)`, `sessions(project_slug TEXT, session_id TEXT, transcript_sha256 TEXT, analyzed_at BIGINT, record_json JSONB, PK(project_slug, session_id))`, `kv(key TEXT PK, value_json JSONB, updated_at BIGINT)`.
- Migrations via `golang-migrate` (or hand-rolled SQL files under `migrations/` applied at boot with `CREATE TABLE IF NOT EXISTS`).
- `BumpProjectRevision` uses `INSERT ... ON CONFLICT (project_slug) DO UPDATE SET revision = projects.revision + 1 RETURNING revision` — no application-level lock.
- Go unit tests in `agent-mindmap-team-service/internal/storage/postgres_test.go` run against a test Postgres instance (`docker-compose.yml` under `agent-mindmap-team-service/`).

**Not in scope**: HTTP endpoints, auth, merge worker.

**Test**: `go test ./internal/storage/...` passes against a test DB; CRUD on `sessions` and `projects` works; `BumpProjectRevision` is monotonic under concurrent goroutines.

**Rollback**: service not deployed yet; revert is trivial.

### P3.2 — REST API endpoints (Go)

**Scope**

- `agent-mindmap-team-service/internal/api/` — implement the endpoints from `TEAM_MODE.md` §HTTP API using `net/http` (or `chi` router — ❓ recommend `chi` for middleware ergonomics, stdlib-compatible):
  - `GET /v1/projects`
  - `GET /v1/projects/:slug/revision`
  - `GET /v1/projects/:slug/sessions` (paged)
  - `GET /v1/projects/:slug/sessions/:id`
  - `POST /v1/projects/:slug/sessions/:id` (upsert, LWW on `analyzedAt`)
  - `GET /v1/merges/concept-trie`
  - `GET /v1/merges/concept-trie/revision`
  - `GET /v1/projects/:slug/equivalences`
- All handlers delegate to the storage layer. The Go service treats `record_json` as opaque JSON — it does not parse `SessionRecord` internals.
- Integration tests in `agent-mindmap-team-service/internal/api/routes_test.go` — full HTTP request/response against a test DB using `httptest`.

**Not in scope**: auth middleware (next PR), merge worker (phase 5).

**Test**: route tests pass; `PUT` upsert semantics verified (LWW, no 409).

**Rollback**: service not deployed; revert.

### P3.3 — Auth middleware (Go)

**Scope**

- `agent-mindmap-team-service/internal/api/middleware.go` — Bearer token check on every request (decision 5: reads and writes both require key). Constant-time compare via `crypto/subtle`.
- Server configured with one or more valid API keys via env var `AGENT_MINDMAP_API_KEYS` (comma-separated). v2: key-per-user with a `keys` table; v1 shared key only.
- 401 on missing/invalid token. No anonymous read surface.
- Tests: requests without token → 401; with valid token → 200; with wrong token → 401.

**Test**: auth tests pass.

**Rollback**: revert middleware; endpoints open (only acceptable pre-deployment).

### P3.4 — Service packaging and deploy docs

**Scope**

- `agent-mindmap-team-service/Dockerfile` (multi-stage: `golang:1.22` build → `gcr.io/distroless/static` runtime), `agent-mindmap-team-service/docker-compose.yml` (Postgres + service), `agent-mindmap-team-service/README.md` with deploy instructions.
- Health check endpoint `GET /v1/health` (no auth — returns 200 if DB reachable).
- Structured logging via `log/slog` (stdlib, Go 1.21+).
- ❓ Rate limiting — recommend a simple per-key token-bucket in `internal/api/middleware.go`. Out of scope for v1 if deploy is internal-only; add if exposed beyond LAN.

**Test**: `docker compose up` boots service + Postgres; curl health check returns 200; curl to `/v1/projects` without token returns 401.

**Rollback**: service not yet used by clients; revert or just don't deploy.

**End of phase 3**: Go team service exists, deployable, testable via curl. No clients connected yet.

---

## Phase 4 — Extension wiring for team mode

Goal: a user can set `agentMindmap.team.serverUrl` + apiKey and have their extension talk to the team service.

### P4.1 — `RemoteStore` client

**Scope**

- `shared/src/store/remoteStore.ts` — `RemoteStore implements Store`, calls the REST API via `fetch`. Keeps the in-process `McpSearchIndexCache` (LRU, from the earlier MCP work) and validates against `GET …/revision` before use, mirroring `ensureProjectIndex`'s current logic.
- Bearer token from constructor arg (extension passes the key from SecretStorage).
- Retry with exponential backoff on 5xx/network errors; no retry on 4xx.
- Tests in `test/store/remoteStore.test.ts` — mock `fetch` (or `msw`) to simulate the API; verify cache validation, retry, upsert.

**Not in scope**: extension config wiring, push queue.

**Test**: `remoteStore.test.ts` passes.

**Rollback**: revert; `RemoteStore` unused.

### P4.2 — Team config and store selection

**Scope**

- New VS Code settings: `agentMindmap.team.serverUrl` (string, empty = single-machine), `agentMindmap.team.apiKey` (stored in SecretStorage, not settings.json).
- `extension/src/store/storeFactory.ts` — at activation, read config; if `serverUrl` set, construct `RemoteStore(serverUrl, apiKey)`; else construct `SqliteStore` (after P2.3) / `JsonFsStore` (before P2.3).
- Command: "Agent Mind Map: Configure Team Service" — prompts for URL + key, stores key in SecretStorage, writes URL to settings.
- Update `package.json` settings schema.

**Test**: unit test `storeFactory` with each config combination; integration test that setting `serverUrl` switches the active store.

**Rollback**: revert; team config ignored, `SqliteStore`/`JsonFsStore` used.

### P4.3 — Push queue (local → team)

**Scope**

- `extension/src/store/pushQueue.ts` — after each local `upsertRecord` (pipeline writes a session), if team mode is active, enqueue a `POST /sessions/:id` to the team service.
- `lastPushedWatermark` stored in `kv` (local SQLite) — the `analyzedAt` of the most recently pushed session per project.
- Drain logic: on activation and after each local write, push any sessions with `analyzedAt > watermark`. Idempotent (`PUT` is upsert).
- Failure: retry with backoff; never block local analysis on push success. Queue persists across restarts (stored in SQLite `kv`).
- ❓ Backoff upper bound — recommend 5 min max, then give up and log (user can manually trigger "Sync now").

**Test**: push-queue tests with mocked `RemoteStore`; verify watermark advances only on success; verify restart resumes queue.

**Rollback**: revert; team mode reads work (P4.1/P4.2) but no pushes. User's local analysis unaffected.

### P4.4 — Bulk push on first team-mode activation

**Scope**

- When `serverUrl` is first set (transition from single-machine to team), run a one-shot bulk push: iterate all local sessions, `PUT` each. Per `TEAM_MODE.md` §Migration 2.
- Progress UI (VS Code progress notification) since this can take a while for large stores.
- After bulk push completes, the incremental push queue (P4.3) takes over.
- Local `SqliteStore` is kept as working copy — not deleted.

**Test**: bulk-push test with a fixture local store + mocked team service; verify all sessions arrive; verify local DB intact.

**Rollback**: revert; user can still use team mode in read-only fashion (P4.1/P4.2) until they re-trigger bulk push manually.

**End of phase 4**: team mode is usable end-to-end. A user can configure the team service, push their history, and query the shared knowledge base via MCP.

---

## Phase 5 — Merge worker and cross-session concepts (Go)

Goal: the concept trie and ontology equivalences work in team mode (currently single-machine only). The Go merge worker re-implements the existing TypeScript trie-merge algorithm; the REST contract is the only coupling between the Go worker and the TypeScript client.

### P5.1 — Go merge worker (cron)

**Scope**

- `agent-mindmap-team-service/internal/worker/merge_worker.go` — periodic Go job that recomputes the concept trie from all `sessions.record_json` for a project, writes the result to `kv` (key `concept-trie`). Per decision 7: cron on fixed interval + on project revision change.
- Re-implements the existing TypeScript trie-merge algorithm (currently in `shared/src/` + `extension/src/store/`). The algorithm is deterministic; the Go port carries its own tests under `agent-mindmap-team-service/internal/worker/` using the same fixture inputs to assert byte-equivalent output to the TypeScript version.
- Trigger: Go `time.Ticker` (every N minutes) + a `projects.revision` polling check. ❓ Interval — recommend 10 min default, configurable via env `AGENT_MINDMAP_WORKER_INTERVAL`.
- Writes new trie + bumps a `concept-trie-revision` in `kv` so clients can poll `GET /v1/merges/concept-trie/revision` cheaply.

**Test**: worker test — seed sessions, run worker, verify trie in `kv`; verify revision bumped. Fixture-parity test against TypeScript output for the same input records.

**Rollback**: revert; trie endpoint returns stale or empty data. Reads still work; cross-session concepts unavailable until re-deployed.

### P5.2 — Equivalences endpoint

**Scope**

- `GET /v1/projects/:slug/equivalences` — already stubbed in P3.2; wire to actual ontology data produced by the merge worker.
- The worker also produces per-project segment equivalences; store in `kv` keyed by project.

**Test**: endpoint returns equivalences matching the worker output.

**Rollback**: endpoint returns empty; MCP concept detail still works without equivalences.

### P5.3 — Client polls trie revision

**Scope**

- `RemoteStore.readConceptTrieMerge` checks `GET /v1/merges/concept-trie/revision` first; if unchanged from cached, return cached. Else fetch full trie.
- Same pattern as `ensureProjectIndex`'s revision check.

**Test**: mock revision unchanged → no full fetch; revision changed → full fetch.

**Rollback**: revert; client fetches full trie every call (slower, correct).

**End of phase 5**: cross-session concept map works in team mode.

---

## Phase 6 — Hardening (Go service)

Goal: production-ready for teams beyond the first internal deployment.

### P6.1 — Observability

**Scope**

- Structured request logs (via `log/slog`) with `request_id`, `project_slug`, `actor` (key id), latency.
- Metrics endpoint (`GET /v1/metrics`, Prometheus format via `prometheus/client_golang`) — request count, error rate, push-queue depth, worker run time.
- ❓ Dashboard — recommend a Grafana JSON in `agent-mindmap-team-service/grafana/` for the deploy docs, not a hosted dashboard.

**Test**: metrics endpoint returns expected counters after seeded requests.

### P6.2 — Rate limiting and abuse protection

**Scope**

- Per-key token-bucket rate limit (e.g. 600 req/min, burst 50) in `agent-mindmap-team-service/internal/api/middleware.go` (or `golang.org/x/time/rate`).
- Per-project POST concurrency guard: if one client is pushing 10k sessions, don't starve others. ❓ Recommend a simple per-key fair queue, not per-project.

**Test**: rate-limit test — exceed limit → 429.

### P6.3 — Backup and restore docs

**Scope**

- `agent-mindmap-team-service/docs/backup.md` — `pg_dump` cron, restore procedure, point-in-time recovery via Postgres WAL if enabled.
- ❓ Managed Postgres (RDS, Cloud SQL) guidance — add if a team asks for it.

**Test**: docs review; dry-run backup/restore in docker-compose.

### P6.4 — Audit logging (if requested)

**Scope** (only if a real team asks for it; otherwise skip)

- Append-only `session_history` table — `session_id, project_slug, actor, analyzed_at, pipeline_version, record_json_snapshot, written_at`.
- `POST /sessions/:id` writes to both `sessions` (LWW) and `session_history` (append).
- `GET /v1/projects/:slug/sessions/:id/history` endpoint.
- Per decision 6, this is opt-in and does not change the main read path.

**Test**: history accumulates on repeated PUTs; history endpoint returns chronological entries.

**End of phase 6**: Go service is production-ready.

---

## Cross-cutting concerns

### Test strategy

- **Shared `Store` contract test**: one test suite (`test/store/storeContract.test.ts`) that runs against any TypeScript `Store` impl. Each impl (`JsonFsStore`, `SqliteStore`, `RemoteStore`) includes a thin adapter and runs the contract suite. The Go `PostgresStore` is not a TypeScript `Store`; its contract is enforced by Go tests under `agent-mindmap-team-service/` that assert the same behavior, plus a cross-language fixture-parity check for the trie-merge algorithm in P5.1.
- **Migration tests**: JSON→SQLite (P2.2) and bulk-push (P4.4) tested with fixture stores.
- **No integration tests that require a real team service in CI** until phase 6 — `RemoteStore` tests mock the HTTP layer; Go route tests use `httptest` against a test DB.

### Branch / release strategy

- Phases 1–2 land on `main` and ship in normal extension releases. Users see SQLite migration (P2.2/P2.3) as a versioned upgrade.
- Phases 3–6 develop on `main` but are feature-gated by `agentMindmap.team.serverUrl` being unset. No user sees team mode until they configure it.
- The `agent-mindmap-team-service/` Go module is versioned independently (Git tag `agent-mindmap-team-service/v0.x.y`) and deployed separately from the extension. Its releases do not bump the extension version.

### Open questions to resolve mid-flight

These don't block the plan but need answers when the relevant PR is in flight:

- **P2.1**: `better-sqlite3` vs `node:sqlite` (Node version compatibility in VS Code).
- **P3.1**: `chi` router vs stdlib `net/http` (recommend `chi` for middleware ergonomics).
- **P3.4**: Rate limiting in v1 or defer to P6.2 (recommend defer if internal-only).
- **P4.3**: Push-queue backoff upper bound (recommend 5 min).
- **P5.1**: Worker interval default (recommend 10 min).
- **P6.1**: Grafana dashboard in tree or hosted (recommend in tree).
- **Q4**: fully resolved 2026-06-21 (all 6 sub-questions closed; see `TEAM_MODE.md` §Q4 Decided design). Resolved decisions: `markCode` size + source — raw `Write.contents` / `StrReplace.new_string` captured before the prompt's whitespace-collapse + 300-char truncation, capped at 2000 chars with complete-line truncation, codeRef LLM prompt unchanged, no `PIPELINE_VERSION` bump for the prompt's sake; snippet-match normalization — `markCode` stored as `string[]` of effective lines, per-line substring match, no global normalization, lines < 3 chars or with no letter/digit discarded; verification timing — on-read, `staleness` is a response-time derived field, not persisted to store, no sweep/migration; local-clone-absent — three-state `fresh`/`stale`/`unknown`, path-resolves+file-missing→stale, slug-missing/empty-markCode→unknown; SearchHit surfacing — stale/unknown hits always surface as `kind: "code"` with `staleness` tag, never filtered/demoted, staleness computed/back-filled by MCP server in both modes, team service returns hits without `staleness`; back-fill — not needed, not yet shipped, missing `markCode` → `unknown` naturally.

### Dependency graph

```
P1.1 → P1.2 → P1.3 → P1.4
                          ↓
                    P2.1 → P2.2 → P2.3 → (release) → P2.4 → P2.5
                                              ↓
                                         P2.6 → P2.7 → P2.8
                                                    ↓
                                                    Q4 (after Q4 sub-questions resolve)
                                                    ↓
                                         P3.1 → P3.2 → P3.3 → P3.4
                                                                       ↓
                                                                  P4.1 → P4.2 → P4.3 → P4.4
                                                                                              ↓
                                                                                         P5.1 → P5.2 → P5.3
                                                                                                                      ↓
                                                                                                                 P5.4 → P5.5 → P5.6
                                                                                                                                ↓
                                                                                                                           P6.1, P6.2, P6.3, P6.4

Q1 (codeRef retrieval)  ──┐  (independent, lands before P2.1)
Q2 (tool descriptions)   ──┘  (independent, lands anytime)
```

P2.4 (deprecate JSON write path) and P2.5 (remove `JsonFsStore`) can land after P3.x starts — they're independent of the service work. P5 and P6 require P4 complete (clients connected) to be meaningful, but P5.1 (worker) can start in parallel with P4 since it only depends on P3.

**Q5 (project mode) ordering rationale**: P2.6 (slug derivation) → P2.7 (paths.json map) → P2.8 (re-key). P2.6 must land before P2.7 because the map is derived from slugs. P2.7 must land before P2.8 because re-key needs the repo-slug → path mapping to validate targets. P2.8 must land before P3/P4 because team mode implies repo mode and the team-enable prompt triggers re-key. Q4 lands after P2.7 (its MCP-server file-read needs the paths map).

**Q1 / Q2 / Q3 placement notes**:

- **Q1 (codeRef retrieval signal)**: standalone PR, no phase dependency. Touches `shared/src/searchIndex.ts` + `SearchHit` type + `retrievalEval.ts`. Recommended to land before P2.1 so the SQLite migration and later Go port (P5.4) pick up the codeRef retrieval branch from the start. Q1 is a prerequisite of P5.4: the Go token-scorer port must include the `"code"` hit kind, the `MAX_HITS_PER_CODE` cap, and the reverse concept boost — otherwise the Go port diverges from the TypeScript reference and fixture-parity tests fail.
- **Q2 (tool descriptions)**: standalone PR, no phase dependency, no code dependency on Q1 or Q3. Lands anytime; recommended before the MCP server's first real release.
- **Q3 (embedding hybrid retrieval)**: lands as P5.4 → P5.5 → P5.6, after P5.1 (merge worker exists, embedding worker runs alongside it). P5.4 depends on Q1 being landed (the Go token-scorer port must mirror the TypeScript scorer _including_ Q1's codeRef branch — fixture-parity tests assert identical output, so Q1 must be in the TypeScript reference first). P5.4 also depends on P3.2 (REST API exists, so the new `/search` endpoint has a router to plug into). P5.5 and P5.6 depend on P5.4.

### Q5 — Project mode (workspace/repo) + repo-URI slugs + re-key

**Placement decision**: Q5 spans the extension + MCP server and is **independent of the team-mode phases** (P3–P6) — it ships value in single-machine mode (stable slugs across directory renames; Q4 staleness needs repo-relative paths). It lands as a sub-series `P2.6 → P2.7 → P2.8` after P2.3 (SQLite store is the foundation the re-key migration writes to) and before P3 (team mode consumes repo slugs). Design finalized in `TEAM_MODE.md` §Q5. Q4 (CodeReference `markCode` + staleness) depends on Q5: Q4's MCP-server file-read needs the repo-slug → local-clone mapping from P2.7, so Q4 lands after P2.7.

Why this placement exposes implementation-order issues:

- **P2.6 (mode setting + slug derivation) before P2.7 (paths.json)**: the slug derivation is the source of truth; the paths map is derived from it. Building the map first would require mocking slugs.
- **P2.7 (paths.json) before P2.8 (re-key)**: re-key rewrites `projectSlug` primary keys in the SQLite store and needs the repo-slug → path mapping to validate that each re-keyed folder has a resolvable target. Re-key also needs the hard-error prerequisite check (rule 10), which lives in P2.6's slug-derivation module.
- **P2.8 (re-key) before P3 (team mode)**: team mode implies repo mode (rule 3) and the team-enable guidance prompt triggers re-key. If re-key doesn't exist, team enablement can't offer the switch.
- **Q4 after P2.7**: Q4's MCP-server staleness verification reads `repo-paths.json` / `workspace-paths.json` (written by P2.7) to resolve `CodeReference.path` against the local clone. Without the map, Q4 can't locate files.

**P2.6 — `agentMindmap.project.mode` setting + slug derivation + prerequisite hard-error**

**Scope**

- New VS Code setting `agentMindmap.project.mode` (`"workspace"` default | `"repo"`), added to `extension/package.json` settings schema.
- `extension/src/host/slugDerivation.ts` (new): a unified `deriveProjectSlug(workspaceFolder, mode): { slug, root, error }` function. `workspace` branch: current `workspaceToSlug`/`path.basename` behavior. `repo` branch: run `git -C <folder> config --get remote.origin.url` + `git -C <folder> rev-parse --show-toplevel`; if both succeed AND `show-toplevel` == folder path → normalize URI to slug (rule 2, `normalizeRepoUriToSlug` helper); else return an `error` describing the failure (非 git 仓库 / 无 origin / 非 repo 根 / git 不可用).
- `normalizeRepoUriToSlug(uri: string): string` — strip scheme, host:port, `user@` scp prefix; keep `org/repo.git` with trailing `.git`. Unit tests covering the 4 worked examples in rule 2 + edge cases (no `.git`, trailing slash, port-only host).
- Replace the existing slug derivation call sites (`cursorHost.ts:53`, `claudeHost.ts:131`, `paths.ts`) to route through `deriveProjectSlug` with the configured mode. **Backward-compat**: when mode = `workspace` (default), behavior is byte-identical to today — no existing user's slug changes.
- **Hard-error enforcement (rule 10)**: at activation and on `onDidChangeWorkspaceFolders`, if mode = `repo` and ANY folder returns an error from `deriveProjectSlug`, surface a VS Code error notification naming failing folders + reasons; do NOT analyze sessions / write to store / push for those folders. The `agentMindmap.project.mode` setting is not rewritten. Existing sessions in the store remain renderable from `record_json`. Git binary unavailable (`git --version` fails) → every folder errors, same notification.
- Unit tests: `slugDerivation.test.ts` covering workspace branch (parity with current), repo branch (all 4 normalization examples), and every error case (non-git, no origin, not repo root, git missing). Activation test: repo mode + one failing folder → error notification fires, no analysis.

**Not in scope**: `repo-paths.json` / `workspace-paths.json` map files (P2.7); re-key migration (P2.8); MCP server changes (P2.7).

**Test**: `slugDerivation.test.ts` + activation hard-error test pass; existing host tests unchanged (workspace mode parity).

**Rollback**: revert; slug derivation returns to path-based. `agentMindmap.project.mode` setting ignored. No on-disk change.

**P2.7 — `paths.json` map files + MCP server path resolution**

**Scope**

- `extension/src/store/pathsMap.ts` (new): writes `~/.agent-mindmap/workspace-paths.json` (`{workspaceSlug → folderPath}`) and `~/.agent-mindmap/repo-paths.json` (`{repoSlug → folderPath}`) at activation and on `onDidChangeWorkspaceFolders`. Workspace map: one entry per workspace folder, slug from `deriveProjectSlug(mode=workspace)`. Repo map: one entry per workspace folder that passes repo prerequisites, slug from `deriveProjectSlug(mode=repo)`; first-seen wins on slug collision (rule 9), losers logged at info. Atomic write via `writeJsonAtomic`.
- Manual refresh command `agentMindmap.refreshRepoPaths` ("Agent Mind Map: Refresh Repo Paths") rewrites both maps on demand.
- `mcp-server/src/handlers.ts` + `mcp-server/src/pathsMap.ts` (new): on startup, load the relevant map (based on a mode hint passed from the extension, or probe both) into memory. **On every slug-lookup miss, re-read the map file from disk and retry** (rule 8). If re-read still misses → signal the extension to surface a VS Code notification naming the missing slug + suggesting Refresh Repo Paths (repo mode) or checking workspace folder (workspace mode). No `fs.watch`.
- Mode propagation: extension writes `~/.agent-mindmap/mcp-mode.json` (`{"mode":"repo"|"workspace"}`) alongside the existing `mcp-locale.json` (Q2 pattern) so the MCP server knows which map to read. Missing file → assume `workspace` (backward-compat).

**Not in scope**: Q4 staleness verification (the file-read + snippet-match — that's Q4, lands after P2.7); re-key (P2.8).

**Test**: `pathsMap.test.ts` — workspace map correctness, repo map with first-seen tie-break, atomic write, refresh command rewrites. MCP server test: slug hit → cached; slug miss → re-read → hit; slug miss → re-read → miss → notification signaled.

**Rollback**: revert; maps not written, MCP server falls back to current path-resolution (none — Q4 not yet landed, so no behavior change visible).

**P2.8 — One-way re-key migration (workspace → repo)**

**Scope**

- `extension/src/store/rekeyMigration.ts` (new): triggered when `project.mode` switches `workspace → repo` (manually via setting change, or via the team-enable guidance prompt in P4.2). Steps per rule 11:
  1. Run prerequisite check (rule 10) — if any folder fails, abort re-key with the hard-error notification (re-key doesn't start; no backup written).
  2. Backup `store.db` → `store.db.pre-rekey-<timestamp>` (overwrite previous backup). Backup failure → abort.
  3. For each workspace folder (one SQLite transaction per folder): rewrite `SessionRecord` primary key `(projectSlug, sessionId)` from workspace slug to repo slug. **`CodeReference.path` NOT rewritten** (folder == repo root ⇒ bases identical). Idempotent: folder with no sessions under old slug = no-op.
  4. Progress notification per folder + summary ("已迁移 N 个工作区").
- After re-key, mark the store as re-keyed (a `kv` flag `rekeyed-to-repo`); `workspace` mode is no longer offered for that store (rule 5, one-way). Setting `agentMindmap.project.mode` back to `workspace` on a re-keyed store surfaces a warning ("此 store 已迁移到仓库模式，无法回退到工作区模式") and is refused.
- `SqliteStore` gains a `rekeyProjectSlug(oldSlug, newSlug, sessionIds?)` method (transactional PK rewrite). The `sessions` table PK is `(project_slug, session_id)`, so rewriting means INSERT new row + DELETE old row within the transaction (SQLite doesn't support ALTER on PK directly).
- Interruption recovery: per-folder transactions guarantee folder-internal consistency; re-running re-key completes remaining folders (idempotent).

**Not in scope**: team-mode bulk push (that's P4.4, re-keys on the server side); the team-enable guidance prompt itself (P4.2).

**Test**: `rekeyMigration.test.ts` — per-folder transaction rollback on injected failure; backup correctness + backup-failure abort; path byte-identical before/after; prerequisite-gate (failing folder → re-key doesn't start); idempotency (run twice = no-op); interruption recovery (interrupt after folder A, re-run, folder B completes). One-way enforcement: re-keyed store refuses `workspace` mode.

**Rollback**: revert; re-key command not registered. A store that was re-keyed under this PR and then downgraded would have repo-slugged records that the downgraded (pre-P2.8) code reads fine (it doesn't care about slug shape) — but `workspace` mode would treat them as workspace slugs, which is incorrect. Mitigation: the `store.db.pre-rekey-<ts>` backup is the recovery path; document that downgrade after re-key requires restoring the backup.

**Q4 — CodeReference `markCode` + staleness (lands after P2.7)**

**Placement**: Q4 depends on P2.7 (MCP server path resolution via `paths.json`). All Q4 sub-questions resolved 2026-06-21 (see `TEAM_MODE.md` §Q4 Decided design). Q4 is implemented as a single PR (per effort table) covering: schema change, capture-site change, MCP-server on-read staleness computation, and `SearchHit.staleness` back-fill.

**Scope (single PR)**:

1. **Schema** (`shared/src/llmTypes.ts`): add `markCode: string[]` to `CodeReference` (array of effective lines, see Decided design item 6). Do NOT add `staleness` to the stored `CodeReference` — it is a response-time derived field. Add `staleness?: "fresh" | "stale" | "unknown"` to the MCP-server response shapes that carry `CodeReference` (`get_session_outline` response, `SearchHit` when `kind === "code"`). The team service's `SearchHit` schema does NOT include `staleness` — the MCP server's response schema is the superset.
2. **Capture site** (`extension/src/llm/extractCodeReferences.ts`): in `buildWriteInfoMap` (or alongside), capture the raw `Write.contents` / `StrReplace.new_string` **before** the existing `snippet.replace(/\s+/g, " ").slice(0, 300)` collapse. Apply the 2000-char cap with complete-line truncation, split on newlines, trim each line, discard ineffective lines (empty / length < 3 / no Unicode letter or digit), store the resulting array as `markCode`. The LLM prompt is unchanged.
3. **MCP server** (`mcp-server/src/handlers.ts`): add a file-read + per-line-substring-match capability. In `get_session_outline` and `search_project_history` (and any other handler returning `CodeReference`s), compute `staleness` inline per the three-state rule (Q4.3): read `workspace-paths.json` / `repo-paths.json` (read-on-miss, from P2.7) → resolve `CodeReference.path` → stat + read file → per-line substring match → `fresh` / `stale` / `unknown`. Apply in-response same-path dedup (one file read per distinct path per response). In team mode, the MCP server receives `SearchHit`s from the team service without `staleness` and back-fills it before returning to the caller.
4. **Frontend** (webview): render `staleness !== "fresh"` code refs with a warning marker (strikethrough / color). On click, do NOT auto-jump to the file if `staleness !== "fresh"` — surface a notice instead (or offer best-effort jump).
5. **No `PIPELINE_VERSION` bump, no migration, no back-fill command** (per Q4.5 + Q4.6 resolved decisions).

**Rollback**: revert; `markCode` field absent on new analyses, staleness feature absent. Existing `CodeReference`s render without staleness (as today). No store-schema migration was added, so nothing to undo on the store side.

### Estimated effort

Rough, for planning not commitment:

| Phase | PRs | Effort                                                                                                                                                                                               |
| ----- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | 4   | Small — pure refactor, mechanics                                                                                                                                                                     |
| 2     | 5   | Medium — SQLite migration is the risky part                                                                                                                                                          |
| 3     | 4   | Medium — new Go service, no `shared/` reuse; storage + REST + auth                                                                                                                                   |
| 4     | 4   | Medium — push queue and bulk migration are fiddly                                                                                                                                                    |
| 5     | 6   | Medium-large — trie-merge port (P5.1-3) + search/embedding port (P5.4-6), both cross-language with fixture-parity tests                                                                              |
| 6     | 4   | Small-to-medium — depends on which PRs are needed                                                                                                                                                    |
| Q1    | 1   | Small — retrieval-layer change in `searchIndex.ts`, no schema bump                                                                                                                                   |
| Q2    | 1   | Small — copy + locale file, no logic change                                                                                                                                                          |
| Q4    | 1   | Medium — `CodeReference.markCode` schema (sourced from raw transcript write-ops, no LLM prompt change) + MCP-server file-read/staleness; PR breakdown finalized after its open sub-questions resolve |
| Q5    | 3   | Medium — P2.6 (slug derivation + hard-error) + P2.7 (paths.json + MCP path resolution) + P2.8 (re-key migration)                                                                                     |

---

## Open design questions (pending placement)

Companion to `TEAM_MODE.md` §Open design questions. These three MCP-server improvements are recorded but **not yet placed** in the phase plan above. Each needs a decision before it can be slotted into a PR. The candidate placements below are starting points for discussion, not commitments.

### Q1 — Use `codeReferences` as a retrieval signal

**Placement decision**: standalone PR, no phase dependency. Lands before phase 2 (independent of team mode, applies to single-machine today). Design is finalized in `TEAM_MODE.md` §Q1.

Scope:

- `shared/src/searchIndex.ts` only:
  - `buildRecordTokenSets`: append `codeReferences[].description` (ngram tokens) + split `path` into whole-word tokens.
  - `searchProjectRecords`: add a `"code"` scoring branch producing `SearchHit` with `kind: "code"`, `path`, `lines`, `description`, `sourceTurnIndices`.
  - Reverse concept boost: codeRef hit → `sourceTurnIndices` → outline details (same turn) → `conceptPath` → matching concept hit gets `codeRefScore * 0.3 / linkedConceptCount`.
  - `diversifyHits`: add `MAX_HITS_PER_CODE = 2` independent cap.
  - `SearchHit` type (in `storeTypes.ts`) gains optional `path`, `lines`, `description` fields for the `"code"` kind.
- `shared/src/retrievalEval.ts`: two new cases (semantic-complement + filename-fragment).
- No `SessionRecord` schema change, no `PIPELINE_VERSION` bump, no re-analysis. Pure retrieval-layer change.

**Tuning sub-question**: the `0.3` reverse-boost factor and `MAX_HITS_PER_CODE = 2` are starting guesses; tune against the eval set during implementation.

**Forward dependency on Q3 / P5.4**: once Q1 lands, the TypeScript `searchIndex.ts` becomes the reference implementation that the Go token-scorer port (P5.4) must mirror byte-for-byte — including the `"code"` hit kind, the path/description tokenization, the reverse concept boost, and `MAX_HITS_PER_CODE`. The fixture-parity tests in P5.4 will fail if Q1's behavior is not reproduced in Go. So Q1's constants and scoring formula should be considered frozen (or changed in both places simultaneously) once P5.4 lands.

### Q2 — Rewrite MCP tool descriptions for discoverability

**Placement decision**: standalone PR, no phase dependency. Lands anytime; recommend before the MCP server's first real release. Design finalized in `TEAM_MODE.md` §Q2.

Scope:

- `mcp-server/src/index.ts`: rewrite every `server.tool(...)` description field in three-part form (function / Use when / Do NOT). Add recommended call-flow line to `server_info`.
- `mcp-server/src/toolDescriptions.ts` (new): localized example-query sets for all 10 UI locales (`en`, `zh-cn`, `ja`, `ko`, `pt-br`, `es`, `de`, `fr`, `hi`, `id`). A `resolveDescription(toolId, locale)` helper picks the right example set; falls back to `en` for missing locales.
- `mcp-server/src/mcpLocale.ts` (new): read `~/.agent-mindmap/mcp-locale.json` at startup, return `UiLocale | "en"`. Missing/unreadable → `en`.
- `extension/src/extension.ts` (and anywhere `resolveUiLocale()` is first called): write `~/.agent-mindmap/mcp-locale.json` with the resolved locale. Re-write on `agentMindmap.ui.locale` setting change (register a `workspace.onDidChangeConfiguration` listener).
- No hot-update: changing locale requires MCP server restart. Documented in the description PR.

**Test**: unit test `resolveDescription` for at least `en` + `zh-cn` + one fallback case; unit test `mcpLocale` reading a fixture file and falling back on missing file. Snapshot test of `server_info` output.

**Rollback**: revert; descriptions return to current terse form. The `mcp-locale.json` file left on disk is harmless (extension keeps writing it, MCP server stops reading it).

### Q3 — Two-level retrieval: embedding (team mode) + text fallback (single-machine)

**Placement decision**: lands as phase 5 sub-PRs, after the Go team service exists (P3.x) and the merge worker is in place (P5.1). Depends on team mode being functional. Design finalized in `TEAM_MODE.md` §Q3 (Route A: search moves to the team service in team mode). Single-machine mode is unchanged — zero PR needed there.

Scope (split into sub-PRs because of size):

**P5.4 — Go port of `searchIndex.ts` token scorer**

- `agent-mindmap-team-service/internal/search/token_scorer.go` — port of `buildRecordTokenSets`, `weightedTerms`, `scoreText`, `diversifyHits`, `rerankHit`, `collectOutlineText`, `buildConceptTermIndex`. Reads `SessionRecord` JSON from Postgres (same `record_json` column), runs entirely on the server. **Must include Q1's codeRef retrieval branch** — the `"code"` hit kind, path/description tokenization, reverse concept boost (`codeRefScore * 0.3 / linkedConceptCount`), and `MAX_HITS_PER_CODE = 2` cap — because fixture-parity tests compare against the TypeScript `searchIndex.ts` which has Q1 merged.
- Fixture-parity tests under `agent-mindmap-team-service/internal/search/token_scorer_test.go`: same input records as `test/searchIndex.test.ts` (or equivalent fixtures), assert byte-identical `SearchHit[]` output (scores, kinds, ordering) to the TypeScript version. Fixtures must include codeRef-bearing records so the Q1 branch is exercised.
- New endpoint `POST /v1/projects/:slug/search` with `query`, `limit`, `verbose` params, returning `SearchHit[]` JSON. Text-only at this stage (no embedding yet).
- `RemoteStore.search(projectSlug, query, limit, opts)` in `shared/src/store/remoteStore.ts` — calls the new endpoint.
- MCP client `search_project_history` / `retrieve_project_memory` handlers: in team mode, delegate to `Store.search()`; in single-machine mode, keep calling `searchProjectRecords` directly.
- **Test**: Go fixture-parity tests pass (including codeRef cases from Q1); `RemoteStore.search` test with mocked HTTP; end-to-end team-mode search returns same hits as single-machine for a text-only query.

**P5.5 — Embedding worker (Go) + bge-m3 client**

- `agent-mindmap-team-service/internal/embedding/bge_client.go` — HTTP client for the bge-m3 endpoint (`POST /embed` with batched texts). Configurable via `AGENT_MINDMAP_EMBEDDING_ENDPOINT`, `AGENT_MINDMAP_EMBEDDING_MODEL`.
- `agent-mindmap-team-service/internal/embedding/worker.go` — runs alongside the merge worker (P5.1), rebuilds the embedding index when a project's revision changes. Batches `ConceptContextForMerge` texts (label + aliases + evidence) per project, calls bge-m3, writes vectors to Postgres.
- New Postgres table `embeddings(project_slug, concept_key, model, vector BYTEA, built_at, PK(project_slug, concept_key, model))`. Migration in `agent-mindmap-team-service/migrations/`.
- Health check: if `AGENT_MINDMAP_EMBEDDING_ENDPOINT` is unset, worker is a no-op; search endpoint falls back to text-only. Team mode still functions without the 3090.
- **Test**: worker test — seed sessions, run worker, verify embeddings in Postgres with expected dimensions; bge-m3 client test against a mock HTTP server.

**P5.6 — Hybrid scoring + eval validation**

- `agent-mindmap-team-service/internal/search/hybrid_scorer.go` — combines token score (from P5.4) and embedding cosine similarity. `final = α * embedding_score + (1-α) * token_score`, with `α` from `AGENT_MINDMAP_EMBEDDING_ALPHA` (default 0.5). Embedding score = max cosine similarity between query embedding and the session's concept embeddings, normalized to `[0,1]`.
- Query embedding: the search endpoint embeds the query via bge-m3 at request time (one HTTP call per search), then joins against stored concept embeddings.
- `diversifyHits` runs on the merged hybrid hits, unchanged caps (plus `MAX_HITS_PER_CODE` from Q1).
- `shared/src/retrievalEval.ts` gains team-mode cases: run eval against the Go endpoint (via `RemoteStore.search`), assert hybrid beats text-only baseline on hit-rate / recall. Eval cases must include fuzzy conceptual queries (where embedding should help) and exact-keyword queries (where token must still dominate).
- **Test**: hybrid scorer unit tests; eval shows improvement; exact-keyword query still returns the same top hit as text-only (no regression from embedding noise).

**Configuration**: `AGENT_MINDMAP_EMBEDDING_ENDPOINT`, `AGENT_MINDMAP_EMBEDDING_MODEL` (default `bge-m3`), `AGENT_MINDMAP_EMBEDDING_ALPHA` (default `0.5`). All optional — team mode works text-only without them.

**Rollback**: P5.4 is independently revertable (client falls back to local `searchProjectRecords` even in team mode — slower but correct, since `RemoteStore` already has `listRecordsForProject`). P5.5/P5.6 revert together; team mode returns to text-only search from P5.4.

**Open sub-questions for implementation**:

- Exact normalization formula for embedding score (max cosine vs top-k mean vs softmax-weighted) — decide during P5.6 based on eval results.
- Whether to embed the query at request time (latency per search) or cache recent query embeddings (LRU) — decide during P5.6 based on measured latency.
- Embedding rebuild batching size and concurrency — decide during P5.5.
