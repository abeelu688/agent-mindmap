# Agent Mind Map

Cursor / VS Code extension that **read-only** loads Agent chat transcripts from `~/.cursor/projects/<workspace-slug>/agent-transcripts/*.jsonl` and renders them as an interactive mind map (via [simple-mind-map](https://github.com/wanglin2/mind-map)).

The mind map does **not** write back to Cursor chat storage or affect the Agent.

## Two rendering modes

| Mode | When used | Structure |
|------|-----------|-----------|
| **Topic** (default) | LLM summarization succeeds | Root (LLM-induced overall theme) → `核心 N: <title>` → knowledge points / references |
| **Turn** (fallback) | LLM unavailable / cancelled / bad JSON | Root (session label) → `Q1`, `Q2`, … → `调研` / `结论` |

The topic view answers the "this chat is about what?" question instead of replaying it turn by turn. The root node itself is also LLM-induced (a 5-15 character noun phrase), so neither the agent UUID nor the timestamp appear as the central core. When the LLM is unavailable the fallback root keeps the session label (`<id-prefix>… · <date>`).

## How the LLM is called

The extension spawns the official [`cursor-agent` headless CLI](https://cursor.com/docs/cli/headless) as a subprocess and feeds it the transcript:

```
agent -p --force --trust --output-format json
```

This reuses your existing Cursor subscription — **no separate API key is required**. The Cursor CLI must be installed once:

```bash
curl https://cursor.com/install -fsS | bash
```

Verify with `agent --version` (or `cursor-agent --version`). If the binary is missing the extension falls back to the chronological "turn" view and surfaces the install command in a notification.

A provider abstraction is in place (`extension/src/llm/`) so HTTP-based providers (OpenAI-compatible, Anthropic, etc.) can be added by dropping a new file alongside `cursorCliProvider.ts`.

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

`SessionRecord.meta` carries `projectSlug`, `projectPath`, `transcriptSha256`, prompt parameters, `promptVersion`, LLM provider + model, and `analyzedAt`. The freshness check uses `transcriptSha256` + prompt params + `promptVersion` + model: if any of those changed the session is re-analyzed and the record overwritten. `promptVersion` lets the library auto-invalidate after upgrades that change the LLM output schema (e.g. adding `conceptPath`).

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

This is fully deterministic (no LLM call). Topics that were produced before the v2 prompt (and so lack `conceptPath`) land under a `未分类` branch — running **Refresh** on those sessions regenerates them with the new schema.

The legacy hash-keyed cache under `globalStorage/llm-cache/` (controlled by `agentMindmap.cacheLlmResult`) remains as a secondary cache — harmless and useful when `library.enabled = false`.

## Commands

| Command | Description |
|---------|-------------|
| **Agent Mind Map: Open Latest Session** | Load the most recent transcript for the current workspace |
| **Agent Mind Map: Choose Session…** | Pick a transcript by human-readable title + time (reads Cursor's sidebar composer name, falls back to the first user query, then to id prefix) |
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

## Jump back to chat

Every rendered mind-map node — root, project / topic branch, and leaf — is clickable. The extension traces the node back to its originating `(session, question turn)` set and:

1. Pops a quick-pick when the click resolves to more than one candidate (e.g. a `android` concept-trie branch covering 5 sessions, or a single item with `sourceTurnIndices = [0, 2]`). The picker shows `整段会话` rows for branch / root clicks and `Q3: <question preview>` rows for turn-specific leaves, grouped by session.
2. If the chosen candidate's project slug differs from the current workspace, asks whether to open it in a new window, in the current window, or to just copy the question text to the clipboard.
3. Opens the agent by id via Cursor's `composer.openComposer` (classic mode) or `glass.openAgentById` (newer "glass" mode), focuses the composer input via `composer.focusComposer`, copies the original `Q#` text to the clipboard (`粘贴即可继续`), and reveals that turn's line in the raw `.jsonl` in a side editor.
4. For cross-window jumps the target is persisted to `globalState` under `agentMindmap.pendingJump` (60 s TTL) and drained by the new window's `activate()` (`onStartupFinished`).

Known limitations:

- The LLM-refined merge view (**LLM Merge Refine…**) does not carry per-item source refs back to the original `SessionRecord`, so its nodes are currently inert on click. The deterministic / concept-trie merges and the single-session view are fully wired.
- Cursor exposes no public API to scroll an open agent's transcript to a particular `Q#`, so the "locate to question" step uses (a) clipboard + (b) `.jsonl` line reveal rather than scrolling inside the chat panel.
- The cross-window handover relies on the Mind Map extension being installed in the target Cursor window.

## Settings

### LLM / topic view
- `agentMindmap.llm.provider` — currently only `cursor-cli`
- `agentMindmap.llm.cliPath` — override the binary path; empty = auto-detect `agent` then `cursor-agent`
- `agentMindmap.llm.model` — optional `--model` argument
- `agentMindmap.llm.timeoutMs` — hard timeout per cursor-agent attempt, default `90000` (max `600000`)
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

### General
- `agentMindmap.projectsDir` — override `~/.cursor/projects`
- `agentMindmap.cursorStateDb` — override path to Cursor's `globalStorage/state.vscdb` (used to read sidebar composer names for the **Choose Session** list); empty = platform default
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

## Workspace slug

For path `/home/example/cursor/airecorder`, Cursor uses slug `home-example-cursor-airecorder` (path without leading `/`, slashes → `-`):

`~/.cursor/projects/home-example-cursor-airecorder/agent-transcripts/<uuid>/<uuid>.jsonl`

For `/home/example/cursor/aosp14` → `home-example-cursor-aosp14`.

## Privacy

Transcripts may contain local file paths and code snippets. The extension sends transcript content to `cursor-agent`, which forwards it to Cursor's servers under your existing subscription terms. The exported JSON stays in your workspace unless you commit it.

**Library contents** (`storeDir`) only contain the already-summarised `TopicGraph` and meta (session id, project slug / path, transcript hash, timestamps) — **not** the raw transcript. The **LLM Merge Refine** command sends the existing TopicGraphs of the selected sessions to `cursor-agent`; it does **not** re-send raw transcripts, so it costs far fewer tokens than the original per-session analysis.

## License

MIT
