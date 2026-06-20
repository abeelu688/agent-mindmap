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

### P1.3 — Port extension store callers to `Store`

**Scope**

- The extension has its own store layer at `extension/src/store/` (sessionStore, ontologyStore, mergeSnapshot, etc.) that writes JSON directly. Introduce a `Store` instance constructed at activation (`extension/src/extension.ts`) from `getStoreDir()`, pass it through command handlers and `sessionLoader.ts`.
- This is the largest PR in phase 1. Files touched: `extension.ts`, `commands/analyzeProject.ts`, `commands/syncAiContext.ts`, `sessionLoader.ts`, `mindmap/rebuildMindMapFromStore.ts`, `store/sessionStore.ts`, `store/clearProjectAnalysisCache.ts`, `codeRefQueue.ts`.
- The extension's write paths (pipeline → sessionStore → JSON) route through `Store.upsertRecord` / `Store.bumpProjectRevision`. Read paths route through `Store.listRecordsForProject` etc.
- `mcpConfig.ts`'s `refreshMcpIndexForProject` / `refreshMcpIndexForWorkspace` call `bumpMcpProjectRevision` directly — switch to `Store`.

**Not in scope**: changing what gets written or read. Same JSON files, same contents.

**Test**: existing extension tests green; add a smoke test that activating the extension and analyzing a session still produces the same JSON on disk (byte-compare a fixture).

**Rollback**: revert; extension returns to direct `storeReader`/`sessionStore` calls. Since P1.1/P1.2 only added wrappers, the extension works again without them.

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

**Scope**

- `extension/src/extension.ts`: construct `SqliteStore` (after migration if needed) instead of `JsonFsStore`.
- MCP server (`mcp-server/src/index.ts`): same switch.
- `JsonFsStore` kept in tree (used by P2.2 migration and as fallback); no longer the default.

**Test**: end-to-end — analyze a session, verify it lands in `store.db` not JSON; restart extension, verify session is read back.

**Rollback**: revert the default switch; `JsonFsStore` is default again. `store.db` from the reverted version is ignored (JSON files were never deleted).

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

- New directory `team-server/` at the repo root (sibling to `extension/`, `mcp-server/`, `shared/`). Go module `github.com/agent-mindmap/team-server` (`team-server/go.mod`).
- Layout: `cmd/server/main.go`, `internal/storage/` (Postgres access), `internal/api/` (HTTP handlers), `internal/worker/` (P5 merge worker), `internal/config/`, `migrations/` (SQL files).
- `internal/storage/postgres.go` — `pgx`-backed (`database/sql` + `pgxstdlib`) storage layer. Schema mirrors the SQLite schema adapted to Postgres types: `projects(project_slug TEXT PK, project_path TEXT, revision BIGINT, record_count BIGINT, last_analyzed_at BIGINT, last_built_at BIGINT)`, `sessions(project_slug TEXT, session_id TEXT, transcript_sha256 TEXT, analyzed_at BIGINT, record_json JSONB, PK(project_slug, session_id))`, `kv(key TEXT PK, value_json JSONB, updated_at BIGINT)`.
- Migrations via `golang-migrate` (or hand-rolled SQL files under `migrations/` applied at boot with `CREATE TABLE IF NOT EXISTS`).
- `BumpProjectRevision` uses `INSERT ... ON CONFLICT (project_slug) DO UPDATE SET revision = projects.revision + 1 RETURNING revision` — no application-level lock.
- Go unit tests in `team-server/internal/storage/postgres_test.go` run against a test Postgres instance (`docker-compose.yml` at the repo root or under `team-server/`).

**Not in scope**: HTTP endpoints, auth, merge worker.

**Test**: `go test ./internal/storage/...` passes against a test DB; CRUD on `sessions` and `projects` works; `BumpProjectRevision` is monotonic under concurrent goroutines.

**Rollback**: service not deployed yet; revert is trivial.

