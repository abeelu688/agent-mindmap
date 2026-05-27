# Agent Mind Map

VS Code extension that **read-only** loads AI agent chat transcripts from on-disk storage and renders them as an interactive mind map (via [mind-elixir](https://github.com/SSShooter/mind-elixir-core)).

**Supported products (v1):**

| Product | Transcript location | LLM CLI |
|---------|---------------------|---------|
| **Cursor** | `~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl` | `agent` / `cursor-agent` |
| **Claude Code** | `~/.claude/projects/<encoded-path>/*.jsonl` | `claude -p` |

Set `agentMindmap.host` to `auto` (default), `cursor`, or `claude-code`. In `auto` mode the extension picks Cursor when running inside Cursor, otherwise scans both folders for the workspace and uses whichever has transcripts (newest session wins; you can pick once when both exist).

The mind map does **not** write back to chat storage or affect the Agent panel.

## Two rendering modes

| Mode | When used | Structure |
|------|-----------|-----------|
| **Topic** (default) | LLM summarization succeeds | Root (LLM-induced overall theme) → `核心 N: <title>` → knowledge points / references |
| **Turn** (fallback) | LLM unavailable / cancelled / bad JSON | Root (session label) → `Q1`, `Q2`, … → `调研` / `结论` |

The topic view answers the "this chat is about what?" question instead of replaying it turn by turn. The root node itself is also LLM-induced (a 5-15 character noun phrase), so neither the agent UUID nor the timestamp appear as the central core. When the LLM is unavailable the fallback root keeps the session label (`<id-prefix>… · <date>`).

## How the LLM is called

The extension spawns the matching **headless CLI** as a subprocess (`extension/src/llm/`):

| Host | Command shape |
|------|----------------|
| Cursor | `agent -p --force --trust --output-format json <prompt>` |
| Claude Code | `claude -p --bare --output-format json --max-turns 1 <prompt>` |

This reuses your existing product subscription — **no separate API key is required**.

- **Cursor:** install via `curl https://cursor.com/install -fsS | bash`, verify with `agent --version`.
- **Claude Code:** install the [Claude Code CLI](https://code.claude.com/docs/en/headless), verify with `claude --version`.

If the binary is missing the extension falls back to the chronological "turn" view and surfaces install guidance in a notification.

`agentMindmap.llm.provider` defaults to `auto`, which follows `agentMindmap.host`.

## Library (cross-agent, cross-project store)

Every successful LLM analysis is persisted as a `SessionRecord` to a directory **outside any project**, so the same session opens instantly later (no LLM call) and so multiple agents / projects can be merged into a bigger mind map.

Default location: `~/.agent-mindmap/`. Override with `agentMindmap.storeDir` — point it at a sync folder (iCloud / Dropbox) to share the library across machines.

Layout:

```
<storeDir>/
  schema.json                          # { schemaVersion, kind } marker
  index.json                           # compact projection of all records for fast UI listing
  sessions/
    <projectSlug>/
      <sessionId>.json                 # SessionRecord: meta + the TopicGraph the LLM returned
  merges/
    deterministic.json                 # auto-rebuilt cross-project mind map (no LLM)
    llm-refined.json                   # most recent LLM-synthesised merge
    cache/<selectionSha>.json          # LLM merge results keyed by selection set
```

`SessionRecord.meta` carries `hostId`, `projectSlug`, `projectPath`, `transcriptSha256`, prompt parameters, `promptVersion`, LLM provider + model, and `analyzedAt`. The freshness check uses `transcriptSha256` + prompt params + `promptVersion` + `hostId` + model: if any of those changed the session is re-analyzed and the record overwritten. `promptVersion` lets the library auto-invalidate after upgrades that change the LLM output schema (e.g. adding `conceptPath`).

### Concept paths (cross-session merge meta)

The LLM is asked to attach a `conceptPath` to every topic — an ordered, 3-5-segment path from broadest domain to finest concept, e.g.

```
title: "Binder 驱动调试"
conceptPath: ["android", "ipc", "binder", "binder 驱动"]
```

`conceptPath` is stored in `SessionRecord.graph.topics[].conceptPath`. It is **not** rendered in the single-session mind map (it's metadata). When you run **Open Concept Mind Map**, all topics across all sessions are inserted into a trie keyed by canonicalised (lowercased, whitespace-collapsed) path segments and rendered:

```
Concept Mind Map · 全部
└── android (5)
    └── ipc (3)
        ├── binder (2)
        │   ├── binder 驱动 (1)
        │   │   └── Binder 驱动调试 · [s2-label]
        │   └── Binder 调研 · [s1-label]
        └── aidl (1)
            └── AIDL 代码生成 · [s3-label]
```

This is fully deterministic (no LLM call). Paths are **normalized** before trie insert (e.g. `android → runtime → art` is folded to `android → art` so JIT and Hook sessions share one `art` branch). Topics that were produced before the v2 prompt (and so lack `conceptPath`) land under a `未分类` branch — running **Refresh** on those sessions regenerates them with the new schema.

**Open Merged View** vs **Open Concept Mind Map**: the former stitches by **project → session → topic** (good for replaying each chat as analyzed). The latter is the cross-session **concept hierarchy** — use it when you want topics like ART JIT and ART instrumentation under the same `android → art` tree.

The legacy hash-keyed cache under `globalStorage/llm-cache/` (controlled by `agentMindmap.cacheLlmResult`) remains as a secondary cache — harmless and useful when `library.enabled = false`.

## Commands

| Command | Description |
|---------|-------------|
| **Agent Mind Map: Open Latest Session** | Load the most recent transcript for the current workspace |
| **Agent Mind Map: Choose Session…** | Pick a transcript by human-readable title + time (Cursor: sidebar composer name from `state.vscdb`; Claude: `sessions-index.json`; else first user query) |
| **Agent Mind Map: Refresh** | Force re-analysis of the active session (overwrites the library record) |
| **Agent Mind Map: Export Mind Map JSON** | Save to `docs/agent-mindmaps/<session-id>.json` |
| **Agent Mind Map: Open Merged View (All Projects)** | Deterministic stitch of every record in the library, grouped by project → session → topic; no LLM call |
| **Agent Mind Map: Open Merged View (Current Project)** | Same, filtered to the current workspace |
| **Agent Mind Map: Open Concept Mind Map (All Projects)** | Cross-session **concept trie**: groups topics by the longest common `conceptPath` prefix (e.g. `android → ipc → binder → binder 驱动`). Pure deterministic — uses the conceptPath meta the LLM already produced per session |
| **Agent Mind Map: Open Concept Mind Map (Current Project)** | Same, filtered to the current workspace |
| **Agent Mind Map: LLM Merge Refine…** | Pick a scope (current / all / select) and ask the LLM to dedupe + cluster topics across sessions. Receives the per-session `conceptPath` as a clustering hint. Cached by selection hash, so re-opening the same merge costs 0 tokens |
| **Agent Mind Map: Browse Library…** | Cross-project quick-pick of any analyzed session — opens directly from the library, no transcript or workspace needed |
| **Agent Mind Map: Open Store Directory** | Reveal `storeDir` in the OS file manager (for backup / sync setup) |

All loading commands show a cancellable progress notification while the LLM runs.

## Open transcript from the map

Every rendered mind-map node — root, project / topic branch, and leaf — is clickable. The extension traces the node back to its originating `(session, question turn)` set and:

1. Pops a quick-pick when the click resolves to more than one candidate (e.g. a concept-trie branch covering several sessions, or a single item with `sourceTurnIndices = [0, 2]`). The picker shows `整段会话` rows for branch / root clicks and `Q3: <question preview>` rows for turn-specific leaves, grouped by session.
2. Opens a readable Markdown transcript in the **same code-editor tab group** as the mind map. The map tab stays open but hidden behind the transcript until you close the Markdown tab.
3. When the click targets a specific turn, scrolls to the matching `## Q#` heading in that document.
4. Closing the Markdown tab (×) brings the mind map tab back to the front.

The mind map opens as an **editor tab** in the code editor strip (not in the Activity Bar sidebar). Extensions cannot replace Cursor's Agent / chat panel.

Known limitations:

- The LLM-refined merge view (**LLM Merge Refine…**) does not carry per-item source refs back to the original `SessionRecord`, so its nodes are currently inert on click. The deterministic / concept-trie merges and the single-session view are fully wired.

## Settings

### Host / transcripts
- `agentMindmap.host` — `auto` | `cursor` | `claude-code` (default `auto`)
- `agentMindmap.projectsDir` — [Cursor] override `~/.cursor/projects`
- `agentMindmap.claudeProjectsDir` — [Claude] override `~/.claude/projects`
- `agentMindmap.cursorStateDb` — [Cursor] override `state.vscdb` for composer titles

### LLM / topic view
- `agentMindmap.llm.provider` — `auto` | `cursor-cli` | `claude-cli` (default `auto`, follows host)
- `agentMindmap.llm.cliPath` — override CLI binary; empty = auto-detect per provider
- `agentMindmap.llm.model` — optional `--model` argument
- `agentMindmap.llm.timeoutMs` — hard timeout per CLI attempt, default `90000` (max `600000`)
- `agentMindmap.llm.maxAttempts` — total attempts per summarisation, default `3`. Retries trigger on `timeout / cli-failed / bad-json / bad-shape`. `cli-missing / cancelled / empty` are terminal.
- `agentMindmap.llm.retryBackoffMs` — base backoff between retries, default `1000`. Actual wait is `base * 2^(attempt-1) ± 25%` jitter, capped at 10s.
- `agentMindmap.maxTopics` — target topic count (default `6`)
- `agentMindmap.maxItemsPerTopic` — sub-items per topic (default `6`)
- `agentMindmap.cacheLlmResult` — secondary content-addressed cache under `globalStorage/llm-cache/<sha256>.json` (the library is the primary persistence layer)

### Library / merge
- `agentMindmap.storeDir` — path to the cross-project library; empty = `~/.agent-mindmap`. Supports a leading `~/`. Point at a sync folder to share the library across machines.
- `agentMindmap.library.enabled` — persist each analysed session to the library and skip the LLM on reopen when the transcript is unchanged (default `true`)
- `agentMindmap.merge.autoRebuildDeterministic` — rebuild `merges/deterministic.json` after each new session lands (default `true`)
- `agentMindmap.merge.llm.maxTopics` / `maxItemsPerTopic` — target output size for the LLM merge command (defaults `8` / `6`)

### UI / theme
- `agentMindmap.ui.preset` — `auto` (follow editor colors, default), `dark`, or `light` (mind-elixir built-in themes)
- `agentMindmap.ui.direction` — `side` (default, both sides; first branch on the right, then left), `right`, or `left`
- `agentMindmap.ui.themeFile` — optional JSON file for advanced overrides (`cssVar`, `palette`). Empty = none. Supports workspace-relative paths, `~/...`, or absolute paths. See [`docs/theme.example.json`](docs/theme.example.json).

Preset merge order: built-in or VS Code–mapped base → theme file overrides. Invalid theme files are ignored (warning in **Agent Mind Map** output).

Suggested locations: `.agent-mindmap/theme.json` in the workspace, or `~/.agent-mindmap/theme.json` next to the analysis library.

**Canvas context menu:** right-click empty canvas (not on a node) to change theme preset or layout direction. Choices are saved to workspace settings (`.vscode/settings.json`). Requires an open folder workspace.

### General
- `agentMindmap.autoRefresh` — watch transcript file and refresh

### Fallback view only (deprecated)
- `agentMindmap.includeToolCalls` — show tool calls under「调研」
- `agentMindmap.maxConclusionItems` — cap conclusion nodes

## Development

```bash
cd agent-mindmap
npm install
npm install --prefix extension
npm install --prefix webview
npm run build
npm test
```

Press **F5** from the `airecorder` workspace (uses `.vscode/launch.json` → Extension Development Host).

Open the `airecorder` folder as workspace, run at least one Agent chat, then execute **Open Latest Session**.

### Debugging the LLM path

1. Install the CLI: `curl https://cursor.com/install -fsS | bash`
2. Confirm it works headless (prompt is a **positional argument**, not stdin): `agent -p --output-format json --force --trust 'say hi as JSON {hi:1}'`
3. In the Extension Development Host, open the Output panel → "Agent Mind Map" / DevTools console — `[agent-mindmap]` lines log LLM failures with the underlying error code (`cli-missing`, `cli-failed`, `timeout`, `bad-json`, `bad-shape`, `cancelled`, `empty`).
4. Cache lives in `~/.config/Code/User/globalStorage/airecorder.agent-mindmap/llm-cache/` (path varies by platform); delete the `.json` file or toggle `agentMindmap.cacheLlmResult` to force a re-summarization.

## On-disk paths

**Cursor** — for `/home/example/cursor/airecorder`, slug `home-example-cursor-airecorder` (strip leading `/`, `/` → `-`):

`~/.cursor/projects/home-example-cursor-airecorder/agent-transcripts/<uuid>/<uuid>.jsonl`

**Claude Code** — same path encodes to `-home-example-cursor-airecorder` (`/ \ : space _` → `-`):

`~/.claude/projects/-home-example-cursor-airecorder/<session-id>.jsonl`

Claude's VS Code extension has had reports of **main chats not persisting** to disk; CLI sessions under `~/.claude/projects/` are the reliable source. The extension shows a one-time hint when `host=claude-code` and the project folder is empty.

## Privacy

Transcripts may contain local file paths and code snippets. The extension sends transcript content to the configured CLI (`cursor-agent` or `claude`), which forwards it under your existing subscription terms. The exported JSON stays in your workspace unless you commit it.

**Library contents** (`storeDir`) only contain the already-summarised `TopicGraph` and meta (session id, host, project slug / path, transcript hash, timestamps) — **not** the raw transcript. The **LLM Merge Refine** command sends existing TopicGraphs only; it does **not** re-send raw transcripts.

## License

MIT
