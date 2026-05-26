# Agent Mind Map

Cursor / VS Code extension that **read-only** loads Agent chat transcripts from `~/.cursor/projects/<workspace-slug>/agent-transcripts/*.jsonl` and renders them as an interactive mind map (via [simple-mind-map](https://github.com/wanglin2/mind-map)).

The mind map does **not** write back to Cursor chat storage or affect the Agent.

## Commands

| Command | Description |
|---------|-------------|
| **Agent Mind Map: Open Latest Session** | Load the most recent transcript for the current workspace |
| **Agent Mind Map: Choose Session…** | Pick a transcript by ID / time |
| **Agent Mind Map: Refresh** | Re-read the active transcript |
| **Agent Mind Map: Export Mind Map JSON** | Save to `docs/agent-mindmaps/<session-id>.json` |

## Settings

- `agentMindmap.projectsDir` — override `~/.cursor/projects`
- `agentMindmap.includeToolCalls` — show tool calls under「调研」(default: `true`)
- `agentMindmap.maxConclusionItems` — cap conclusion nodes (default: `8`)
- `agentMindmap.autoRefresh` — watch transcript file and refresh (default: `false`)

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

## Workspace slug

For path `/home/example/cursor/airecorder`, Cursor uses slug `home-example-cursor-airecorder` (path without leading `/`, slashes → `-`):

`~/.cursor/projects/home-example-cursor-airecorder/agent-transcripts/<uuid>/<uuid>.jsonl`

For `/home/example/cursor/aosp14` → `home-example-cursor-aosp14`.

## Privacy

Transcripts may contain local file paths and code snippets. Export stays in your workspace unless you commit it.

## License

MIT
