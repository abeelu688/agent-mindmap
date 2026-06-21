# Team Mode — PR Plan (agent-mindmap)

> **Scope**: PRs that touch the **agent-mindmap** repo (TypeScript extension, MCP server, `shared/` package). The Go team service PRs live in [`agent-mindmap-team-service/docs/TEAM_MODE_PR_PLAN.md`](../../agent-mindmap-team-service/docs/TEAM_MODE_PR_PLAN.md).
>
> **Companion to**: [`TEAM_MODE.md`](TEAM_MODE.md).
>
> **Convention**: PRs are numbered `P<phase>.<sequence>`. Phases must land in order; PRs within a phase land in sequence unless noted. Every PR keeps `npm run test:vitest` green and the extension buildable.
>
> **Status legend**: ✅ landed · 🔶 partially done / in progress · ⬜ not started

---

## Phase 1 — Introduce the `Store` interface ✅

### P1.1 — Define `Store` interface and `JsonFsStore` skeleton ✅

- `shared/src/store/store.ts` — `Store` interface with 14+ methods.
- `shared/src/store/jsonFsStore.ts` — `JsonFsStore implements Store` delegating to existing `storeReader.ts`, `mcpIndex.ts`, `atomicWrite.ts`.
- Exported from `shared/src/index.ts`.
- Tests in `test/store/jsonFsStore.test.ts`.

### P1.2 — Port MCP server to `Store` ✅

- `mcp-server/src/handlers.ts`: `createMcpHandlerContext(store)` receives `Store` instead of `storeDir`.

### P1.3 — Port extension store READ callers to `Store` ✅

- `extension/src/store/storeClient.ts` — memoized `getStore()` keyed on `getStoreDir()`.
- Read paths route through `Store`. Writes route through `Store` as of P2.3.

### P1.4 — Retire `storeReader.ts` direct exports ✅

- Raw store functions are internal to `jsonFsStore.ts`; no longer re-exported from `shared/src/index.ts`.

**End of phase 1**: storage access is fully behind `Store`.

---

## Phase 2 — SQLite for single-machine mode

### P2.1 — Add SQLite dependency and schema ✅

- `shared/src/store/sqliteSchema.ts` — three tables (`projects`, `sessions`, `kv`).
- `shared/src/store/sqliteStore.ts` — `SqliteStore implements Store`, backed by `@vscode/sqlite3`.
- Tests in `test/store/sqliteStore.test.ts`.

### P2.2 — JSON → SQLite migration ✅

- `shared/src/store/migrateJsonToSqlite.ts` — reads existing JSON files, writes into fresh `store.db`.
- `shared/src/store/storeBootstrap.ts` — `bootstrapStore()` picks the right `Store` for a given dir.
- Tests in `test/store/migrateJsonToSqlite.test.ts`, `test/store/storeBootstrap.test.ts`.

### P2.3 — Switch extension to `SqliteStore` by default ✅

- `extension/src/extension.ts` eagerly fires `getStore()` at startup.
- MCP server uses `bootstrapStore()` in `main()`.
- ALL extension store writes route through `Store` (14 methods on the interface).
- `ConceptOntologyRecord` moved to `shared/src/storeTypes.ts`.
- Tests in `test/store/extensionStoreRouting.test.ts`.

### P2.4 — Deprecate `JsonFsStore` write path ✅

**Scope** (ships one release after P2.3 is confirmed stable)

- Remove the read-only fallback to `JsonFsStore` from `storeBootstrap.ts` — corrupt `store.db` now throws instead of falling back.
- Remove `migrateJsonToSqlite.ts` (migration window closed).
- Delete original JSON files on first launch of this version (after confirming `store.db` is healthy), gated by a kv meta flag (`json-cleanup-done`) so it only runs once.
- `JsonFsStore` class stays in tree for one more release, then removed in P2.5.
- Tests (`mcpHandlers.test.ts`, `extensionStoreRouting.test.ts`, `storeBootstrap.test.ts`) switched from `JsonFsStore` to `SqliteStore` via `bootstrapStore`.

**Rollback**: this is the commit point. After this, downgrade to pre-SQLite is no longer supported.

