# Team Mode Architecture

> **Status**: design draft. Q1–Q5 are fully resolved and promoted to §Decisions (items 11 and 12 cover Q4 and Q5 respectively). Per-question "Decided design" subsections retain the full detail. The `CodeReference` evidence field is named **`markCode`** (not `evidence`), per the naming note in Q4; `markCode` is stored as `string[]`. Q4 ships as a single PR after P2.7; Q5 ships as the P2.6 → P2.7 → P2.8 sub-series. See `TEAM_MODE_PR_PLAN.md`.
>
> **Audience**: contributors planning the team-shared knowledge base work. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first for the current single-machine data flow.
>
> **Server language**: Go (see §Team service implementation). The TypeScript client (`shared/`, `mcp-server`, `extension`) is unchanged in scope; the team service is a **separate Go repository** at `agent-mindmap-team-service` (sibling to this repo), not a subdirectory of the extension repo.

## Goal

Let a team share one knowledge base of analyzed agent sessions, while keeping the existing single-machine experience untouched. A single user should not need to run a server; a team should only need to configure a service address.

## Design principles

1. **One codebase, two modes.** Single-machine and team modes share the same `Store` interface and the same MCP handlers. Mode is selected by configuration, not by a fork.
2. **Single machine stays file-based, zero-ops.** No server process, no database to install. The `sqlite` store is just a file on disk.
3. **Team mode is opt-in by one config field.** Setting `agentMindmap.team.serverUrl` switches the store from local SQLite to a remote HTTP client. Unset = single machine.
4. **LLM pipeline stays on the client.** The server has no LLM CLI, no API key, no pipeline code. Clients analyze locally and push `SessionRecord` JSON upstream. This keeps the server stateless and avoids centralized key management.
5. **Same Store semantics in both modes.** The interface is designed around DB semantics (transactions, row locks, monotonic revision). The SQLite implementation simulates these locally; the Postgres backend uses them natively.

## Architecture overview

```
SINGLE-MACHINE MODE                         TEAM MODE
┌─────────────────────────────┐             ┌─────────────────────────────┐
│  Cursor / Claude Code       │             │  Cursor / Claude Code       │
│         │ stdio             │             │         │ stdio             │
│  ┌──────▼──────┐            │             │  ┌──────▼──────┐            │
│  │ mcp-server  │            │             │  │ mcp-server  │            │
│  │ (stdio)     │            │             │  │ (stdio)     │            │
│  └──────┬──────┘            │             │  └──────┬──────┘            │
│         │ Store interface   │             │         │ Store interface   │
│  ┌──────▼──────┐            │             │  ┌──────▼──────┐            │
│  │ SqliteStore │            │             │  │ RemoteStore │── HTTP ──┐ │
│  │ ~/.agent-   │            │             │  │ (thin HTTP  │         │ │
│  │ mindmap/    │            │             │  │  client)    │         │ │
│  │  store.db   │            │             │  └─────────────┘         │ │
│  └─────────────┘            │             └──────────────────────────┼─┘
│                             │                                        │
│  Extension runs S1/S2       │             ┌──────────────────────────▼─┐
│  pipeline, writes to        │             │  Team HTTP Service         │
│  SqliteStore directly       │             │  (stateless, no LLM)       │
│                             │             │         │                  │
│                             │             │  ┌──────▼──────┐           │
│                             │             │  │ Postgres    │           │
│                             │             │  │ (shared)    │           │
│                             │             │  └─────────────┘           │
│                             │             │                            │
│                             │             │  Extension runs S1/S2      │
│                             │             │  pipeline locally, pushes  │
│                             │             │  SessionRecord via HTTP    │
│                             │             └────────────────────────────┘
```

Key invariant: the **MCP server binary is the same in both modes**. It speaks stdio to Cursor/Claude Code either way. Only its `Store` dependency differs. The team service is a plain REST API + Postgres — it does not speak MCP, does not depend on the MCP SDK, and is not coupled to Cursor/Claude Code's HTTP-MCP client maturity. This keeps the team service simple to deploy and test, and keeps both modes structurally identical at the client.

## Team service implementation

The team HTTP service is **implemented in Go**, not TypeScript. It lives in a **separate repository**, `agent-mindmap-team-service` (a sibling of this repo, not a subdirectory). Its own `go.mod`, `main.go`, `internal/...`, `migrations/`, `Dockerfile`, `docker-compose.yml` — versioned and released independently from the extension. It does **not** share code with `shared/` — the REST contract is the only coupling.

Scope of the Go service:

- **Storage**: Postgres via `pgx` (`database/sql` + `pgxpool`). Tables: `projects`, `sessions` (with `record_json JSONB`), `kv` for merge snapshots. The `record_json` column stores the `SessionRecord` payload verbatim — the server treats it as opaque JSON and never parses its internal structure.
- **REST API**: the endpoints in §HTTP API. CRUD for projects/sessions/merges only. No search, no markdown render, no retrieval eval.
- **Merge worker**: a periodic Go job (cron-style tick + project revision change) that recomputes the concept trie from all `sessions.record_json` for a project and writes the result to `kv`. The trie build is deterministic; the Go implementation re-implements the existing TypeScript trie-merge algorithm against the JSON it reads back from Postgres.
- **Auth**: API key middleware on every endpoint, constant-time compare, single shared team key for v1.

What stays on the TypeScript client:

- **LLM pipeline** (S1/S2) — always runs locally on the member's machine.
- **Markdown rendering and retrieval eval** — stays in `shared/`. The MCP server consumes `SearchHit[]` (returned by the store) and renders markdown in-process; the eval harness runs against whichever store is active.
- **Search (single-machine mode)** — the TypeScript `searchIndex.ts` is the single-machine search implementation, used directly by the MCP client when `serverUrl` is unset.
- **Search (team mode) — moves to the Go service.** See §Open design questions → Q3 (Route A). The Go service implements hybrid embedding+token retrieval; the MCP client's `RemoteStore.search()` delegates to a `POST /v1/projects/:slug/search` endpoint. The Go token scorer is a port of `searchIndex.ts` with fixture-parity tests. This supersedes the earlier "search stays on client" principle: in team mode, search is a server-side concern because hybrid scoring needs both signals over the same candidate set, and embedding lives on the server (cross-machine 3090 + bge-m3, owned by the team service per the boundary decision in Q3).
- **Push queue** — client-side, drains local new analyses to the Go server via `POST /sessions/:id`.

Rationale for Go: the server is intentionally thin (storage + one deterministic worker), so the language choice is driven by deployment ergonomics — single static binary, no Node runtime, native Postgres pool, straightforward Docker image. The cost is re-implementing the trie-merge algorithm in Go; that algorithm is deterministic and well-tested in TypeScript, and the Go port is bounded to that one worker.

## Store interface

All storage access — currently scattered across `shared/src/storeReader.ts`, `mcpIndex.ts`, `atomicWrite.ts` — collapses into one interface. Two implementations: `SqliteStore`, `RemoteStore`. A `JsonFsStore` may exist temporarily as a migration bridge (see §Migration).

```ts
export interface Store {
  // project-level
  listProjectSummaries(): Promise<ProjectSummary[]>;
  getProjectRevision(projectSlug: string): Promise<number>;

  // session records
  getRecord(projectSlug: string, sessionId: string): Promise<SessionRecord | undefined>;
  listRecordsForProject(projectSlug: string): Promise<SessionRecord[]>;
  upsertRecord(record: SessionRecord): Promise<{ revision: number }>;

  // merge / ontology (read-only on client; written by a deterministic worker, see §Sync)
  readConceptTrieMerge(): Promise<MergeRecord | undefined>;
  readLatestSegmentEquivalences(projectSlug: string): Promise<SegmentEquivalence[]>;

  // mcp index
  bumpProjectRevision(
    projectSlug: string,
    recordCount: number,
    opts?: { lastAnalyzedAt?: number; projectPath?: string }
  ): Promise<McpIndexFile>;
}
```

Write semantics:

- `upsertRecord` is idempotent on `(projectSlug, sessionId)`. Returns the new project revision.
- `bumpProjectRevision` is atomic and monotonic. SQLite uses a transaction + `UPDATE … SET revision = revision + 1`; Postgres uses `RETURNING`. The current `.lock` file approach is retired.
- No client ever writes merge snapshots or ontology records directly. Those are produced by a deterministic worker (see §Sync).

## SQLite schema (single-machine)

Replaces the current JSON file layout under `~/.agent-mindmap/`. One file: `store.db`.

```sql
CREATE TABLE projects (
  project_slug   TEXT PRIMARY KEY,
  project_path   TEXT,
  revision       INTEGER NOT NULL DEFAULT 0,
  record_count   INTEGER NOT NULL DEFAULT 0,
  last_analyzed_at INTEGER,
  last_built_at  INTEGER NOT NULL
);

CREATE TABLE sessions (
  project_slug   TEXT NOT NULL REFERENCES projects(project_slug),
  session_id     TEXT NOT NULL,
  transcript_sha256 TEXT,
  analyzed_at    INTEGER NOT NULL,
  record_json    TEXT NOT NULL,           -- full SessionRecord as JSON
  PRIMARY KEY (project_slug, session_id)
);

CREATE TABLE kv (                          -- merge snapshot, ontology index, etc.
  key            TEXT PRIMARY KEY,
  value_json     TEXT NOT NULL,
  updated_at     INTEGER NOT NULL
);
```

`record_json` stores the full `SessionRecord` rather than normalizing every field. The record is read whole or not at all; partial column updates don't happen. Search indexes (`conceptTerms`, `recordTokens`) are rebuilt in-process from the cached records, same as today.

The existing `.mcp-index.json`, `sessions/<slug>/<id>.json`, `merges/concept-trie.json`, `ontology/*` files all map into these three tables. The `Store` interface hides the mapping from callers.

## HTTP API (team service)

Stateless, no LLM, no pipeline. REST over JSON. All endpoints (read and write) require an API key in `Authorization: Bearer`. No anonymous read surface — an in-network leak should not expose session history.

