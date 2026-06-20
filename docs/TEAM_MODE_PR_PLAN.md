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
                                                                                                                 P5.4 → P5.5 → P5.6
                                                                                                                                ↓
                                                                                                                           P6.1, P6.2, P6.3, P6.4

Q1 (codeRef retrieval)  ──┐  (independent, lands before P2.1)
Q2 (tool descriptions)   ──┘  (independent, lands anytime)
```

P2.4 (deprecate JSON write path) and P2.5 (remove `JsonFsStore`) can land after P3.x starts — they're independent of the service work. P5 and P6 require P4 complete (clients connected) to be meaningful, but P5.1 (worker) can start in parallel with P4 since it only depends on P3.

**Q1 / Q2 / Q3 placement notes**:

- **Q1 (codeRef retrieval signal)**: standalone PR, no phase dependency. Touches `shared/src/searchIndex.ts` + `SearchHit` type + `retrievalEval.ts`. Recommended to land before P2.1 so the SQLite migration and later Go port (P5.4) pick up the codeRef retrieval branch from the start. Q1 is a prerequisite of P5.4: the Go token-scorer port must include the `"code"` hit kind, the `MAX_HITS_PER_CODE` cap, and the reverse concept boost — otherwise the Go port diverges from the TypeScript reference and fixture-parity tests fail.
- **Q2 (tool descriptions)**: standalone PR, no phase dependency, no code dependency on Q1 or Q3. Lands anytime; recommended before the MCP server's first real release.
- **Q3 (embedding hybrid retrieval)**: lands as P5.4 → P5.5 → P5.6, after P5.1 (merge worker exists, embedding worker runs alongside it). P5.4 depends on Q1 being landed (the Go token-scorer port must mirror the TypeScript scorer _including_ Q1's codeRef branch — fixture-parity tests assert identical output, so Q1 must be in the TypeScript reference first). P5.4 also depends on P3.2 (REST API exists, so the new `/search` endpoint has a router to plug into). P5.5 and P5.6 depend on P5.4.

### Estimated effort

Rough, for planning not commitment:

| Phase | PRs | Effort                                                                                                                  |
| ----- | --- | ----------------------------------------------------------------------------------------------------------------------- |
| 1     | 4   | Small — pure refactor, mechanics                                                                                        |
| 2     | 5   | Medium — SQLite migration is the risky part                                                                             |
| 3     | 4   | Medium — new Go service, no `shared/` reuse; storage + REST + auth                                                      |
| 4     | 4   | Medium — push queue and bulk migration are fiddly                                                                       |
| 5     | 6   | Medium-large — trie-merge port (P5.1-3) + search/embedding port (P5.4-6), both cross-language with fixture-parity tests |
| 6     | 4   | Small-to-medium — depends on which PRs are needed                                                                       |
| Q1    | 1   | Small — retrieval-layer change in `searchIndex.ts`, no schema bump                                                      |
| Q2    | 1   | Small — copy + locale file, no logic change                                                                             |

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

- `team-server/internal/search/token_scorer.go` — port of `buildRecordTokenSets`, `weightedTerms`, `scoreText`, `diversifyHits`, `rerankHit`, `collectOutlineText`, `buildConceptTermIndex`. Reads `SessionRecord` JSON from Postgres (same `record_json` column), runs entirely on the server. **Must include Q1's codeRef retrieval branch** — the `"code"` hit kind, path/description tokenization, reverse concept boost (`codeRefScore * 0.3 / linkedConceptCount`), and `MAX_HITS_PER_CODE = 2` cap — because fixture-parity tests compare against the TypeScript `searchIndex.ts` which has Q1 merged.
- Fixture-parity tests under `team-server/internal/search/token_scorer_test.go`: same input records as `test/searchIndex.test.ts` (or equivalent fixtures), assert byte-identical `SearchHit[]` output (scores, kinds, ordering) to the TypeScript version. Fixtures must include codeRef-bearing records so the Q1 branch is exercised.
- New endpoint `POST /v1/projects/:slug/search` with `query`, `limit`, `verbose` params, returning `SearchHit[]` JSON. Text-only at this stage (no embedding yet).
- `RemoteStore.search(projectSlug, query, limit, opts)` in `shared/src/store/remoteStore.ts` — calls the new endpoint.
- MCP client `search_project_history` / `retrieve_project_memory` handlers: in team mode, delegate to `Store.search()`; in single-machine mode, keep calling `searchProjectRecords` directly.
- **Test**: Go fixture-parity tests pass (including codeRef cases from Q1); `RemoteStore.search` test with mocked HTTP; end-to-end team-mode search returns same hits as single-machine for a text-only query.

**P5.5 — Embedding worker (Go) + bge-m3 client**

- `team-server/internal/embedding/bge_client.go` — HTTP client for the bge-m3 endpoint (`POST /embed` with batched texts). Configurable via `AGENT_MINDMAP_EMBEDDING_ENDPOINT`, `AGENT_MINDMAP_EMBEDDING_MODEL`.
- `team-server/internal/embedding/worker.go` — runs alongside the merge worker (P5.1), rebuilds the embedding index when a project's revision changes. Batches `ConceptContextForMerge` texts (label + aliases + evidence) per project, calls bge-m3, writes vectors to Postgres.
- New Postgres table `embeddings(project_slug, concept_key, model, vector BYTEA, built_at, PK(project_slug, concept_key, model))`. Migration in `team-server/migrations/`.
- Health check: if `AGENT_MINDMAP_EMBEDDING_ENDPOINT` is unset, worker is a no-op; search endpoint falls back to text-only. Team mode still functions without the 3090.
- **Test**: worker test — seed sessions, run worker, verify embeddings in Postgres with expected dimensions; bge-m3 client test against a mock HTTP server.

**P5.6 — Hybrid scoring + eval validation**

- `team-server/internal/search/hybrid_scorer.go` — combines token score (from P5.4) and embedding cosine similarity. `final = α * embedding_score + (1-α) * token_score`, with `α` from `AGENT_MINDMAP_EMBEDDING_ALPHA` (default 0.5). Embedding score = max cosine similarity between query embedding and the session's concept embeddings, normalized to `[0,1]`.
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