### P2.5 — Remove `JsonFsStore` ✅

- Deleted `jsonFsStore.ts`, `storeReader.ts`, `mcpIndex.ts`, `shared/src/atomicWrite.ts`.
- Removed `JsonFsStore` export from `shared/src/index.ts`.
- Tests (`mcpShared.test.ts`, `mcpHandlers.test.ts`, `extensionStoreRouting.test.ts`, `storeBootstrap.test.ts`) switched from `JsonFsStore` to `SqliteStore` via `bootstrapStore`.
- Deleted `jsonFsStore.test.ts` and `migrateJsonToSqlite.test.ts`.
- Updated comments referencing `JsonFsStore` in `store.ts`, `storeTypes.ts`, `storeClient.ts`, `outlineToTopicGraph.ts`.

---

### Q5 — Project mode (workspace/repo) + repo-URI slugs + re-key ✅

### P2.6 — `agentMindmap.project.mode` setting + slug derivation + prerequisite hard-error ✅

- `extension/src/host/slugDerivation.ts` — `deriveProjectSlug()`, `normalizeRepoUriToSlug()`.
- `agentMindmap.project.mode` (`workspace` | `repo`) in `extension/package.json`.
- Hard-error enforcement: repo mode refuses to run if ANY workspace folder fails prerequisites.
- Tests in `test/slugDerivation.test.ts`.

### P2.7 — `paths.json` map files + MCP server path resolution ✅

- `extension/src/store/pathsMap.ts` — writes `workspace-paths.json` and `repo-paths.json`.
- `mcp-server/src/pathsMap.ts` — reads map on slug-lookup miss, signals notification on persistent miss.
- `mcp-server/src/handlers.ts` — Q4 staleness reads paths map for file resolution.
- Manual refresh command `agentMindmap.refreshRepoPaths`.
- Tests in `test/pathsMap.test.ts`.

### P2.8 — One-way re-key migration (workspace → repo) ✅

- `extension/src/store/rekeyMigration.ts` — triggered when `project.mode` switches `workspace → repo`.
- Per-folder SQLite transaction, backup `store.db.pre-rekey-<timestamp>`.
- `SqliteStore.rekeyProjectSlug(oldSlug, newSlug)`.
- One-way: `kv` flag `rekeyed-to-repo`; `workspace` mode no longer offered after re-key.
- Tests in `test/rekeyMigration.test.ts`.

---

## Phase 4 — Extension wiring for team mode ✅

### P4.1 — `RemoteStore` client ✅

- `shared/src/store/remoteStore.ts` — `RemoteStore implements Store`, calls REST API via `fetch`.
- Bearer token, retry with exponential backoff on 5xx, `McpSearchIndexCache` for project index.
- Tests in `test/store/remoteStore.test.ts`.

### P4.2 — Team config and store selection ✅

- `extension/src/store/storeFactory.ts` — `tryCreateRemoteStore()`, `getRemoteStoreIfEnabled()`.
- Settings: `agentMindmap.team.serverUrl`, `agentMindmap.team.apiKey` (SecretStorage).
- Command: "Agent Mind Map: Configure Team Service".
- Tests in `test/store/storeFactory.test.ts`.

### P4.3 — Push queue (local → team) ✅

- `extension/src/store/pushQueue.ts` — enqueue after each local `upsertRecord` when team mode is active.
- `lastPushedWatermark` in local `kv`; drain on activation + after writes.
- Tests in `test/store/pushQueue.test.ts`.

### P4.4 — Bulk push on first team-mode activation ✅

- `extension/src/store/bulkPush.ts` — `runBulkPushIfNeeded()`.
- One-shot iterate all local sessions, POST each.
- Progress UI (VS Code progress notification).
- Tests in `test/store/bulkPush.test.ts`.

**End of phase 4**: team mode is usable end-to-end for CRUD. A user can configure the team service, push their history, and query the shared knowledge base via MCP.

---

## Phase 5 (client side) — Search delegation + trie-revision polling

### P5.3 — Client polls trie revision ✅

