# Agent Mind Map

[![CI](https://github.com/abeelu688/agent-mindmap/actions/workflows/ci.yml/badge.svg)](https://github.com/abeelu688/agent-mindmap/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blue.svg)](https://code.visualstudio.com/)
[![中文文档](https://img.shields.io/badge/README-中文-red.svg)](README.zh-cn.md)

A VS Code extension that reads AI agent chat transcripts and renders them as **interactive mind maps**.

**[中文文档 / Chinese README →](README.zh-cn.md)**

---

![Agent Mind Map Screenshot](docs/screenshot.png)

> **Screenshot placeholder** — add an actual screenshot or GIF before public release.

## Supported Products

| Product         | Transcript Location                                           | Headless CLI             |
| --------------- | ------------------------------------------------------------- | ------------------------ |
| **Cursor**      | `~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl` | `agent` / `cursor-agent` |
| **Claude Code** | `~/.claude/projects/<encoded-path>/*.jsonl`                   | `claude -p`              |

Set `agentMindmap.host` to `auto` (default), `cursor`, or `claude-code`. In `auto` mode, the extension detects your editor and falls back to scanning both directories.

The mind map is **read-only** — it does not write back to chat storage or affect the Agent panel.

## Two Rendering Modes

| Mode                | When                                   | Structure                                                                    |
| ------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| **Topic** (default) | LLM summarization succeeds             | Root (LLM-induced theme) → `Core N: <title>` → knowledge points / references |
| **Turn** (fallback) | LLM unavailable / cancelled / bad JSON | Root (session label) → `Q1`, `Q2`, … → `Research` / `Conclusion`             |

The topic view answers the "what was this chat about?" question. The root node is also LLM-induced (a 5–15 character noun phrase), so neither the agent UUID nor the timestamp appears as the central node.

## LLM Integration

The extension spawns the matching **headless CLI** as a subprocess — **no separate API key is required**. It reuses your existing product subscription.

| Host        | Command                                                        |
| ----------- | -------------------------------------------------------------- |
| Cursor      | `agent -p --force --trust --output-format json <prompt>`       |
| Claude Code | `claude -p --bare --output-format json --max-turns 1 <prompt>` |

If the binary is missing, the extension falls back to the chronological "turn" view and shows a modal with full install steps. Override the binary path with `agentMindmap.llm.cliPath` if auto-detect fails.

## Library (Cross-Session, Cross-Project Store)

Every successful LLM analysis is persisted as a `SessionRecord` to a directory **outside any project**, so:

- The same session opens instantly later (no LLM call needed)
- Multiple sessions / projects can be merged into a bigger mind map

Default location: `~/.agent-mindmap/`. Override with `agentMindmap.storeDir` — point it at a sync folder (iCloud / Dropbox) to share the library across machines.

### Concept Mind Map

When you run **Analyze All Sessions (Current Project)**, all topics across project sessions are inserted into a trie keyed by their `conceptPath` and rendered as a unified concept map:

```
Concept Mind Map · <project-slug>
└── frontend (5)
    └── react (3)
        ├── hooks (2)
        │   ├── use-state (1)
        │   │   └── useState Basics · [s2-label]
        │   └── use-reducer (1)
        │       └── useReducer Advanced · [s1-label]
        └── router (1)
            └── React Router Config · [s3-label]
```

This is fully deterministic (no LLM call for trie layout). Paths are normalized before trie insert and rewritten using cached ontology **segment equivalences** (scoped aliases — no hardcoded domain names in code).

## Commands

| Command                                                    | Description                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Agent Mind Map: Open Latest Session**                    | Load the most recent transcript and show a single-session mind map                                |
| **Agent Mind Map: Choose Session…**                        | Pick a transcript by title + time                                                                 |
| **Agent Mind Map: Analyze All Sessions (Current Project)** | Scan every transcript, run per-session LLM analysis, then build and open the **Concept Mind Map** |

Loading commands that call the LLM show a **cancellable progress notification** with step-by-step status text.

## Click Nodes to Open Transcripts

Every mind-map node is clickable. The extension traces the node back to its originating session and turn, then opens a readable Markdown transcript in the editor. When the click targets a specific turn, it scrolls to the matching heading.

## Offline Export

Right-click the empty canvas → **Download mind map & transcripts…**. The export includes:

- A self-contained `index.html` mind map
- Pre-rendered `transcripts/*.html` (and `*.md` for editors)

No local HTTP server required — just open `index.html` in a browser. Clicking nodes opens the matching transcript at the correct anchor.

## Settings

### Host / Transcripts

| Setting                          | Default | Description                            |
| -------------------------------- | ------- | -------------------------------------- |
| `agentMindmap.host`              | `auto`  | `auto` \| `cursor` \| `claude-code`    |
| `agentMindmap.projectsDir`       | `""`    | [Cursor] Override `~/.cursor/projects` |
| `agentMindmap.claudeProjectsDir` | `""`    | [Claude] Override `~/.claude/projects` |

### LLM / Topic View

| Setting                         | Default  | Description                            |
| ------------------------------- | -------- | -------------------------------------- |
| `agentMindmap.llm.provider`     | `auto`   | `auto` \| `cursor-cli` \| `claude-cli` |
| `agentMindmap.llm.cliPath`      | `""`     | Override CLI binary path               |
| `agentMindmap.llm.model`        | `""`     | Optional `--model` argument            |
| `agentMindmap.llm.timeoutMs`    | `480000` | Hard timeout per CLI attempt (ms)      |
| `agentMindmap.llm.maxAttempts`  | `1`      | Max retries per summarization          |
| `agentMindmap.maxTopics`        | `6`      | Target topic count                     |
| `agentMindmap.maxItemsPerTopic` | `6`      | Sub-items per topic                    |
| `agentMindmap.cacheLlmResult`   | `true`   | Secondary content-addressed cache      |

### Library / Merge

| Setting                                    | Default | Description                                |
| ------------------------------------------ | ------- | ------------------------------------------ |
| `agentMindmap.storeDir`                    | `""`    | Library path (`~/.agent-mindmap` if empty) |
| `agentMindmap.library.enabled`             | `true`  | Persist analysis and skip LLM on reopen    |
| `agentMindmap.library.batchRefineOntology` | `true`  | Incremental ontology + synonym refine      |
| `agentMindmap.library.mergeMode`           | `delta` | `delta` \| `full`                          |

### UI / Theme

| Setting                     | Default | Description                              |
| --------------------------- | ------- | ---------------------------------------- |
| `agentMindmap.ui.preset`    | `auto`  | `auto` \| `dark` \| `light`              |
| `agentMindmap.ui.direction` | `side`  | `side` \| `side-lr` \| `left` \| `right` |
| `agentMindmap.ui.locale`    | `auto`  | `auto` \| `en` \| `zh-cn`                |
| `agentMindmap.ui.themeFile` | `""`    | Custom theme JSON override               |

## Development

```bash
cd agent-mindmap
npm install
npm install --prefix extension
npm install --prefix webview
npm run build
npm test
```

Press **F5** in VS Code to launch the Extension Development Host.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution guide and [CLAUDE.md](CLAUDE.md) for the architecture overview.

## Roadmap

See [docs/IMPROVEMENT-PLAN.md](docs/IMPROVEMENT-PLAN.md) for the full roadmap. Recent milestones:

- [x] Unified error handling system (`AgentMindmapError` + `agentLog` + `notify()`)
- [x] Entry file refactoring (`commands/` + `batch/` split — `extension.ts` from 1,229 → 232 lines)
- [x] CI with GitHub Actions (lint, type-check, test, l10n key check)
- [x] i18n infrastructure (multi-locale UI bundles and prompt language separation)
- [x] Community templates (issue/PR templates, [`CONTRIBUTING.md`](CONTRIBUTING.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md))

Open for community contribution:

- [ ] Full UI translations for additional languages
- [ ] Migrate production LLM prompts to language-aware `TEXTS` patterns:
      `session-analysis`, `code-ref-descriptions`, and `merge-session-analysis`
- [ ] Add eval coverage for non-Chinese prompt variants before switching `auto` prompt language to English

## Privacy

Transcripts may contain local file paths and code snippets. The extension sends transcript content to the configured CLI (`cursor-agent` or `claude`), which forwards it under your existing subscription terms. The library only stores summarized `TopicGraph` and metadata — **not** the raw transcript. There is **no telemetry** and no third-party server.

See [`PRIVACY.md`](PRIVACY.md) for the full privacy policy.

## License

[MIT](LICENSE)