**Methods: only `GET` and `POST` are used.** `PUT` and `DELETE` are not allowed on this API. Upserts (session record pushes) are `POST`; there is no delete surface in v1.

```
GET    /v1/projects                              -> ProjectSummary[]
GET    /v1/projects/:slug/revision               -> { revision, recordCount }
GET    /v1/projects/:slug/sessions?limit&offset  -> SessionRecord[] (paged)
GET    /v1/projects/:slug/sessions/:id           -> SessionRecord
POST   /v1/projects/:slug/sessions/:id           -> { revision }   (upsert, idempotent)
GET    /v1/merges/concept-trie                   -> MergeRecord
GET    /v1/projects/:slug/equivalences           -> SegmentEquivalence[]
GET    /v1/merges/concept-trie/revision          -> { revision }   (cheap cache validation)
POST   /v1/projects/:slug/search                 -> SearchHit[]    (hybrid retrieval, team mode only — Q3 Route A)
```

`RemoteStore` is a thin fetch/POST client over this API. It keeps an in-process LRU cache (the existing `McpSearchIndexCache`) and validates against `GET …/revision` before use — exactly the logic currently in `ensureProjectIndex`, just hitting HTTP instead of `fs.stat`. The Go server returns raw `SessionRecord` JSON; all search-index building, scoring, and markdown rendering stays on the TypeScript client (see §Team service implementation).

## Sync: local → team

A team member's client still runs the full pipeline locally against its `SqliteStore`, then pushes new/changed records upstream. Push is incremental.

```
client SqliteStore                       team HTTP service
        │                                         │
        │ 1. analyze session, upsertRecord local  │
        │ 2. GET /v1/projects/:slug/revision      │
        │ ◄────── { revision: 47 }                │
        │ 3. for each local session with          │
        │    analyzedAt > lastPushedWatermark:    │
        │    POST /v1/projects/:slug/sessions/:id │
        │ ──────────────────────────────────────► │
        │ ◄────── { revision: 48 }                │
        │ 4. update lastPushedWatermark           │
```

`lastPushedWatermark` is stored in `kv` on the client. A background timer (or a post-analyze hook in the extension) drains the queue. Failure retries with exponential backoff; the push is idempotent because `POST /sessions/:id` is keyed by session id.

### Write semantics (no real conflicts)

Each team member analyzes their **own** transcripts (their own Cursor/Claude Code sessions on their own machine). `sessionId` is derived from the transcript file, so two members never produce the same `sessionId` from different transcripts. There is no concurrent-write conflict to resolve.

The only case where the same `(project_slug, session_id)` gets pushed twice is **one user across devices**: member analyzes a session on machine A, pushes; later opens the same project on machine B (transcript file shared via git or synced storage), re-analyzes, pushes again. This is an update, not a conflict.

Policy: **pure upsert, last-write-wins on `analyzedAt`**.

- `POST /sessions/:id` always overwrites. No `transcriptSha256` guard, no 409.
- The client's `isRecordFresh` already guarantees it only pushes records newer than what it has locally — it won't push stale records over fresh ones.
- Pipeline version bumps (`PIPELINE_VERSION` change) trigger client-side re-analysis; the resulting fresh record overwrites the old one upstream. Expected behavior.
- `transcriptSha256` may differ across two pushes for the same session if the transcript file was appended to between analyses (Cursor appending turns). The newer analysis wins. Correct.

No audit history is kept. If audit becomes a requirement later, add an append-only `session_history` table — it does not touch the main read/write path.

### Merge snapshots

The concept trie and ontology equivalences are produced by a **deterministic batch worker on the Go server**, not by client pushes. A Go cron job recomputes the trie from all `sessions.record_json` for a project on a fixed interval (and on project revision change), writes the result to the `kv` table, and exposes it via `GET /v1/merges/concept-trie`. Push-triggered recomputation was considered and rejected: the trie rebuild is deterministic and cheap relative to LLM analysis, so a periodic full rebuild is simpler and avoids high-frequency small rebuilds on every push. Clients poll `GET /v1/merges/concept-trie/revision` to know when to refresh their cached copy.

The Go worker re-implements the existing TypeScript trie-merge algorithm. The algorithm is deterministic and already covered by `shared/` tests; the Go port carries its own tests under `agent-mindmap-team-service/internal/worker/` using the same fixture inputs to assert byte-equivalent output.

## Authentication

- Single shared team API key for v1, passed as `Authorization: Bearer <key>` on every request (read and write). Configured per-client in `agentMindmap.team.apiKey`.
- v2 may add per-user OAuth if audit / per-user private sessions become a requirement. Out of scope for the first cut.

The key is stored in VS Code SecretStorage, not in `settings.json`. The team service rejects all requests without it — no anonymous read surface.

## Configuration

New VS Code settings:

```jsonc
{
  "agentMindmap.team.serverUrl": "https://mindmap.internal.team/v1", // unset = single-machine
  "agentMindmap.team.apiKey": "", // pulled from SecretStorage, not written here
}
```

`serverUrl` unset → `SqliteStore` + current behavior. Set → `RemoteStore` + push-queue. The extension resolves which store to construct at activation; the MCP server receives its store via the same context (`createMcpHandlerContext(store)`).

No `workspaceId` / sub-namespace concept. `project_slug` already isolates projects — different project paths produce different slugs, so cross-project visibility is naturally bounded. If two sub-teams genuinely need isolation beyond project boundaries, deploy separate team service instances. A workspace prefix can be added later if a concrete need (e.g. same-named projects across sub-teams) actually arises; backfilling a prefix onto existing slugs is cheaper than carrying the abstraction now.

## Migration

Two migrations, independently schedulable:

### Migration 1: JSON files → SQLite (single-machine)

Current `~/.agent-mindmap/sessions/<slug>/<id>.json` etc. → `store.db`. On first launch after upgrade, the extension detects no `store.db` and imports existing JSON files in a one-shot migration. This is a prerequisite for team mode (so both modes share one schema) but ships value on its own — SQLite is faster for large stores than per-file JSON parse.

This migration ships **before** team mode. It's a pure refactor with test coverage, and team mode then only adds `RemoteStore`, not a schema migration.

Migration safety:

- **Idempotent import**: snapshot the JSON file set before importing; re-running the import produces the same `store.db`. If interrupted, restart from scratch.
- **Concurrent writes during import**: the extension continues to accept new analyses while import runs. New writes go to a pending queue (still JSON, as today); the import snapshot excludes them; once import completes and the store atomically switches to SQLite, the queue drains into `store.db`. The user sees no interruption.
- **Rollback path**: the original JSON files are **not deleted** for one full release after the migration lands. A user who downgrades to the previous extension version can still read their old JSON store and keep working. Deletion of legacy JSON files happens in the release _after_ the migration is confirmed stable.
- **Schema stability**: `record_json` stores the existing `SessionRecord` JSON verbatim, `schemaVersion: 1` unchanged. No re-analysis needed.
- **Read-only JSON fallback**: `JsonFsStore` is kept as a read-only fallback during the release that ships the migration. If `store.db` is corrupt or unreadable, the extension falls back to reading JSON files and surfaces a warning. Removed in the following release.

### Migration 2: single-machine → team

User sets `agentMindmap.team.serverUrl`. On next activation:

1. Construct `RemoteStore`.
2. Run a one-shot "bulk push": iterate all local sessions, `POST` each. Server reconciles (upsert, last-write-wins).
3. Local `SqliteStore` is kept as the working copy (client still analyzes locally). Push queue takes over for incremental updates from here.

The client never deletes its local DB in team mode — it's the cache and offline buffer. Local-first with push is the default; a strict "server is source of truth" mode (no local writes) is out of scope for v1 — local-first is more robust to network blips and lets analysis proceed offline.

## Phased plan

| Phase | Scope                                                                                                                      | Ships                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1     | Introduce `Store` interface, port current code to `JsonFsStore` impl. No behavior change.                                  | Easier mocking in tests; foundation.                     |
| 2     | `SqliteStore` + JSON→SQLite migration. Single-machine mode uses SQLite.                                                    | Faster reads on large stores; one schema for both modes. |
| 3     | Go team HTTP service: Postgres schema, REST API, `pgx` driver. No MCP, no merge worker yet.                                | Server exists, testable via curl.                        |
| 4     | Extension wiring: team config, store selection, `RemoteStore` (TypeScript HTTP client), push queue, bulk migration.        | Team mode usable end-to-end (CRUD only).                 |
| 5     | Go merge worker (cron), concept-trie serving, equivalences. Go port of the trie-merge algorithm with fixture-parity tests. | Cross-session concept map in team mode.                  |
| 6     | Hardening: API key auth middleware (Go), rate limiting, audit logging, observability.                                      | Production-ready.                                        |

Phase 1 is pure refactor and can land immediately. Each later phase is independently shippable and revertable.

## Open design questions

These are MCP-server-side improvements that came out of a review of the current `mcp-server/` tooling. They are **not** team-mode-specific — they apply to both single-machine and team mode — but they interact with the team-mode design in places (embedding boundary, client/server split). Each is recorded here as an open question; decisions and PR placement are finalized in `TEAM_MODE_PR_PLAN.md` after discussion.

### Q1 — Use `codeReferences` as a retrieval signal, not just a render field

**Observation.** `SessionAnalysis.codeReferences` (path + lines + description + sourceTurnIndices) is populated by `extension/src/llm/extractCodeReferences.ts` — a **separate LLM call** from S1, triggered only when the transcript contains file-write operations (Write/StrReplace/EditNotebook/ApplyPatch/Delete). The `description` field summarizes _what the code in question does_ (e.g. "JWT verify with clock-skew leeway"), generated from the diff + turn context. This means:

- codeRef is **sparse by design** — only sessions that touched code have it; discussion-only sessions have none.
- codeRef description is an **independent semantic view** of the session, produced by a separate LLM pass focused on the diff. It often names the exact concept a user would query for, even when outline / concept / evidence text does not.
- `codeRef.sourceTurnIndices` links to specific turns, and turns link to outline `details[].sourceTurnIndices` → topic → `conceptPath` → concept. So codeRef → concept is a real, traversable many-to-many linkage (one codeRef can span multiple turns, each turn can appear in multiple topics).

