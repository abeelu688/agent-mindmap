# @agent-mindmap/cli

Terminal CLI for [Agent Mind Map](https://github.com/SShooter/mind-elixir-core) — analyze AI agent chat transcripts and export mind maps from the command line.

## Install

```bash
npm install -g @agent-mindmap/cli
```

Or run directly:

```bash
npx @agent-mindmap/cli --help
```

## Quick Start

```bash
# List sessions in the current project
agent-mindmap session list

# Analyze the most recent session
agent-mindmap session analyze --latest

# Export a mind map as an offline HTML package
agent-mindmap session dump abc123

# Analyze all sessions and export the merged project mind map
agent-mindmap project analyze
agent-mindmap project dump
```

## Commands

### `session list`

List agent chat sessions for the current workspace.

```bash
agent-mindmap session list [--all-hosts] [--limit <n>] [--json]
```

### `session show <id>`

Show metadata for a specific session.

```bash
agent-mindmap session show abc123 [--json]
```

### `session analyze [<id>]`

Analyze a session using the LLM pipeline. Waits for all background processing (code-ref queue drain) to complete before returning.

```bash
agent-mindmap session analyze --latest   # Analyze most recent session
agent-mindmap session analyze abc123      # Analyze specific session
agent-mindmap session analyze abc123 --force  # Force re-analysis
```

### `session dump <id>`

Export a session mind map as an offline HTML package. The resulting `index.html` can be opened directly in any browser.

```bash
agent-mindmap session dump abc123                    # Export to ./agent-mindmap-export/
agent-mindmap session dump abc123 -o ./my-export     # Custom output directory
agent-mindmap session dump abc123 --with-analyze      # Analyze first if needed
```

**Output structure:**

```
agent-mindmap-export/
└── cursor-abc123de-1719148800000/
    ├── index.html              ← Open this in your browser
    ├── mindmap.json            ← Raw mind map data
    ├── transcript-viewer.html  ← Transcript viewer
    ├── assets/
    │   ├── webview.js
    │   ├── webview.css
    │   └── transcript-markdown.js
    ├── transcripts/
    │   ├── session-abc123.md
    │   └── session-abc123.html
    ├── README.md
    ├── open.sh                 ← macOS/Linux launcher
    └── open.cmd                ← Windows launcher
```

### `project analyze`

Analyze all sessions in the current project and build the merged concept mind map.

```bash
agent-mindmap project analyze [--force]
```

### `project status`

Show project analysis status: session counts, merge mode, snapshot freshness, and code-ref queue depth.

```bash
agent-mindmap project status [--json]
```

### `project dump`

Export the merged project mind map as an offline HTML package.

```bash
agent-mindmap project dump                      # Export merged mind map
agent-mindmap project dump -o ./my-export       # Custom output directory
agent-mindmap project dump --with-analyze        # Analyze first if needed
```

### Other Commands

| Command                                  | Description                                                         |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `agent-mindmap doctor`                   | Check CLI setup: version, store dir, host detection, LLM CLI status |
| `agent-mindmap version`                  | Show CLI + core + pipeline versions                                 |
| `agent-mindmap config get <key>`         | Read a configuration value                                          |
| `agent-mindmap config set <key> <value>` | Set a configuration value                                           |
| `agent-mindmap host list`                | List available hosts                                                |
| `agent-mindmap host detect`              | Auto-detect the active host                                         |
| `agent-mindmap model list`               | List available LLM models                                           |
| `agent-mindmap model select`             | Select the default LLM model                                        |

## Global Flags

| Flag                 | Description                                        |
| -------------------- | -------------------------------------------------- |
| `--cwd <path>`       | Working directory (defaults to `process.cwd()`)    |
| `--store-dir <path>` | Override store directory path                      |
| `--host <id>`        | Override host detection (`cursor` / `claude-code`) |
| `--json`             | Output structured JSON                             |
| `--quiet`            | Suppress non-essential output                      |
| `--no-progress`      | Disable progress spinners                          |
| `--no-color`         | Disable colored output                             |
| `--verbose`          | Show debug output                                  |

## Dumping Mind Maps

The `dump` commands produce a **self-contained offline HTML package** that works without a server or the extension installed. This is the same package the VS Code extension generates when you right-click → "Download as offline package".

### Typical Workflow

1. **Analyze** a session or project:

   ```bash
   agent-mindmap session analyze --latest
   ```

2. **Dump** the mind map:

   ```bash
   agent-mindmap session dump --latest
   ```

3. **Open** the result in your browser:

   ```bash
   # macOS
   open agent-mindmap-export/*/index.html

   # Linux
   xdg-open agent-mindmap-export/*/index.html
   ```

### One-liner with `--with-analyze`

For convenience, use `--with-analyze` to analyze and dump in a single command:

```bash
agent-mindmap session dump abc123 --with-analyze -o ./my-export
```

## Configuration

Configuration is stored in `.agent-mindmap/config.json` (project-level) or `$XDG_CONFIG_HOME/agent-mindmap/config.json` (user-level).

Key settings (mirror the VS Code extension's `agentMindmap.*` settings):

| Key                | Default  | Description                                         |
| ------------------ | -------- | --------------------------------------------------- |
| `llm.provider`     | `"auto"` | LLM provider (`auto` / `cursor-cli` / `claude-cli`) |
| `llm.model`        | `""`     | LLM model override                                  |
| `llm.timeoutMs`    | `300000` | LLM request timeout                                 |
| `cacheLlmResult`   | `true`   | Cache LLM results                                   |
| `maxTopics`        | `6`      | Max topics per session                              |
| `maxItemsPerTopic` | `6`      | Max items per topic                                 |

## License

MIT