### P3.2 — REST API endpoints (Go)

**Scope**

- `team-server/internal/api/` — implement the endpoints from `TEAM_MODE.md` §HTTP API using `net/http` (or `chi` router — ❓ recommend `chi` for middleware ergonomics, stdlib-compatible):
  - `GET /v1/projects`
  - `GET /v1/projects/:slug/revision`
  - `GET /v1/projects/:slug/sessions` (paged)
  - `GET /v1/projects/:slug/sessions/:id`
  - `PUT /v1/projects/:slug/sessions/:id` (upsert, LWW on `analyzedAt`)
  - `GET /v1/merges/concept-trie`
  - `GET /v1/merges/concept-trie/revision`
  - `GET /v1/projects/:slug/equivalences`
- All handlers delegate to the storage layer. The Go service treats `record_json` as opaque JSON — it does not parse `SessionRecord` internals.
- Integration tests in `team-server/internal/api/routes_test.go` — full HTTP request/response against a test DB using `httptest`.

**Not in scope**: auth middleware (next PR), merge worker (phase 5).

**Test**: route tests pass; `PUT` upsert semantics verified (LWW, no 409).

**Rollback**: service not deployed; revert.

### P3.3 — Auth middleware (Go)

**Scope**

- `team-server/internal/api/middleware.go` — Bearer token check on every request (decision 5: reads and writes both require key). Constant-time compare via `crypto/subtle`.
- Server configured with one or more valid API keys via env var `AGENT_MINDMAP_API_KEYS` (comma-separated). v2: key-per-user with a `keys` table; v1 shared key only.
- 401 on missing/invalid token. No anonymous read surface.
- Tests: requests without token → 401; with valid token → 200; with wrong token → 401.

**Test**: auth tests pass.

**Rollback**: revert middleware; endpoints open (only acceptable pre-deployment).

### P3.4 — Service packaging and deploy docs

**Scope**

- `team-server/Dockerfile` (multi-stage: `golang:1.22` build → `gcr.io/distroless/static` runtime), `team-server/docker-compose.yml` (Postgres + service), `team-server/README.md` with deploy instructions.
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

- `extension/src/store/pushQueue.ts` — after each local `upsertRecord` (pipeline writes a session), if team mode is active, enqueue a `PUT /sessions/:id` to the team service.
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

- `team-server/internal/worker/merge_worker.go` — periodic Go job that recomputes the concept trie from all `sessions.record_json` for a project, writes the result to `kv` (key `concept-trie`). Per decision 7: cron on fixed interval + on project revision change.
- Re-implements the existing TypeScript trie-merge algorithm (currently in `shared/src/` + `extension/src/store/`). The algorithm is deterministic; the Go port carries its own tests under `team-server/internal/worker/` using the same fixture inputs to assert byte-equivalent output to the TypeScript version.
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
- ❓ Dashboard — recommend a Grafana JSON in `team-server/grafana/` for the deploy docs, not a hosted dashboard.

**Test**: metrics endpoint returns expected counters after seeded requests.

### P6.2 — Rate limiting and abuse protection

**Scope**

- Per-key token-bucket rate limit (e.g. 600 req/min, burst 50) in `team-server/internal/api/middleware.go` (or `golang.org/x/time/rate`).
- Per-project PUT concurrency guard: if one client is pushing 10k sessions, don't starve others. ❓ Recommend a simple per-key fair queue, not per-project.

**Test**: rate-limit test — exceed limit → 429.

### P6.3 — Backup and restore docs

**Scope**

- `team-server/docs/backup.md` — `pg_dump` cron, restore procedure, point-in-time recovery via Postgres WAL if enabled.
- ❓ Managed Postgres (RDS, Cloud SQL) guidance — add if a team asks for it.

**Test**: docs review; dry-run backup/restore in docker-compose.

### P6.4 — Audit logging (if requested)