Today the MCP retrieval path (`shared/src/searchIndex.ts`) ignores `codeReferences` entirely:

- `buildRecordTokenSets` builds the per-record pre-filter token set from `collectOutlineText` + `sessionLabel` + `conceptContexts` fields only. A record whose only match is in `codeReferences[].description` fails `recordCouldMatch` and is skipped before scoring.
- `searchProjectRecords` has no `codeReferences` branch in scoring. Even if a record passes the pre-filter on other text, a codeRef description match contributes nothing to the hit score.

**Question.** Should `codeReferences[].description` and `path` be added as a first-class retrieval signal so a query like "鉴权" or "jwt.ts" hits sessions whose code refs describe/name that, even when outline text doesn't? This is a retrieval-quality improvement, not a rendering change.

**Decided design**

1. **Both `path` and `description` enter retrieval, but with different tokenization.**
   - `description`: fed to `buildRecordTokenSet` for ngram tokens (same as outline/evidence), and scored via `scoreText` in the main scoring loop.
   - `path`: split on `/`, `.`, `_`, `-` into whole words (`src/auth/jwt.ts` → `src`, `auth`, `jwt`, `ts`), added as whole-word tokens only (no ngrams — avoids `sr`/`ut` noise from path characters). Whole-word path match scores high because a filename hit is a strong precise signal.

2. **New `SearchHit.kind = "code"`**, carrying `path`, `lines`, `description`, `sourceTurnIndices`. Reasons: codeRef is sparse (folding into `session` would let codeRef-heavy sessions crowd out outline/concept hits); a new kind lets `kindRank` weight code hits independently (code match ≈ precise, should rank high); the payload directly tells the agent which file matched, higher density than stuffing into `snippet`.

3. **Reverse concept boost.** When a codeRef scores above threshold, traverse `codeRef.sourceTurnIndices` → outline `details[].sourceTurnIndices` (same turn) → owning node's `conceptPath` → concept, and add a decayed boost to the matching concept hit. Must handle the many-to-many: one codeRef can map to multiple concepts. Proposed: `boost = codeRefScore * 0.3 / linkedConceptCount`, so a codeRef linked to 3 concepts gives each 0.1× — enough to lift an otherwise-tied concept, not enough to swamp a direct concept match.

4. **`diversifyHits` adds `MAX_HITS_PER_CODE = 2`** independent of `MAX_HITS_PER_SESSION`, so a session with many codeRefs cannot flood results. This caps code hits per session separately from outline/concept hits per session.

5. **Validation.** `retrievalEval.ts` gains two cases:
   - Query matches `codeReferences[].description` but not outline/concept/evidence (proves semantic complement).
   - Query is a filename fragment (proves precise path hit).
     Both must fail before the change and pass after.

**Sub-questions resolved**: path is searchable (decision 1); `sourceTurnIndices` does link to concept and is used for reverse boost (decision 3); new `SearchHit.kind` not fold-into-session (decision 2).

**Remaining open**: the `0.3` and `2` constants in decisions 3/4 are starting guesses; tune against the eval set once the implementation lands.

### Q2 — Make the MCP server discoverable / self-describing so agents know when to call it

**Observation.** MCP discovery relies on the client (Cursor / Claude Code) feeding the tool list + descriptions to the model; the model then decides whether to call. The only levers we have are (a) tool names, (b) tool `description` strings, (c) `server_info` content, and (d) the server's display name in the MCP install config. Current tool descriptions are mostly absent or phrased as "what this tool does" rather than "when to call this tool".

**Decided design**

1. **Three-part description structure for every tool.** Each `description` field follows: `<one-sentence function>. Use when <trigger scenario with examples>. Do NOT use for <negative case>.` This is the primary lever — the "Use when" / "Do NOT" semantic boundary matters more than example language for agent trigger accuracy.

2. **Description body is English-only.** Only the example queries are localized. Rationale: tool descriptions are agent instructions, not UI strings; agent models (Claude, GPT, etc.) recognize intent most reliably from English instruction text regardless of the user's query language. Translating the body to the user's locale would _lower_ trigger accuracy for non-English users, not raise it. The user's query language does not need to match the description language — modern agents map "我们之前怎么处理 X 的" to English "Use when user asks about past work" without trouble.

3. **Example queries localized per locale, alongside English.** The `Use when` clause includes example queries in the active locale plus English. Example for `search_project_history` under `zh-cn`:

   ```
   Search past session history by query (semantic + keyword matching).
   Use when the user asks about past work, decisions, or debugging in a project.
   Examples: EN "did we ever solve Y" / ZH "我们之前怎么处理 X 的" / "上次改 auth 是哪次 session".
   Do NOT use for current-file questions or live code lookup.
   ```

   If the active locale is `en`, only English examples appear. All 10 supported UI locales (`en`, `zh-cn`, `ja`, `ko`, `pt-br`, `es`, `de`, `fr`, `hi`, `id`) get their own example set.

4. **Locale propagation via a config file, not VS Code API.** The MCP server is a stdio subprocess launched by the client (Cursor / Claude Code), not by the extension — it has no access to `vscode.env.language` or `vscode.workspace.getConfiguration`. To bridge the locale:
   - The extension writes `~/.agent-mindmap/mcp-locale.json` (content `{"locale":"zh-cn"}`) whenever `resolveUiLocale()` is first computed and whenever the user changes `agentMindmap.ui.locale`. Reuses the existing `resolveUiLocale()` from `extension/src/l10n/uiTranslate.ts`.
   - The MCP server reads `mcp-locale.json` at startup to select the example-set language. Missing file or unreadable → fallback to `en`.
   - **No hot update**: changing `ui.locale` requires restarting the MCP server (re-launching the client process) to take effect on descriptions. Accepted trade-off — descriptions are static for a server's lifetime; hot-reloading would require runtime tool re-registration which the MCP SDK does not cleanly support.

5. **`server_info` gains a recommended call-flow line.** A short blurb: "Recommended flow: call list_projects first to discover slugs, then search_project_history or get_project_briefing for content. This server indexes past AI agent sessions (Cursor/Claude Code) analyzed by the Agent Mind Map extension." This gives agents a first-touch orientation when they probe the server.

6. **Per-tool trigger scenarios** (English body, examples omitted here — localized at render time):
   - `list_projects`: discover projects that have been analyzed. First step before other tools when the user mentions a project.
   - `get_project_briefing`: summarize recent sessions and key concepts of a project.
   - `list_project_sessions`: list sessions for a project, paged.
   - `search_project_history`: search past session history by query (semantic + keyword). The primary tool for "what did we do about X" questions.
   - `retrieve_project_memory`: retrieve condensed memory for a query — synthesis, not a session list.
   - `get_concept_detail`: detail for a specific concept key (typically called after another tool returned a conceptKey).
   - `get_session_outline`: render one session's outline (called when you have a sessionId).

**Not in scope**: localizing the `server_info` output or error messages. MCP output is agent-consumed markdown; agent models handle English output regardless of query language. Revisit if user-facing curl workflows become common.

### Q3 — Two-level retrieval: embedding (team mode) + text fallback (single-machine)

**Observation.** The user has a separate machine with an RTX 3090 running `bge-m3:latest`, usable for embedding. Current MCP search is token/concept-term based (`buildRecordTokenSets` + `buildConceptTermIndex` + deterministic scoring), entirely client-side. Semantic similarity would help for fuzzy queries ("登录失败相关的讨论") but not for exact keyword queries (`jwt.ts`).

**Boundary decision.** The 3090 is cross-machine from where the MCP server runs. Memory `project_mcp-local-rag-boundary.md` says MCP RAG must stay local — no external embedding API — _unless moved to a team service_. Putting embedding into the Go team service is exactly that豁免 path: the 3090 + bge-m3 becomes team infrastructure, not an external API the MCP client calls directly. This drives the placement decision below.

**Decided design — Route A: search moves to the team service in team mode**

1. **Embedding lives in the team service, not the MCP client.** The Go service owns the bge-m3 HTTP client and the embedding index. The MCP client never calls the 3090 directly. This satisfies the boundary: in team mode, embedding is part of the team service, not an external request from the MCP client.

2. **Single-machine mode skips embedding entirely.** No 3090, no team service → MCP client uses the existing `searchProjectRecords` text/token scorer unchanged. The single-machine path is the fallback level; team mode is the embedding level. This is the "two-level" split: level 1 (team) = hybrid embedding+token, level 2 (single-machine) = text-only.

3. **In team mode, the entire retrieval runs on the team service.** `RemoteStore` gains a `search(projectSlug, query, limit, opts)` method that calls a new Go endpoint `POST /v1/projects/:slug/search`. The Go service runs the full hybrid pipeline (embedding cosine + token scoring + diversify) and returns ranked `SearchHit[]`. The MCP client's `search_project_history` / `retrieve_project_memory` handlers, when in team mode, delegate to `Store.search()` instead of calling `searchProjectRecords` locally.
   - Rationale: hybrid scoring needs both signals over the same candidate set. Splitting token-search (client) and embedding-search (server) and merging client-side means two round-trips, inconsistent candidate sets, and no clean way to do `diversifyHits` across merged results. Doing both on the server keeps the hybrid pipeline coherent.
   - Cost: the Go service must re-implement `searchIndex.ts`'s token-scoring logic (ngram tokens, `weightedTerms`, `scoreText`, `diversifyHits`, `rerankHit`). This is a cross-language port like the trie-merge in P5.1, with fixture-parity tests asserting identical output to the TypeScript version on the same input records.

