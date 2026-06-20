# Team Mode Architecture

> **Status**: design draft. All open questions have been resolved; decisions are recorded in §Decisions.
>
> **Audience**: contributors planning the team-shared knowledge base work. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first for the current single-machine data flow.
>
> **Server language**: Go (see §Team service implementation). The TypeScript client (`shared/`, `mcp-server`, `extension`) is unchanged in scope; the team service is a separate Go program living under `team-server/`.

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

The team HTTP service is **implemented in Go**, not TypeScript. It lives under `team-server/` as a separate Go module (`go.mod`, `main.go`, `internal/...`). It does **not** share code with `shared/` — the REST contract is the only coupling.

Scope of the Go service:

- **Storage**: Postgres via `pgx` (`database/sql` + `pgxpool`). Tables: `projects`, `sessions` (with `record_json JSONB`), `kv` for merge snapshots. The `record_json` column stores the `SessionRecord` payload verbatim — the server treats it as opaque JSON and never parses its internal structure.
- **REST API**: the endpoints in §HTTP API. CRUD for projects/sessions/merges only. No search, no markdown render, no retrieval eval.
- **Merge worker**: a periodic Go job (cron-style tick + project revision change) that recomputes the concept trie from all `sessions.record_json` for a project and writes the result to `kv`. The trie build is deterministic; the Go implementation re-implements the existing TypeScript trie-merge algorithm against the JSON it reads back from Postgres.
- **Auth**: API key middleware on every endpoint, constant-time compare, single shared team key for v1.

What stays on the TypeScript client:

- **LLM pipeline** (S1/S2) — always runs locally on the member's machine.
- **Search index, markdown rendering, retrieval eval** — stays in `shared/`. The MCP server runs locally per member, hits `RemoteStore` only for raw `SessionRecord` JSON, and does all concept-term indexing, token-set building, scoring, and rendering in-process. This preserves the existing local-RAG boundary: no remote search, no remote rerank, no remote embeddings.
- **Push queue** — client-side, drains local new analyses to the Go server via `PUT /sessions/:id`.

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

```
GET    /v1/projects                              -> ProjectSummary[]
GET    /v1/projects/:slug/revision               -> { revision, recordCount }
GET    /v1/projects/:slug/sessions?limit&offset  -> SessionRecord[] (paged)
GET    /v1/projects/:slug/sessions/:id           -> SessionRecord
PUT    /v1/projects/:slug/sessions/:id           -> { revision }   (upsert, idempotent)
GET    /v1/merges/concept-trie                   -> MergeRecord
GET    /v1/projects/:slug/equivalences           -> SegmentEquivalence[]
GET    /v1/merges/concept-trie/revision          -> { revision }   (cheap cache validation)
```

`RemoteStore` is a thin fetch/PUT client over this API. It keeps an in-process LRU cache (the existing `McpSearchIndexCache`) and validates against `GET …/revision` before use — exactly the logic currently in `ensureProjectIndex`, just hitting HTTP instead of `fs.stat`. The Go server returns raw `SessionRecord` JSON; all search-index building, scoring, and markdown rendering stays on the TypeScript client (see §Team service implementation).

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
        │    PUT /v1/projects/:slug/sessions/:id  │
        │ ──────────────────────────────────────► │
        │ ◄────── { revision: 48 }                │
        │ 4. update lastPushedWatermark           │