**Scope** (only if a real team asks for it; otherwise skip)

- Append-only `session_history` table — `session_id, project_slug, actor, analyzed_at, pipeline_version, record_json_snapshot, written_at`.
- `PUT /sessions/:id` writes to both `sessions` (LWW) and `session_history` (append).
- `GET /v1/projects/:slug/sessions/:id/history` endpoint.
- Per decision 6, this is opt-in and does not change the main read path.

**Test**: history accumulates on repeated PUTs; history endpoint returns chronological entries.

**End of phase 6**: Go service is production-ready.

---

## Cross-cutting concerns

### Test strategy

- **Shared `Store` contract test**: one test suite (`test/store/storeContract.test.ts`) that runs against any TypeScript `Store` impl. Each impl (`JsonFsStore`, `SqliteStore`, `RemoteStore`) includes a thin adapter and runs the contract suite. The Go `PostgresStore` is not a TypeScript `Store`; its contract is enforced by Go tests under `team-server/` that assert the same behavior, plus a cross-language fixture-parity check for the trie-merge algorithm in P5.1.
- **Migration tests**: JSON→SQLite (P2.2) and bulk-push (P4.4) tested with fixture stores.
- **No integration tests that require a real team service in CI** until phase 6 — `RemoteStore` tests mock the HTTP layer; Go route tests use `httptest` against a test DB.

### Branch / release strategy

- Phases 1–2 land on `main` and ship in normal extension releases. Users see SQLite migration (P2.2/P2.3) as a versioned upgrade.
- Phases 3–6 develop on `main` but are feature-gated by `agentMindmap.team.serverUrl` being unset. No user sees team mode until they configure it.
- The `team-server/` Go module is versioned independently (Git tag `team-server/v0.x.y`) and deployed separately from the extension. Its releases do not bump the extension version.

### Open questions to resolve mid-flight

These don't block the plan but need answers when the relevant PR is in flight:

- **P2.1**: `better-sqlite3` vs `node:sqlite` (Node version compatibility in VS Code).
- **P3.1**: `chi` router vs stdlib `net/http` (recommend `chi` for middleware ergonomics).
- **P3.4**: Rate limiting in v1 or defer to P6.2 (recommend defer if internal-only).
- **P4.3**: Push-queue backoff upper bound (recommend 5 min).
- **P5.1**: Worker interval default (recommend 10 min).
- **P6.1**: Grafana dashboard in tree or hosted (recommend in tree).

### Dependency graph

```
P1.1 → P1.2 → P1.3 → P1.4
                          ↓
                    P2.1 → P2.2 → P2.3 → (release) → P2.4 → P2.5
                                              ↓
                                         P3.1 → P3.2 → P3.3 → P3.4
                                                                       ↓
                                                                  P4.1 → P4.2 → P4.3 → P4.4
                                                                                              ↓
                                                                                         P5.1 → P5.2 → P5.3
                                                                                                                      ↓
                                                                                                                 P6.1, P6.2, P6.3, P6.4
```

P2.4 (deprecate JSON write path) and P2.5 (remove `JsonFsStore`) can land after P3.x starts — they're independent of the service work. P5 and P6 require P4 complete (clients connected) to be meaningful, but P5.1 (worker) can start in parallel with P4 since it only depends on P3.

### Estimated effort

Rough, for planning not commitment:

| Phase | PRs | Effort                                                             |
| ----- | --- | ------------------------------------------------------------------ |
| 1     | 4   | Small — pure refactor, mechanics                                   |
| 2     | 5   | Medium — SQLite migration is the risky part                        |
| 3     | 4   | Medium — new Go service, no `shared/` reuse; storage + REST + auth |
| 4     | 4   | Medium — push queue and bulk migration are fiddly                  |
| 5     | 3   | Medium — Go port of trie-merge algorithm with fixture-parity tests |
| 6     | 4   | Small-to-medium — depends on which PRs are needed                  |