4. **The "search stays on client" principle in §Team service implementation is superseded.** That section currently says search/index/render/eval all stay in `shared/` on the client. With Q3 Route A, **search moves to the server in team mode**. Markdown rendering and retrieval eval stay on the client (they consume `SearchHit[]`, which the server returns; rendering doesn't need the raw records beyond what hits carry). The Go service gains a search module; the TypeScript `searchIndex.ts` stays as the single-machine implementation and the reference for the Go port's fixture-parity tests.

5. **Embedding granularity: per concept-context.** One vector per `ConceptContextForMerge` (built from `label + aliases + evidence`). Rationale: aligns with the existing concept-indexing structure; concept-level granularity is coarse enough to keep the index small (hundreds of vectors per project) and fine enough to disambiguate ("jwt" vs "session-store" concepts in the same project). Per-session is too coarse (one vector summarizes too much); per-outline-node is too fine (topic text is short, embedding quality drops).
   - Session-level similarity is derived: a session's embedding score = max (or top-k mean) of its concept embedding scores. This avoids storing per-session vectors while still letting embedding hits roll up to sessions in `diversifyHits`.

6. **Embedding index storage (Go/Postgres).** New table `embeddings(project_slug TEXT, concept_key TEXT, model TEXT, vector BYTEA, built_at BIGINT, PK(project_slug, concept_key, model))`. `vector` is 1024 × float32 = 4096 bytes, stored as `BYTEA` (not JSONB — avoid float parsing overhead). Rebuilt by the Go merge worker (P5.x) when a project's revision changes; `model = "bge-m3"` for v1. The worker batches concept texts to the bge-m3 endpoint in one HTTP call per project rebuild.

7. **Hybrid scoring.** Final hit score = `α * embedding_score + (1-α) * token_score`, with `α = 0.5` as the starting default. Embedding score is cosine similarity normalized to `[0,1]`; token score is the existing `searchProjectRecords` score normalized by the max token score in the candidate set (so the two scales are comparable). Tunable via server config `AGENT_MINDMAP_EMBEDDING_ALPHA`.
   - For exact-keyword queries (filename `jwt.ts`, identifier `verifyToken`), token score dominates and embedding is a tiebreaker.
   - For fuzzy conceptual queries ("登录失败相关的讨论"), embedding score dominates.
   - The `diversifyHits` caps (`MAX_HITS_PER_SESSION`, `MAX_HITS_PER_CONCEPT`, and the new `MAX_HITS_PER_CODE` from Q1) apply to the merged hybrid hits, unchanged.

8. **Validation.** `shared/src/retrievalEval.ts` must show the team-mode hybrid pipeline beats the text-only baseline on hit-rate / recall. Because the Go service re-implements the token scorer, the eval runs against the Go endpoint in team mode (via `RemoteStore.search`) and against the TypeScript `searchProjectRecords` in single-machine mode. Fixture-parity tests (same input → same output) cover the token-only portion; eval covers the hybrid improvement.

**Configuration.** New team-service env vars: `AGENT_MINDMAP_EMBEDDING_ENDPOINT` (bge-m3 URL, e.g. `http://3090-host:port/embed`), `AGENT_MINDMAP_EMBEDDING_MODEL` (default `bge-m3`), `AGENT_MINDMAP_EMBEDDING_ALPHA` (default `0.5`). If `AGENT_MINDMAP_EMBEDDING_ENDPOINT` is unset, the team service falls back to text-only search (same as single-machine) — embedding is opt-in per deployment, not required for team mode to function.

**What does NOT change.**

- Single-machine mode: zero change. `searchProjectRecords` stays in `shared/`, used directly by the MCP client.
- Markdown rendering (`markdownRender.ts`): unchanged. Still runs on the client, consumes `SearchHit[]`.
- Retrieval eval harness: unchanged in structure; gains team-mode cases that hit the Go endpoint.

### Q4 — `CodeReference` `markCode` (verbatim snippet) + staleness verification

**Observation.** `CodeReference` (`shared/src/llmTypes.ts:190`) today carries `path`, `lines`, `description`, `sourceTurnIndices`, and LLM-enrichment bookkeeping. `description` is a **summary** of what the referenced code does (e.g. "JWT verify with clock-skew leeway"), produced by the LLM from the diff + turn context. There is no verbatim record of the code itself, so nothing on disk can be checked against the reference: a "相关代码" entry can silently rot — the file may be deleted, moved, or edited past recognition — and the mind map will still present it as live. The MCP server (`mcp-server/src/handlers.ts`) currently has no file-read capability at all; it only reads the on-disk store, never the user's source tree.

**Question.** Should `CodeReference` carry a **`markCode` field that is a verbatim code snippet** (a string copied character-for-character from the code the LLM was asked to analyze — **not** LLM-generated, **not** keywords extracted from it), and should the MCP server gain the ability to read the local repo file and verify the snippet — marking the reference **stale** when the file is missing or the snippet is no longer present?

> **Naming note** (user-stated 2026-06-21): the field is called **`markCode`**, not `evidence`. The `evidence` name is already in use on unrelated types (`SessionTermAlias`, `ConceptOntologyNode`, `schemaTrie`) for term/domain evidence strings; reusing it for a code snippet would conflate two different concepts. `markCode` reads as "the code we marked / pointed at".

**Decided design** (user-stated constraints, 2026-06-21)

1. **Add `markCode: string` to `CodeReference`.** The value is a **verbatim code snippet** taken from the code the LLM was given as input at analysis time — the actual source text the LLM looked at when generating the `description`, **not** the LLM's output, **not** a summary, **not** extracted keywords. Concretely: `markCode` = the raw `Write.contents` / `StrReplace.new_string` (or, for read-only references, the relevant file slice) that the existing `buildWriteInfoMap` already extracts from the transcript's file-write events. This is distinct from the `evidence: string[]` field that already exists on `SessionTermAlias` / `ConceptOntologyNode` / `schemaTrie` — those are term/domain evidence strings, not code; do not conflate.

2. **The MCP server gains a file-read + snippet-match capability.** It resolves `CodeReference.path` against the **local clone of the repo** (workspace mode: against the workspace folder; repo mode: against the repo root — see Q5 for how the local clone is resolved from the project slug), reads the file, and checks whether the `markCode` snippet is present in the file.

3. **Staleness rule (three-state).** `staleness: "fresh" | "stale" | "unknown"` (computed on-read per open sub-question 2's resolution):
   - **`fresh`**: the local path for the slug resolves (workspace folder / repo clone is mapped in `paths.json`) AND the file at `CodeReference.path` exists AND **every** effective line in `markCode` is present as a substring in the file content.
   - **`stale`**: the local path resolves AND **either** (i) the file at `CodeReference.path` does **not** exist (file deleted / moved — this is real rot, surface it), **or** (ii) the file exists but at least one effective line in `markCode` is **not** present as a substring (the snippet was edited).
   - **`unknown`**: the local path does **not** resolve (slug missing from `paths.json` — repo not cloned on this machine, or `paths.json` not refreshed, or workspace folder removed) **OR** `markCode` is an empty array after filtering (Q4.1 edge case — entire write op was discarded lines; nothing to match against). Either condition means staleness cannot be judged; it is not rot. The `paths.json` miss case additionally triggers the Q5 rule 8 VS Code notification ("slug not found, run Refresh Repo Paths") — the notification handles the mapping problem, `unknown` handles the per-`CodeReference` staleness verdict so it is not misreported as `stale`.

4. **Stale references are surfaced, not silently dropped.** The mind map and search results must indicate that a "相关代码" entry has rotted (e.g. a `stale: true` flag on `CodeReference` / `SearchHit.kind = "code"`, rendered with a strikethrough or warning marker). The user wants to see decay, not have it hidden.

5. **`markCode` source + LLM-prompt impact (resolved 2026-06-21).** `markCode` is **not** produced by the LLM. The existing codeRef LLM flow (`extension/src/llm/extractCodeReferences.ts`) already reads the written code from the transcript — `FileEntry.contentSnippet` is populated in `buildWriteInfoMap` from `ev.contentSnippet` on `Write` / `StrReplace` tool calls, and that snippet is already passed to the LLM as input (`code snippet: ${snip}`) when asking the LLM to produce the `description`. **The existing codeRef LLM prompt is NOT changed.** The LLM continues to output only `description` (≤60 chars); `markCode` is captured alongside, from the same raw event data the prompt already reads, and stored verbatim on the `CodeReference`.
   - **Critical implementation note:** the current code collapses whitespace before feeding the snippet to the prompt — `snippet.replace(/\s+/g, " ").slice(0, 300)`. This collapsing **breaks verbatim substring matching** (Q4 staleness), so `markCode` must be captured from the **raw, uncollapsed** `Write.contents` / `StrReplace.new_string` **before** that normalization runs. The prompt's own collapsed-truncated snip is a separate concern (cosmetic input formatting for the LLM) and is unaffected.
   - **Size cap (resolved 2026-06-21):** `markCode` is capped at **2000 characters**. Truncation happens on a **complete-line boundary** — if the 2000-char cut falls mid-line, extend to the end of that line (preferred) or trim back to the previous newline; never leave a half-line. Rationale: a snippet cut mid-line will fail the verbatim substring match at the truncated edge, producing false "stale" verdicts. The 2000-char cap is a reasonable default; large write ops that exceed it carry their head as the mark (most identifying — function signatures, top-of-block statements).
   - **Comment-content preference (user-stated 2026-06-21):** prefer **actual code** over comments where the source write op allows a choice. In practice this is a soft guideline — `Write.contents` / `StrReplace.new_string` are taken verbatim, and if the agent wrote a comment-heavy file, that's what the transcript recorded. No post-hoc comment-stripping is applied (would risk breaking verbatim match against the on-disk file). The guideline mainly informs future refinements (e.g. if the write op is a multi-line diff, prefer the line range covering code over the line range covering comments when both exist).
   - **Pipeline-version impact:** because `markCode` is a new field on `CodeReference`, existing `SessionRecord`s in the store lack it. Whether to bump `PIPELINE_VERSION` (forcing LLM re-analysis to repopulate) or to populate `markCode` via a lighter local re-parse of the transcript's write diffs (no LLM call, since the verbatim source is already in the diff) is **open sub-question 6** — the answer is no longer "must bump because the prompt changed" (the prompt does NOT change), only "do we want the field back-filled for old sessions, and if so how".

6. **`markCode` storage shape + matching procedure (resolved 2026-06-21).** `markCode` is stored as a **`string[]` of effective lines**, NOT a single string. Construction, in order:
   - (i) Take the raw `Write.contents` / `StrReplace.new_string` (verbatim, uncollapsed — see item 5).
   - (ii) Truncate to the **2000-char cap** on a **complete-line boundary** (extend to end of line if the cut falls mid-line, or trim back to the previous newline; never leave a half-line).
   - (iii) Split on newlines.
   - (iv) For each line: **trim** leading/trailing whitespace, then decide whether it is an **effective line** or a **discarded line**. A line is **discarded** if, after trimming, it satisfies ANY of: (1) empty; (2) length < **3**; (3) contains no Unicode letter and no Unicode digit (i.e. the trimmed line is composed solely of punctuation/symbols/whitespace — this drops `}` `});` `===` `=>` `/**/` etc. in one rule, and naturally keeps CJK-identified lines since CJK characters are Unicode letters). Effective lines are kept in their original order.
   - The stored `markCode` value is the array of effective lines (post-trim). Discarded lines do not participate in staleness matching.
   - **Matching procedure** (MCP server): read the file content as-is (no global normalization — no CRLF→LF, no indentation strip, no whitespace collapse). For **each** effective line in `markCode`, perform a **substring match** against the file content (the trimmed line must appear as a substring somewhere in the file). **All effective lines match → fresh; any one effective line missing → stale.** No normalization is applied to the file content — the per-line substring relation is naturally tolerant of: indentation offset (a trimmed markCode line `a = b + c;` is a substring of the file's `    a = b + c;`), CRLF vs LF (the markCode lines carry no newline characters, so line-ending differences cannot break the match), and line reordering (each line is checked independently).
   - **Not recorded on the `CodeReference`:** the normalization/matching choice is an MCP-server implementation detail; it is not versioned per-record. Single implementation, single behavior.
   - **Known cost (accepted):** if every effective line of a `markCode` happens to still appear somewhere in the file (e.g. the snippet was broken up and scattered) but the snippet as a whole was effectively edited, the verification reports `fresh` (false negative for staleness). Rare; semantically "the lines still exist somewhere" is a weak form of freshness — acceptable.
   - **Edge case → Q4.3:** if after filtering, `markCode` is an **empty array** (the entire write op was discarded lines — pure punctuation / very short lines), staleness cannot be judged. Treatment is **`unknown`** (resolved 2026-06-21, see Decided design item 3).

**Open sub-questions** (pending discussion)

1. **Snippet-match normalization.** ~~How aggressively to normalize before the substring match?~~ **RESOLVED 2026-06-21 — see Decided design item 6.** `markCode` is stored as `string[]` of effective lines; matching is per-line substring (no global normalization; CRLF/LF/indentation tolerated by construction; lines shorter than 3 chars or containing no letter/digit are discarded before matching).

2. **Verification timing.** ~~When is staleness checked?~~ **RESOLVED 2026-06-21 — On-read.** The MCP server computes staleness **inline every time it returns a `CodeReference`** (in `get_session_outline`, `search_project_history` code hits, etc.); it is **not persisted** to the store.
   - **Computation path per `CodeReference`**: read `workspace-paths.json` / `repo-paths.json` (read-on-miss, see Q5 rule 8) → resolve `CodeReference.path` against the mapped folder → stat + read the file → per-line substring match (Q4.1) → return `fresh` / `stale` / `unknown`.
   - **`staleness` is a response-time derived field**, not a stored field. The store-side `CodeReference` carries only `markCode` (the stored evidence); `staleness: "fresh" | "stale" | "unknown"` is attached to the response payload by the MCP server at read time. No `verifiedAt`, no `stale` flag, no store-schema migration, no sweep, no extension-side `onDidSaveTextDocument` incremental recompute.
   - **In-response dedup optimization (allowed, does not change semantics)**: when a single response returns multiple `CodeReference`s pointing at the **same `path`**, the MCP server reads that file once and reuses the content for all matching checks in that response. A search returning 50 hits across 5 distinct files → 5 file reads, not 50.
   - **Accepted cost**: every code hit triggers ≥1 file read; repeated queries on the same file re-read it. Acceptable because (i) mind-map rendering frequency in the IDE is low, (ii) the OS file-system cache absorbs most of the re-read cost, (iii) the implementation surface is dramatically smaller than hybrid/sweep (no migration, no background job, no flag lifecycle).
   - **Rationale for on-read over hybrid/sweep (user-stated 2026-06-21)**: simplicity wins. A sweep + `verifiedAt` flag would force a store-schema migration and a background job whose correctness has to be reasoned about (race with concurrent writes, missed sweeps after sleep, etc.); the on-read model has none of that, and staleness is always as-fresh-as-the-last-read with no lag window.

3. **Local clone absent.** ~~Three-state model needed.~~ **RESOLVED 2026-06-21 — see Decided design item 3.** Three states: `fresh` / `stale` / `unknown`. Path resolves + file missing → `stale` (real rot). Path does not resolve (slug missing from `paths.json`) → `unknown` (repo not on this machine; not rot). `markCode` empty array → `unknown` (cannot judge). The `paths.json`-miss case additionally fires the Q5 rule 8 VS Code notification, so the mapping problem is surfaced separately from the per-`CodeReference` staleness verdict.

4. **Surfacing staleness in `SearchHit`.** ~~Does a stale code reference still surface as a `"code"` hit?~~ **RESOLVED 2026-06-21 — yes, always surface; staleness is a tag, not a filter.** Stale / unknown code references are **never excluded or demoted** from search results — they always enter the result set as `SearchHit.kind = "code"`. The `staleness: "fresh" | "stale" | "unknown"` field is attached to each code hit as a **tag**; the frontend renders stale/unknown hits with a warning marker (strikethrough / different color), and on click does NOT auto-jump to the file if `staleness !== "fresh"` (surfaces a "this code reference is stale/unknown" notice instead, or offers a best-effort jump). Rationale: a stale hit answers "did we ever touch code like this?" — the answer is yes, and the fact that it rotted is itself the information the user wanted. Excluding or burying stale hits hides decay, violating Q4's surface-don't-drop principle. No sort-order demotion (no assumption that fresh is more relevant than stale — the user may be searching _because_ they suspect the code is gone).

   **Architecture (decided 2026-06-21): staleness is computed/back-filled by the MCP server on its response path, in BOTH modes; the team service never participates in staleness.**

   - **Single-machine mode**: MCP server queries the local SQLite store itself → computes `staleness` inline for each code hit (same on-read path as `get_session_outline`, Q4.2) → returns hits with `staleness` populated.
   - **Team mode**: Go team service holds the cross-member aggregated KB and runs the **text match** (against `description` / `markCode` text) → returns `SearchHit` (`kind = "code"`) to the MCP server. **The team service has no source code and does NOT compute staleness** — the `SearchHit` it returns either omits the `staleness` field or carries it as `null`. The MCP server (running on the member's local machine, where the repo clone lives) **back-fills** `staleness` for each hit by resolving `CodeReference.path` against `workspace-paths.json` / `repo-paths.json` and running the Q4.1 per-line match → returns hits with `staleness` populated.
   - **Unified model**: in both modes, the MCP server is the single place where `staleness` is computed and attached to the response. The only difference is the data source for the hits — local SQLite (single-machine) vs team-service HTTP response (team). The team service's `SearchHit` schema does NOT include a meaningful `staleness` field; it is a field the MCP server adds/populates on its response path.
   - **Cost in team mode**: the MCP server still does the same per-hit file reads as in single-machine mode (Q4.2 on-read cost applies identically). The team service doing the text match first does not reduce the MCP server's file-read work — it only shifts _which_ hits need staleness (the matched subset) vs. the whole store.
   - **Implication for team-service API**: the `search_project_history` response from the team service returns `SearchHit` objects without `staleness`; the MCP server's own `search_project_history` response (the one agents/IDE call) returns `SearchHit` objects WITH `staleness`. The MCP server's response schema is a superset.

5. **`markCode` size + source (RESOLVED 2026-06-21 — see Decided design item 5).** `markCode` = the raw `Write.contents` / `StrReplace.new_string` (the code the LLM was given as input), captured **before** the existing whitespace-collapse + 300-char truncation that the prompt applies to its own input. Capped at 2000 chars with complete-line truncation. The existing codeRef LLM prompt is **not** changed; the LLM continues to emit only `description`.

6. **Re-analysis vs. re-verification on prompt bump.** ~~Back-fill `markCode` for existing `SessionRecord`s?~~ **RESOLVED 2026-06-21 — no back-fill needed.** The MCP server (and the `markCode` field itself) has not shipped yet — this is still internal development. There are no "legacy sessions analyzed before `markCode` existed" in any real user's store, so there is nothing to migrate. If a `CodeReference` lacks `markCode` for any reason (e.g. a session analyzed during dev before the field was populated), staleness simply reports **`unknown`** per Q4.3's three-state rule — the natural fallback, no special handling. No `PIPELINE_VERSION` bump, no migration command, no store-level `schema_version` bookkeeping. If a real back-fill need ever appears post-ship (e.g. a future schema change adds another field), revisit then.

### Q5 — Project slug from normalized repo URI; `CodeReference.path` relative to repo root

**Observation.** The `projectSlug` that keys `SessionRecord` and the team service's `projects` table is currently **path-based**: Cursor uses `workspaceToSlug(workspacePath)` (`extension/src/host/cursorHost.ts:53`), Claude uses `path.basename(dirname)` (`extension/src/host/claudeHost.ts:131`). The same repo cloned to `/home/alice/repo` on member A's machine and `/home/bob/code/repo` on member B's produces **two different slugs**, so their sessions don't aggregate in the shared team KB. Directory renames change the slug on a single machine too. Separately, `CodeReference.path` is today relative to the **workspace root**, but the workspace root differs from the repo root when the workspace contains multiple sibling repos (as `agent-mindmap-projects/` does today: `agent-mindmap`, `agent-mindmap-team-service`, `agent-mindmap-schemata` sit side by side, each its own git repo).

**Question.** Should `projectSlug` be derived from the **git remote URI**, normalized to strip the protocol and network address so that different transports for the same repo collapse to one slug? And should `CodeReference.path` be **relative to the repo root** (not the workspace), so the MCP server can resolve it against the local clone of that repo?

**Decided design** (user-stated constraints, 2026-06-20 and 2026-06-21)

The slug-derivation rule and the `CodeReference.path` base are governed by one user-facing setting, **`agentMindmap.project.mode`** (values: `workspace` | `repo`), rather than by single-machine vs team mode. The same concept covers both modes: "in which directory is this project rooted?" `workspace` answers "the current workspace folder" (user intuition); `repo` answers "the git repository this folder belongs to" (cross-machine stability). Team mode implies `repo`; the two settings are otherwise independent.

1. **`agentMindmap.project.mode` setting.** The unit of project identity is the **workspace folder** — what the user opened. The extension does not scan inside a folder for nested repos; "the folder is the project".
   - **`workspace`** (default, backward-compatible): `projectSlug` is derived from the workspace folder path (current behavior — Cursor `workspaceToSlug(workspacePath)`, Claude `path.basename(dirname)`). `CodeReference.path` is relative to the workspace folder. No git dependency, no `repo-paths.json`. This is the zero-surprise default: a user opening a folder gets exactly the slug they got before.
   - **`repo`**: `projectSlug` is derived from the git remote `origin` URL of the **workspace folder itself** (normalized, see rule 2). `CodeReference.path` is relative to the **repo root** (= the workspace folder). The extension maintains a `repo-paths.json` mapping (see rule 4) so the MCP server can resolve repo-relative paths against the local clone. **Two prerequisites** (user-stated 2026-06-21, both must hold for EVERY workspace folder): (a) the workspace folder is a git repo with `git config --get remote.origin.url` resolving to a value; (b) **the workspace folder IS the repo root** (`git rev-parse --show-toplevel` == workspace folder path). **Hard error on failure** (rule 10): if ANY workspace folder fails either prerequisite, repo mode refuses to run — the extension surfaces an error naming the failing folder(s) and reason, and the user must fix the folder (git init / add origin / open the repo root) or switch to `workspace` mode. There is **no soft fallback** to workspace slugs in repo mode. Rationale (user-stated 2026-06-21): repo mode is an explicit user choice; a folder not meeting the prerequisites is a configuration error, and silently falling back would hide it — the user-stated principle is "surface, don't silently degrade". This also covers the case where a folder's git info was deleted after repo mode was enabled (e.g. user removed `.git` or `origin`): the next activation/check surfaces the error rather than letting stale repo-slug sessions accumulate. **No subdirectory scanning**: a non-git workspace folder (e.g. `agent-mindmap-projects/` containing sibling repo subdirs) does NOT get its child repos recognized; the folder fails prerequisite (a) and repo mode errors. A user who wants a specific repo's identity opens that repo's root folder directly.

2. **Normalization rule (repo mode): strip protocol + host, keep `org/repo.git`.** Drop the scheme (`http://`, `https://`, `ssh://`, `git://`), drop `host:port`, drop the `user@` scp-style prefix; keep everything after the host, **including the trailing `.git`**. Worked examples:
   - `http://192.168.1.70:2000/ailab/agent-mindmap.git` → `ailab/agent-mindmap.git`
   - `gogs@192.168.1.70:ailab/agent-mindmap.git` → `ailab/agent-mindmap.git`
   - `ssh://git@github.com:22/org/repo.git` → `org/repo.git`
   - `https://github.com/org/repo.git` → `org/repo.git`
     The goal: the same repo reachable via multiple URIs (http vs gogs@ vs ssh) collapses to **one** slug. Without this, sessions from the same project fragment across team members who cloned via different transports. The trailing `.git` is **kept** so repo slugs never collide with workspace slugs (which never end in `.git`).

3. **Team mode implies repo mode + strict folder validation.** Setting `agentMindmap.team.serverUrl` requires `agentMindmap.project.mode = repo`. A cross-machine team KB is only meaningful when slugs are repo-derived; path-based slugs fragment across machines by construction. If a user sets `serverUrl` while still in `workspace` mode, the extension surfaces a **guidance prompt** (not a hard error): "团队模式需要仓库模式的项目身份，是否切换？（会重新键入本地记录）". Yes → switch to `repo` mode + run the one-shot re-key migration (rule 5), then proceed to folder validation. No → team mode is not enabled, single-machine behavior continues.

   **Team-mode strictness = repo mode strictness + cross-member consistency (user-stated 2026-06-21).** Since repo mode itself is already strict (rule 1: every workspace folder must satisfy both prerequisites, hard error on failure, no fallback), team mode does not add a _per-folder_ validation on top — that's already enforced by repo mode. What team mode adds is the **cross-member requirement**: all team members must be in repo mode (so slugs are repo-derived and aggregate across machines). The team-enable flow: (1) user sets `serverUrl` while in `workspace` mode → guidance prompt to switch to repo mode + re-key (rule 5); (2) switching to repo mode runs rule 1's prerequisite check — if any folder fails, repo mode errors and team mode cannot proceed (same error as rule 10); (3) once repo mode is running, team mode enables. There is no separate "team folder validation" step distinct from repo mode's. Multiple workspace folders are supported (each repo-root folder pushes under its own repo slug). No subdirectory scanning (rule 1): a non-git folder with repo children fails repo mode, hence fails team mode. A user with the `agent-mindmap-projects/` layout who wants team mode opens the specific repo root folder(s) (`agent-mindmap/`) as workspace folders, not the parent.

   Constraint chain summary: `workspace` mode → no repo-uri check (slug from folder path). `repo` mode → EVERY workspace folder must be a git repo with `origin` AND be the repo root; failure = hard error, no fallback (rule 10). `team` mode → all members in `repo` mode (which already enforces per-folder validity); team adds cross-member consistency only. In all three, the folder is the unit — no subdirectory scanning.

4. **`repo-paths.json` mapping (repo mode only).** The extension maintains `~/.agent-mindmap/repo-paths.json`, a `{repoSlug → localClonePath}` map, written at activation and whenever workspace folders change. For **each workspace folder** that is a git repo with `origin`, the extension reads `git config --get remote.origin.url`, normalizes to a slug, and records `{slug: folderPath}`. **No subdirectory scanning** — only the workspace folder itself is considered. If two workspace folders resolve to the same slug (e.g. two worktrees of one repo both added as workspace folders), first-seen wins in workspace-folder order (see rule 9). The MCP server reads `repo-paths.json` at startup and on slug-lookup miss (see rule 8); it never scans the filesystem itself — the extension owns the scan because it knows the workspace folders, the MCP stdio subprocess does not. This mirrors the Q2 locale-file pattern (extension writes, MCP reads).

5. **One-way re-key migration.** Switching `project.mode` from `workspace` to `repo` (manually, or via the team-mode prompt in rule 3) triggers a one-shot local re-key: each existing `SessionRecord` under a workspace slug is re-keyed to its repo slug. **`CodeReference.path` is NOT rewritten** — because repo mode requires the workspace folder to be the repo root (rule 1 prerequisite b), the workspace-relative and repo-relative path bases are identical, so paths are already correct. The re-key only changes the `projectSlug` primary key. Transactional details, backup, fallback-folder handling, and recovery are in rule 11. Progress is shown via a VS Code progress notification. After re-key completes, **`workspace` mode is no longer offered for that store** — the migration is intentionally one-way. Rationale (user-stated 2026-06-21): allowing back-and-forth re-keying creates slug confusion (two valid slugs for the same records, ambiguous which is "current"), and the user prefers a clean one-directional transition. A user who genuinely needs to revert can delete the store and re-import from JSON backups (or the pre-rekey backup from rule 11), but no in-product revert button is provided. Team-mode bulk push (Migration 2) is the natural place to re-key on the server side — the server never sees the old workspace slug.

6. **`projects.project_path` column semantics.** In `workspace` mode, `project_path` stores the workspace folder path (current behavior). In `repo` mode, `project_path` stores the **local clone path** the repo slug was derived from (for display / fallback). This is a usage note, not a schema change.

7. **`workspace` mode staleness coverage (resolved 2026-06-21).** `workspace` mode is single-machine only (team mode implies `repo`), so the staleness rule is simple and local: **file not found under the workspace-mapped path → stale, no fallback lookup.** The mechanism mirrors `repo` mode symmetrically:
   - The extension maintains `~/.agent-mindmap/workspace-paths.json` (`{workspaceSlug → workspaceFolderPath}`), written at activation. No git scan needed — the workspace slug and folder path are both already known to the extension.
   - The MCP server reads `workspace-paths.json` (same read-on-miss pattern as `repo-paths.json`), resolves `CodeReference.path` (workspace-relative) against the workspace folder, reads the file, and verifies the `markCode` snippet per Q4.
   - **Coverage by workspace shape:**
     - Workspace folder is a git repo (folder == repo root): full staleness support. (`workspace` mode here behaves like `repo` mode for staleness — the path base is the same folder — the difference is only the slug derivation.)
     - Workspace folder is non-git but contains repo subdirectories (e.g. `agent-mindmap-projects/` with sibling repo subdirs): full staleness support — `CodeReference.path` is workspace-relative (e.g. `agent-mindmap/extension/src/host/cursorHost.ts`), so resolving against the workspace folder finds the file. The child repos are not recognized as separate projects in `workspace` mode (no subdirectory scanning, rule 1), but staleness still works because paths are workspace-relative. This is **not** a degraded case for staleness.
     - Workspace folder is a subdirectory of a repo (rare): paths resolve correctly relative to the folder; if a referenced file is outside the folder, it's stale. Acceptable.
   - **No cross-mode lookup.** When a file is not found under the workspace-mapped path, it is **stale** — the MCP server does **not** fall back to `repo-paths.json` to check whether the file still exists in some repo clone. Rationale (user-stated 2026-06-21): `workspace` mode's semantics are "the workspace is the project's view"; a file leaving that view is stale, by design. Cross-mode lookup would add complexity for little benefit, and `workspace` mode is single-machine only so there's no cross-machine ambiguity to resolve.
   - This means `workspace` mode and `repo` mode have **symmetric staleness mechanisms** (each has its own paths map; MCP server lookup logic is identical apart from which map it reads), differing only in how the slug and the map entries are derived.

8. **`paths.json` refresh cadence (resolved 2026-06-21).** Two layers, both kept simple — no `fs.watch` anywhere.

   **Extension side (rewrites the map file):**
   - Rewrite `workspace-paths.json` and/or `repo-paths.json` at activation, and on `vscode.workspace.onDidChangeWorkspaceFolders`.
   - **Do not watch subdirectories.** Subdirectory changes are irrelevant (rule 1: no subdirectory scanning). The map only changes when workspace folders are added/removed or when a folder's `git remote.origin.url` changes — the former is covered by `onDidChangeWorkspaceFolders`, the latter is low-frequency and covered by the manual refresh command below.
   - **Manual refresh command** as the escape hatch: `agentMindmap.refreshRepoPaths` ("Agent Mind Map: Refresh Repo Paths"), rewrites both map files on demand. Surfaces in the command palette. Use case: user changed a folder's `origin` remote (e.g. switched a clone from http to ssh transport, changing the normalized slug) and doesn't want to restart the host.

   **MCP server side (reads the map file):**
   - Load the relevant map (`workspace-paths.json` in `workspace` mode, `repo-paths.json` in `repo` mode) into memory at startup.
   - **On every slug-lookup miss, re-read the map file from disk** and retry the lookup. Rationale (user-stated 2026-06-21): the map file is small (tens of entries), the read cost is negligible, and re-reading on every miss means the manual-refresh command takes effect without an MCP restart. A "read once then cache misses for the process lifetime" strategy would defeat the manual-refresh escape hatch.
   - **If the re-read still does not contain the slug, surface a VS Code notification** (via the extension — the MCP server signals back to the extension, or the extension polls MCP server status) reporting that the project's local clone path could not be resolved. The notification should name the missing slug and suggest running "Refresh Repo Paths" (if `repo` mode) or checking the workspace folder (if `workspace` mode). This makes a missing mapping visible rather than silently degrading to "stale" / "unknown" — the user-stated intent is that mapping problems are surfaced, not hidden (consistent with Q4's "surface staleness, don't silently drop").

   **No `fs.watch`.** Explicitly rejected: MCP server is a stdio subprocess with a lifecycle controlled by the client (may be restarted frequently), `fs.watch` cross-platform behavior is inconsistent, and the read-on-miss pattern already covers "map updated → next query sees new data". The complexity of watch is not justified.

9. **Scan scope + same-slug tie-break (resolved 2026-06-21).**

   **Scan scope: workspace folders only, no recursion.** The extension considers only the workspace folders themselves (what the user opened). It does **not** scan subdirectories. A workspace folder is a candidate iff it is a git repo with `origin`. Non-git folders and their children are not scanned. Rationale (user-stated 2026-06-21): keep it simple — "the folder you opened is the project"; current git remote is what it is. No workspace-external clones, no `agentMindmap.project.repoPaths` override (YAGNI).

   **Same-slug tie-break (multiple workspace folders, one repo).** The only collision case is when the user has added two workspace folders that resolve to the same repo slug — e.g. a main clone + a worktree, or two clones of the same repo. The map is `{slug: path}` single-valued, so first-seen wins. Order: **workspace folder order** (the order VS Code reports `workspace.workspaceFolders`), first match wins; subsequent folders with the same slug are **logged at info level** (so the user can see "slug X also matched folder Y, but folder Z won") but **not written**. No subdirectory ordering is involved (subdirectories aren't scanned).

   **Worktrees.** A git worktree's `git config remote.origin.url` returns the same URI as its main clone, so two workspace folders pointing at the main clone and a worktree collide on slug. First-seen (workspace folder order) wins. No special handling.

   **No escape hatch.** If the user wants a specific folder to win, the only lever is workspace folder order (reorder folders in VS Code) or removing the losing folder from the workspace. There is no config to force a particular path. Documented as a known limitation.

10. **Repo-mode prerequisite enforcement — hard error, no fallback (resolved 2026-06-21).** `repo` mode's contract: EVERY workspace folder must satisfy both prerequisites (rule 1: git repo with `origin` AND folder == repo root). Failure is a **hard error** — repo mode refuses to run. There is **no soft fallback** to workspace slugs in repo mode (the earlier Case A/B soft-fallback design is superseded). Rationale (user-stated 2026-06-21): repo mode is an explicit user choice; a folder not meeting the prerequisites is a configuration error, and silently falling back would hide it — violating the "surface, don't silently degrade" principle. This also covers post-enablement breakage: if a user enabled repo mode when the folder was valid, then later deleted `.git` or removed `origin`, the next activation/check surfaces the error rather than letting stale repo-slug sessions accumulate against a folder that no longer has a derivable slug.

    **Failure handling.** At activation (and on workspace-folder change, and before any re-key), the extension checks every workspace folder against both prerequisites. If ANY folder fails, repo mode does not run:
    - The extension surfaces an **error notification** naming each failing folder and its specific failure: "仓库模式无法启用，以下工作区不满足要求：[folder: 非 git 仓库 / 无 origin remote / 非 repo 根]。请修正（git init / 添加 origin / 打开 repo 根目录）或切换到工作区模式。"
    - The extension **does not analyze sessions, does not write to the store, does not push** while in this error state. The user must fix the folder(s) or switch `agentMindmap.project.mode` to `workspace`.
    - The `agentMindmap.project.mode` setting is **not rewritten** (user's intent preserved for next launch once fixed).
    - Existing sessions already in the store (from before the breakage) remain readable for rendering via the stored `record_json`, but staleness verification (Q4) cannot run for the failing folder (no resolvable path base) — those `CodeReference` entries surface as stale/unknown per Q4's rules, NOT re-verified.

    **Git binary unavailable** (machine has no git, or git not on PATH): treated as every folder failing prerequisite (a). Same hard error as above — repo mode refuses to run, error notification names the cause as "git 不可用". The user installs git or switches to workspace mode.

    **Session ownership rule (user-stated 2026-06-21).** A session belongs to the slug of the **workspace folder it was analyzed under**. Because repo mode hard-errors on any failing folder, sessions are only ever analyzed when all folders pass — so in repo mode, every session's slug is the normalized repo URI slug of its folder. In workspace mode, every session's slug is the workspace folder slug. There is no mixed state.
    - **No sub-repo guessing.** When a workspace folder is itself non-git but contains git-repo subdirectories (e.g. `agent-mindmap-projects/` containing `agent-mindmap`, `agent-mindmap-team-service`, `agent-mindmap-schemata`), the folder fails prerequisite (a) and repo mode errors — the extension does not scan subdirectories (rule 1) and does not infer "which sub-repo did this session touch" from transcript content. Rationale (user-stated 2026-06-21): such inference is unreliable, and "the folder you opened is the project" is the intuitive contract. A user who wants a session under a specific repo slug opens that repo's root folder directly (`agent-mindmap/`), not the parent. (In workspace mode, the parent folder's sessions use the parent's workspace slug — staleness still works because `CodeReference.path` is workspace-relative and carries the child-repo prefix; the child repos are just not recognized as separate projects.)
    - `CodeReference.path` base follows the session's owning slug's mode: workspace slug → path relative to workspace folder; repo slug → path relative to repo root (= the workspace folder, by rule 1 prerequisite b). Because repo mode requires folder == repo root, the path base is the same folder in both modes — a session's `codeReferences[].path` values are identical whether the session is filed under a workspace slug or a repo slug. A session's code references are not split across repos even if the transcript touched multiple repos' files — the session is the atomic push unit, all its code references share the session's owning slug's path base.

    **Team-mode interaction.** Team mode requires repo mode (rule 3). Since repo mode itself hard-errors on any failing folder, team mode inherits that: if repo mode can't run, team mode can't run either. There is no separate team-level folder validation — repo mode's check IS the gate. Once repo mode runs (all folders valid), team mode enables and every folder's sessions push under their repo slug. The "fallback folder not pushed" scenario never arises because there are no fallback folders in repo mode.

    **Test coverage required.**
    - Prerequisite failure (non-git folder): fixture with one non-git workspace folder + repo mode → assert repo mode refuses to run, error notification names the folder + "非 git 仓库", no sessions analyzed, no store writes, no push. `agentMindmap.project.mode` setting unchanged.
    - Prerequisite failure (no `origin`): git repo-root folder without `origin` remote → same error, reason "无 origin remote".
    - Prerequisite failure (not repo root): workspace folder is a subdirectory of a git repo (`repo/subdir`, has `origin` but `git rev-parse --show-toplevel` != folder) → same error, reason "非 repo 根".
    - Git binary unavailable: mock git missing → same error for every folder, reason "git 不可用".
    - Post-enablement breakage: fixture where repo mode was running (folder valid), then `.git` removed → next activation errors, existing sessions still renderable from `record_json`, staleness for that folder's code refs surfaces as stale/unknown (not re-verified), no new analysis.
    - Mixed folders (one valid, one failing): repo mode errors on the failing one — assert the valid folder's sessions are NOT analyzed either (repo mode is all-or-nothing per activation), error names only the failing folder.
    - All folders valid: repo mode runs, every folder's sessions get repo slugs, staleness uses `repo-paths.json`, team mode can enable.
    - No subdirectory scanning: non-git folder with two git-repo children → folder fails prerequisite (a), repo mode errors, `repo-paths.json` contains no entries for children (not scanned).
    - Workspace mode unaffected: same non-git folder in workspace mode → no error, sessions use workspace slug, staleness works (paths workspace-relative).

11. **Re-key transactionality, backup, and recovery (resolved 2026-06-21).**

    **Scope: per-folder, current workspace only.** Re-key processes each workspace folder independently. Re-key is only triggered when switching to repo mode, and repo mode's prerequisite check (rule 10) runs FIRST — so by the time re-key runs, every workspace folder already satisfies both prerequisites. There are no "failing folders to skip" at re-key time; if any folder failed, repo mode would have errored before re-key started. (This supersedes the earlier "Case B folders skipped during re-key" design — with hard-error enforcement, there are no Case B folders in a running repo mode.)

    **Transaction granularity: one SQLite transaction per folder.** All session primary-key rewrites for a single folder happen in one transaction — all-or-nothing per folder. Folders are independent: folder A succeeding while folder B fails leaves the store in "A re-keyed, B not" state, which is acceptable (see recovery below).

    **Backup before re-key.** Before any re-key work begins, the extension copies `store.db` to `store.db.pre-rekey-<timestamp>` (one backup, not accumulating — a later re-key overwrites the previous backup). Re-key starts only after the backup succeeds; backup failure aborts re-key with an error. This is the only safety net, since re-key is one-way (rule 5) with no in-product revert. File copy is cheap.

    **`CodeReference.path` is NOT rewritten.** Because repo mode requires folder == repo root (rule 1 prerequisite b), the workspace-relative and repo-relative path bases are the same folder. Re-key only changes the `projectSlug` primary key on each `SessionRecord`; `codeReferences[].path` values are already correct for the new slug.

    **Idempotent re-runs.** Re-keying a folder whose sessions are already under the repo slug is a no-op (no sessions found under the old workspace slug). Re-triggering re-key after a partial run processes only the not-yet-re-keyed folders; already-done folders are skipped. This makes recovery from interruption simple: just re-run.

    **Recovery from interruption.** If the re-key process is interrupted (extension crash, host quit): per-folder transactions guarantee each folder is internally consistent (either fully re-keyed or untouched). Across folders, the store is in a partial-complete state, which is safe — re-running re-key completes the remaining folders via idempotency. No global rollback is needed.

    **Progress UI.** VS Code progress notification: "Re-keying: [folder] (N/M sessions)..." per folder, then a summary on completion ("已迁移 N 个工作区"). (No "skipped" count — with hard-error enforcement, all folders pass the prerequisite check before re-key starts, so none are skipped.)

    **Test coverage required.**
    - Per-folder transaction: fixture where folder B's re-key is made to fail mid-transaction (e.g. inject a write error) → assert folder B's sessions are unchanged (rolled back), folder A (already done) remains re-keyed, store is consistent.
    - Backup: assert `store.db.pre-rekey-<ts>` exists after re-key and equals the pre-rekey store; assert re-key aborts if backup write fails.
    - Path unchanged: assert `codeReferences[].path` values are byte-identical before and after re-key for re-keyed sessions.
    - Prerequisite gate: fixture with one valid repo-root folder + one non-git folder → assert re-key does NOT start (repo mode prerequisite check errors first, rule 10); no sessions re-keyed, no backup written.
    - Idempotency: run re-key twice (all folders valid) → second run is a no-op (no sessions under old slugs), no errors.
    - Interruption recovery: simulate interruption after folder A done, folder B pending → re-run re-key → folder B processed, folder A untouched, all sessions end under repo slugs.

**Q5 is fully resolved.** No open sub-questions remain. The "upgrade hint" sub-question is moot: `project.mode` is not yet released, so there are no existing users to migrate — the setting simply defaults to `workspace` on first install. The runtime hard-error check (rule 10) covers the only failure mode that matters post-enablement (git info deleted after repo mode was enabled).

## Decisions

All open questions resolved:

1. **MCP transport** — stdio-only. The team client runs the same `mcp-server` binary as single-machine, speaking stdio to Cursor/Claude Code. The team service is plain REST, does not speak MCP. No direct HTTP-MCP endpoint on the team service.
2. **SQLite migration timing** — before team mode. Migration 1 ships as a standalone phase (pure refactor, independent value), then team mode builds on the same schema. Bundling them would mix a schema migration with new HTTP surface area and make rollback harder.
3. **Write semantics** — pure upsert, last-write-wins on `analyzedAt`. No `transcriptSha256` guard, no 409. Rationale: team members analyze their own transcripts and never collide on `sessionId`; the only repeated-write case is one user across devices, which is an update not a conflict. The client's `isRecordFresh` prevents stale pushes.
4. **Workspace namespacing** — deferred. `project_slug` already isolates projects; a workspace prefix is premature. Revisit only if same-named projects across sub-teams becomes a real problem.
5. **Read auth** — API key required on all endpoints, read and write. No anonymous read surface. The key lives in VS Code SecretStorage.
6. **Audit history** — deferred. Main path stores only the latest record. If audit becomes a requirement, add an append-only `session_history` table; it does not touch the read/write path.
7. **Merge snapshot rebuild trigger** — Go server-side cron on fixed interval + project revision change. Not push-triggered. Trie rebuild is deterministic and cheap; periodic full rebuild beats high-frequency small rebuilds.
8. **Team service language** — Go, not TypeScript. The server is intentionally thin (storage + one deterministic trie-merge worker), so Go's deployment ergonomics (single static binary, native Postgres pool via `pgx`, no Node runtime) outweigh the cost of re-implementing the trie-merge algorithm. The TypeScript client keeps all search/render/eval logic; the Go server treats `SessionRecord` JSON as opaque storage. Code is not shared across the language boundary — the REST contract is the only coupling.
9. **Team service repository** — the Go service lives in a **separate repo**, `agent-mindmap-team-service` (sibling to `agent-mindmap`), not under `team-server/` inside the extension repo. It is versioned and released independently (Git tags `v0.x.y`); its releases do not bump the extension version. Rationale: the service has its own deploy cadence, runtime (Go vs Node), and ops surface (Postgres, bge-m3) — bundling it as a subdirectory couples extension releases to server releases and complicates CI. The REST contract documented in §HTTP API is the only cross-repo dependency.
10. **HTTP methods** — only `GET` and `POST` are used on the team service API. `PUT` and `DELETE` are not allowed. Upserts (session record pushes) are `POST /v1/projects/:slug/sessions/:id`; there is no delete surface in v1. Rationale: a constrained method set simplifies proxies, firewalls, and middleware (some corporate proxies strip `PUT`/`DELETE`), and the API has no operation that genuinely requires `PUT` (idempotent upsert is expressible as `POST` keyed by session id) or `DELETE` (no deletion in v1).
11. **`CodeReference.markCode` + staleness (Q4)** — `CodeReference` gains a `markCode: string[]` field storing **effective lines** of the verbatim code the LLM was given as input (raw `Write.contents` / `StrReplace.new_string`, captured before the prompt's whitespace-collapse + 300-char truncation; capped at 2000 chars with complete-line truncation; split on newlines, trimmed, ineffective lines discarded — empty / length < 3 / no Unicode letter or digit). `markCode` is **not** LLM-generated; the codeRef LLM prompt is **unchanged**; `PIPELINE_VERSION` does **not** bump. Staleness is a **three-state response-time derived field** (`fresh` / `stale` / `unknown`), computed **on-read** by the MCP server — never persisted to the store. `fresh` = path resolves + file exists + all effective lines match; `stale` = path resolves but file missing OR ≥1 effective line missing; `unknown` = slug missing from `paths.json` (repo not on this machine) OR `markCode` empty array. Matching is per-line substring (no global normalization; tolerant of indentation/CRLF/LF/reordering by construction). Stale/unknown code hits **always surface** in search results as `kind: "code"` with a `staleness` tag (never filtered/demoted); the team service returns hits **without** `staleness`, the MCP server back-fills it in both modes. No back-fill migration (not yet shipped; missing `markCode` → `unknown` naturally). Full design in §Q4 Decided design; PR breakdown in `TEAM_MODE_PR_PLAN.md` (single PR, lands after P2.7).
12. **Project mode + repo-URI slug (Q5)** — `agentMindmap.project.mode` (`workspace` | `repo`, default `workspace`) governs slug derivation and `CodeReference.path` base. `workspace` = path-based slug from the workspace folder (backward-compatible, zero surprise). `repo` = slug from the normalized git `origin` URI (strip protocol + host + `user@`, keep `org/repo.git` with trailing `.git`); `CodeReference.path` relative to repo root. Repo mode has **two hard prerequisites per workspace folder** (git repo with `origin` AND folder is repo root); **failure = hard error, no soft fallback**. Team mode **implies** repo mode (guidance prompt to switch + one-shot re-key). Re-key is **one-way** (workspace→repo, no revert path), per-folder transactional with backup; `CodeReference.path` is NOT rewritten (folder==repo root ⇒ bases identical). Extension maintains `workspace-paths.json` / `repo-paths.json` (`{slug → localPath}`, rewritten at activation + on workspace-folder change; manual `Refresh Repo Paths` command; MCP server reads on-miss, no `fs.watch`). Folder is the unit — no subdirectory scanning. Full design in §Q5 Decided design; PR sub-series P2.6 (slug + hard-error) → P2.7 (paths.json + MCP path resolution) → P2.8 (re-key) in `TEAM_MODE_PR_PLAN.md`.

## Impact on the released extension

The currently-released extension (mind-map viewer, no MCP) writes JSON files under `~/.agent-mindmap/`. Team-mode phases 1–2 do not affect any released functionality — they refactor internal storage only. The user-visible breaking change is Migration 1 (JSON → SQLite), which:

- Runs automatically on first launch after upgrade.
- Preserves original JSON files for one full release so downgrade is safe.
- Does not change `SessionRecord` schema, so no re-analysis.

MCP remains unreleased, so team-mode phases 3–6 (server, `RemoteStore`, push queue) have no impact on existing users until they opt in by setting `agentMindmap.team.serverUrl`.
