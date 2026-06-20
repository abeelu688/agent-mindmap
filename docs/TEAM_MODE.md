# Team Mode Architecture

> **Status**: design draft. All open questions have been resolved; decisions are recorded in §Decisions.
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

## Impact on the released extension

The currently-released extension (mind-map viewer, no MCP) writes JSON files under `~/.agent-mindmap/`. Team-mode phases 1–2 do not affect any released functionality — they refactor internal storage only. The user-visible breaking change is Migration 1 (JSON → SQLite), which:

- Runs automatically on first launch after upgrade.
- Preserves original JSON files for one full release so downgrade is safe.
- Does not change `SessionRecord` schema, so no re-analysis.

MCP remains unreleased, so team-mode phases 3–6 (server, `RemoteStore`, push queue) have no impact on existing users until they opt in by setting `agentMindmap.team.serverUrl`.
