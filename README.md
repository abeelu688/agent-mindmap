# Agent Mind Map

Cursor / VS Code extension that **read-only** loads Agent chat transcripts from `~/.cursor/projects/<workspace-slug>/agent-transcripts/*.jsonl` and renders them as an interactive mind map (via [simple-mind-map](https://github.com/wanglin2/mind-map)).

The mind map does **not** write back to Cursor chat storage or affect the Agent.

## Two rendering modes

| Mode | When used | Structure |
|------|-----------|-----------|
| **Topic** (default) | LLM summarization succeeds | Root → `核心 N: <title>` → knowledge points / references |
| **Turn** (fallback) | LLM unavailable / cancelled / bad JSON | Root → `Q1`, `Q2`, … → `调研` / `结论` |

The topic view answers the "this chat is about what?" question instead of replaying it turn by turn.

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

## Commands

| Command | Description |
|---------|-------------|
| **Agent Mind Map: Open Latest Session** | Load the most recent transcript for the current workspace |
| **Agent Mind Map: Choose Session…** | Pick a transcript by ID / time |
| **Agent Mind Map: Refresh** | Re-read the active transcript |
| **Agent Mind Map: Export Mind Map JSON** | Save to `docs/agent-mindmaps/<session-id>.json` |

All loading commands show a cancellable progress notification while the LLM runs.

## Settings

### LLM / topic view
- `agentMindmap.llm.provider` — currently only `cursor-cli`
- `agentMindmap.llm.cliPath` — override the binary path; empty = auto-detect `agent` then `cursor-agent`
- `agentMindmap.llm.model` — optional `--model` argument
- `agentMindmap.llm.timeoutMs` — hard subprocess timeout, default `30000`
- `agentMindmap.maxTopics` — target topic count (default `6`)
- `agentMindmap.maxItemsPerTopic` — sub-items per topic (default `6`)
- `agentMindmap.cacheLlmResult` — cache the topic graph under `globalStorage/llm-cache/<sha256>.json` keyed by transcript content

### General
- `agentMindmap.projectsDir` — override `~/.cursor/projects`
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

## License

MIT