- `RemoteStore.readConceptTrieMerge` checks `GET /v1/merges/concept-trie/revision` first; if unchanged, returns cached value without full fetch.
- Same pattern as `ensureProjectIndex`'s revision check.
- Tests in `test/store/remoteStore.test.ts`.

### P5.4 — Client-side search (RemoteStore.search + MCP delegation) ✅

> **Boundary**: The Go token-scorer port + search endpoint live in `agent-mindmap-team-service` (see its PR plan). This PR covers the **TypeScript client half**.

**Scope**

1. **`shared/src/store/store.ts`**: add optional `search(projectSlug, query, limit, opts?)` method to the `Store` interface. `SqliteStore` does NOT implement it (single-machine uses `searchProjectRecords` directly); `RemoteStore` does.

2. **`shared/src/store/remoteStore.ts`**: implement `search()`:
   - `POST /v1/projects/${projectSlug}/search` with `{ query, limit, verbose }` body.
   - Parse response as `SearchHit[]`.
   - No caching (search is stateless per query).

3. **`shared/src/store/teamStore.ts`**: add `search()` that delegates to `this.remote.search()`.

4. **`mcp-server/src/handlers.ts`**: in `runProjectSearch()`, check if `ctx.store.search` exists (team mode). If so, call it instead of the local `searchProjectRecords` path:

   ```ts
   let hits: SearchHit[];
   if (ctx.store.search) {
     hits = await ctx.store.search(slug, query, limit, { verbose });
   } else {
     // existing single-machine path
     const equivalences = await ctx.store.readLatestSegmentEquivalences(slug);
     hits = searchProjectRecords(index.records, query, limit, equivalences, ...);
   }
   ```

   After getting hits (from either path), `backFillStaleness(ctx, hits)` still runs — staleness is always MCP-server-computed in both modes.

5. **`test/store/remoteStore.test.ts`**: add `search()` test with mocked HTTP response.

**Not in scope**: Go token-scorer implementation (that's the team-service repo's P5.4).

**Test**: RemoteStore.search test passes; existing MCP handler tests unchanged; team-mode search delegation verified manually (extension output panel logs show remote fetch).

**Rollback**: revert; MCP handler falls back to local `searchProjectRecords` in all modes.

---

## Q1 — Use `codeReferences` as a retrieval signal ✅

- `shared/src/searchIndex.ts`: `buildRecordTokenSets` includes codeRef description (ngram) + path (whole-word); `searchProjectRecords` adds `"code"` hit kind with reverse concept boost; `diversifyHits` adds `MAX_HITS_PER_CODE = 2`.
- `SearchHit` type gains `codePath`, `codeLines`, `codeDescription`, `codeSourceTurnIndices`, `codeMarkCode`.
- Tests in `test/searchCodeRefs.test.ts`, `test/retrievalEval.test.ts`.

## Q2 — Rewrite MCP tool descriptions for discoverability ✅

- `mcp-server/src/toolDescriptions.ts` — three-part descriptions with localized examples.
- `mcp-server/src/mcpLocale.ts` — reads `~/.agent-mindmap/mcp-locale.json`.
- Extension writes locale file on activation + setting change.

## Q4 — CodeReference `markCode` + staleness ✅

- `shared/src/llmTypes.ts`: `CodeReference` gains `markCode: string[]`.
- `extension/src/llm/extractCodeReferences.ts`: captures raw `Write.contents` / `StrReplace.new_string` before whitespace collapse; `buildMarkCode()` filters to effective lines.
- `mcp-server/src/handlers.ts`: `computeStaleness()` + `backFillStaleness()` — on-read three-state verdict (`fresh` / `stale` / `unknown`) via per-line substring match against local file.
- `mcp-server/src/pathsMap.ts`: path resolution for staleness file reads.

---

## Pending work summary

| PR                                                | Status | Depends on                          |
| ------------------------------------------------- | ------ | ----------------------------------- |
| P2.4 — Deprecate JsonFsStore write path           | ✅     | P2.3 confirmed stable in release    |
| P2.5 — Remove JsonFsStore                         | ✅     | P2.4                                |
| P5.4 client — RemoteStore.search + MCP delegation | ✅     | Team-service P5.4 (search endpoint) |

All other PRs in this repo are landed.