```

`lastPushedWatermark` is stored in `kv` on the client. A background timer (or a post-analyze hook in the extension) drains the queue. Failure retries with exponential backoff; the push is idempotent because `PUT /sessions/:id` is keyed by session id.

### Write semantics (no real conflicts)

Each team member analyzes their **own** transcripts (their own Cursor/Claude Code sessions on their own machine). `sessionId` is derived from the transcript file, so two members never produce the same `sessionId` from different transcripts. There is no concurrent-write conflict to resolve.

The only case where the same `(project_slug, session_id)` gets pushed twice is **one user across devices**: member analyzes a session on machine A, pushes; later opens the same project on machine B (transcript file shared via git or synced storage), re-analyzes, pushes again. This is an update, not a conflict.

Policy: **pure upsert, last-write-wins on `analyzedAt`**.

- `PUT /sessions/:id` always overwrites. No `transcriptSha256` guard, no 409.
- The client's `isRecordFresh` already guarantees it only pushes records newer than what it has locally — it won't push stale records over fresh ones.
- Pipeline version bumps (`PIPELINE_VERSION` change) trigger client-side re-analysis; the resulting fresh record overwrites the old one upstream. Expected behavior.
- `transcriptSha256` may differ across two pushes for the same session if the transcript file was appended to between analyses (Cursor appending turns). The newer analysis wins. Correct.

No audit history is kept. If audit becomes a requirement later, add an append-only `session_history` table — it does not touch the main read/write path.

### Merge snapshots

The concept trie and ontology equivalences are produced by a **deterministic batch worker on the Go server**, not by client pushes. A Go cron job recomputes the trie from all `sessions.record_json` for a project on a fixed interval (and on project revision change), writes the result to the `kv` table, and exposes it via `GET /v1/merges/concept-trie`. Push-triggered recomputation was considered and rejected: the trie rebuild is deterministic and cheap relative to LLM analysis, so a periodic full rebuild is simpler and avoids high-frequency small rebuilds on every push. Clients poll `GET /v1/merges/concept-trie/revision` to know when to refresh their cached copy.

The Go worker re-implements the existing TypeScript trie-merge algorithm. The algorithm is deterministic and already covered by `shared/` tests; the Go port carries its own tests under `team-server/` using the same fixture inputs to assert byte-equivalent output.

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
2. Run a one-shot "bulk push": iterate all local sessions, `PUT` each. Server reconciles (upsert, last-write-wins).
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

## Decisions

All six open questions resolved:

1. **MCP transport** — stdio-only. The team client runs the same `mcp-server` binary as single-machine, speaking stdio to Cursor/Claude Code. The team service is plain REST, does not speak MCP. No direct HTTP-MCP endpoint on the team service.
2. **SQLite migration timing** — before team mode. Migration 1 ships as a standalone phase (pure refactor, independent value), then team mode builds on the same schema. Bundling them would mix a schema migration with new HTTP surface area and make rollback harder.
3. **Write semantics** — pure upsert, last-write-wins on `analyzedAt`. No `transcriptSha256` guard, no 409. Rationale: team members analyze their own transcripts and never collide on `sessionId`; the only repeated-write case is one user across devices, which is an update not a conflict. The client's `isRecordFresh` prevents stale pushes.
4. **Workspace namespacing** — deferred. `project_slug` already isolates projects; a workspace prefix is premature. Revisit only if same-named projects across sub-teams becomes a real problem.
5. **Read auth** — API key required on all endpoints, read and write. No anonymous read surface. The key lives in VS Code SecretStorage.
6. **Audit history** — deferred. Main path stores only the latest record. If audit becomes a requirement, add an append-only `session_history` table; it does not touch the read/write path.
7. **Merge snapshot rebuild trigger** — Go server-side cron on fixed interval + project revision change. Not push-triggered. Trie rebuild is deterministic and cheap; periodic full rebuild beats high-frequency small rebuilds.
8. **Team service language** — Go, not TypeScript. The server is intentionally thin (storage + one deterministic trie-merge worker), so Go's deployment ergonomics (single static binary, native Postgres pool via `pgx`, no Node runtime) outweigh the cost of re-implementing the trie-merge algorithm. The TypeScript client keeps all search/render/eval logic; the Go server treats `SessionRecord` JSON as opaque storage. Code is not shared across the language boundary — the REST contract is the only coupling.

## Impact on the released extension

The currently-released extension (mind-map viewer, no MCP) writes JSON files under `~/.agent-mindmap/`. Team-mode phases 1–2 do not affect any released functionality — they refactor internal storage only. The user-visible breaking change is Migration 1 (JSON → SQLite), which:

- Runs automatically on first launch after upgrade.
- Preserves original JSON files for one full release so downgrade is safe.
- Does not change `SessionRecord` schema, so no re-analysis.

MCP remains unreleased, so team-mode phases 3–6 (server, `RemoteStore`, push queue) have no impact on existing users until they opt in by setting `agentMindmap.team.serverUrl`.
