# CLAUDE.md

This file provides guidance to Claude Code (and any AI coding assistant) working on this project.

## Project Overview

**Agent Mind Map** is a VS Code extension that reads AI agent chat transcripts (Cursor / Claude Code) and renders them as interactive mind maps. It uses a headless CLI subprocess to call the LLM for session analysis — no separate API key is needed.

- **Publisher ID**: `airecorder.agent-mindmap`
- **License**: MIT
- **Languages**: TypeScript (extension + webview), CSS
- **Build**: esbuild (extension) + Vite (webview)
- **Test**: vitest (root) + node test runner (extension)
- **Mind map library**: [mind-elixir](https://github.com/SShooter/mind-elixir-core)

## Repository Structure

```
agent-mindmap/
├── extension/               ← VS Code extension (Node.js side)
│   ├── src/
│   │   ├── extension.ts     ← Entry point (activate/deactivate + command registration)
│   │   ├── commands/        ← Command handlers (being refactored from extension.ts)
│   │   ├── host/            ← Cursor / Claude Code host abstraction
│   │   ├── llm/             ← LLM CLI dispatch, prompt templates, JSON parsing, validation
│   │   ├── pipeline/        ← Session analysis pipeline (S1→S2 stages)
│   │   ├── store/           ← Persistent library (SessionRecord, merge snapshots, ontology)
│   │   ├── mindmap/         ← Mind map data builders (Topic/Turn/Merge views)
│   │   ├── webview/         ← WebView panel management (MindMapPanel, MindMapHost)
│   │   ├── export/          ← Offline HTML package export
│   │   ├── transcript/      ← JSONL parsing, session listing, Cursor state.vscdb
│   │   ├── ui/              ← Theme, layout direction, UI settings
│   │   ├── l10n/            ← UI translation (t() / uiTranslate())
│   │   ├── jumpToOrigin.ts  ← Click node → open transcript at matching turn
│   │   ├── sessionLoader.ts ← Session loading + LLM orchestration
│   │   └── paths.ts         ← Store directory resolution
│   ├── l10n/                ← VS Code l10n bundles (en, zh-cn)
│   └── package.json         ← Extension manifest + settings
├── webview/                 ← WebView (browser side, loaded in iframe)
│   └── src/
│       ├── main.ts          ← Bootstrap mind-elixir
│       ├── toMindElixir.ts  ← Data model → mind-elixir node conversion
│       ├── theme.ts         ← Theme application
│       ├── sideLayout.ts    ← Side-by-side layout
│       ├── exportBootstrap.ts ← Offline export bootstrap
│       ├── offlineJump.ts   ← Offline transcript jump
│       └── uiContextMenu.ts ← Canvas context menu
├── test/                    ← Test files (vitest + node test runner)
├── docs/                    ← Architecture docs, improvement plan
└── scripts/                 ← Build/packaging scripts
```

## Development Setup

```bash
npm install                    # Root dependencies
npm install --prefix extension # Extension dependencies (includes @vscode/sqlite3)
npm install --prefix webview   # WebView dependencies
npm run build                  # Build both extension + webview
npm test                       # Run extension tests (after build)
npm run test:vitest            # Run vitest tests (no build needed)
```

Press **F5** in VS Code to launch the Extension Development Host.

## Build Commands

| Command | What it does |
|---------|-------------|
| `npm run build` | Build webview (Vite) then extension (esbuild) |
| `npm run build:extension` | Build extension only |
| `npm run build:webview` | Build webview only |
| `npm run watch` | Watch mode for both |
| `npm test` | Build + run extension node tests |
| `npm run test:vitest` | Run vitest (no build needed) |
| `npm run check:concept-nodes` | Verify no hardcoded concept segment literals |
| `npm run package` | Build + package as VSIX |
| `npm run package:vsix` | Shell script wrapper for VSIX packaging |

## Architecture & Data Flow

### Single-Session Pipeline

```
Transcript (.jsonl) → parseJsonl → ChatEvent[]
  → Session Pipeline
     ├── S1: analyzeSession (LLM one-shot: domain + terms + outline + code refs)
     └── S2: finalizeSessionAnalysis (DET: ontology nodes + topic paths + synonym refine)
  → SessionOutline → sanitize → buildOutlineMindMap → MindMapRoot
  → Persist to library as SessionRecord
```

### Batch Concept Merge Pipeline

```
All project SessionRecords
  → Batch Snapshot Pipeline
     ├── Per-batch: incremental ontology + concept trie
     └── Final: deterministic root refresh (DET, no LLM)
  → Concept Trie → buildMergedOutlineMindMap → MindMapRoot
  → Persist as MergeRecord
```

### Two Rendering Modes

| Mode | When | Root → Children |
|------|------|----------------|
| **Topic** (default) | LLM succeeds | LLM-induced title → 核心 N → knowledge points / code refs |
| **Turn** (fallback) | LLM unavailable | Session label → Q1, Q2, … → 调研 / 结论 |

## Key Design Constraints

### 1. Concept paths are metadata, not UI

`conceptPath` on topics is used for cross-session trie merge only. It is NOT rendered in single-session mind maps. Do not add concept-path-based branching in the single-session view.

### 2. No hardcoded concept segment literals in production code

Production code must not branch on specific concept segment values (`android`, `art`, etc.). Run `npm run check:concept-nodes` to verify. See `.cursor/rules/no-hardcoded-concept-nodes.mdc`.

### 3. LLM calls go through HeadlessCliProvider

Never call the LLM directly. All LLM interaction goes through `HeadlessCliProvider.summarize()`, which handles:
- Binary auto-detection (cursor-agent / claude)
- Retry with exponential backoff + jitter
- AbortSignal cancellation
- JSON repair (trailing commas, smart quotes, etc.)
- Schema-based validation per `LlmResponseSchema`

### 4. Store writes must be atomic

Use `writeJsonAtomic()` from `store/atomicWrite.ts`. It does write-to-temp + rename on POSIX, copyFile + unlink on Windows. Never write JSON directly to a store path.

### 5. SessionRecord freshness check is comprehensive

`isRecordFresh()` checks `transcriptSha256` + `promptParams` + `pipelineVersions` + `llm.provider` + `llm.model` + `hostId`. If ANY of these change, the session is re-analyzed. When bumping the prompt schema, increment `PIPELINE_VERSION` in `pipeline/pipelineVersions.ts`.

### 6. Merge snapshot contract

Batch 1 gets a full M-merge on milestone sessions. Batch 2+ uses snapshot delta only — periodic or all-session M-merge is forbidden. See `.cursor/rules/merge-snapshot-delta.mdc`.

## Coding Conventions

### TypeScript

- `strict: true` is enabled. All new code must pass `tsc --noEmit`.
- Prefer `type` over `interface` for object shapes (existing convention).
- Use `as const` for literal objects used as enums.
- Export `__testing` objects for white-box test access (e.g., `export const __testing = { computeCacheKey }`).

### Error handling

- LLM errors: always use `LlmProviderError` with a specific `LlmErrorCode`.
- Store/transcript errors: use `console.warn` for now (being migrated to unified `agentLog`).
- Never silently swallow errors in a `catch {}` without at least logging.

### Import style

- Use `import type` for type-only imports.
- Group imports: node builtins → external packages → internal modules.
- No barrel exports (`index.ts` re-exports) in `llm/` — each prompt file is imported directly.

### LLM prompt files

- Each pipeline stage has its own `prompt*.ts` file.
- Prompt text is currently hardcoded in Chinese. A migration to i18n-aware prompts is in progress (see `docs/IMPROVEMENT-PLAN.md` Phase 4.2).
- When changing a prompt's JSON output schema, bump `PIPELINE_VERSION` so caches invalidate.

### Tests

- Test files live in `test/` at the repo root, not alongside source files.
- Test files use the same name as the source module (e.g., `test/reattachChanges.test.ts` tests `extension/src/llm/reattachChanges.ts`).
- VS Code API is stubbed via `test/vscode-stub.cjs`.
- Use `__testing` exports for unit-testing internal functions.

### L10n / i18n

- UI strings use `t(key, englishMessage, ...args)` or `uiTranslate(key, englishMessage, ...args)`.
- Translation bundles live in `extension/l10n/bundle.l10n.json` (English) and `extension/l10n/bundle.l10n.zh-cn.json` (Chinese).
- When adding a new user-visible string, add the key to BOTH bundles.
- LLM prompt language is controlled by `PromptLanguage` type (currently `"zh" | "en"`).

## Common Tasks

### Adding a new LLM prompt stage

1. Create `extension/src/llm/promptXxx.ts` with a `buildXxxPrompt()` function.
2. Add the schema name to `LlmResponseSchema` in `llm/types.ts`.
3. Add a `parseXxxFromStdout()` function in `llm/headlessCli.ts`.
4. Add the schema case to `parseBySchema()` in `headlessCli.ts`.
5. Bump `PIPELINE_VERSION` if the output schema is new or changed.
6. Add a test file in `test/`.

### Adding a new host (e.g., Windsurf)

1. Create `extension/src/host/windsurfHost.ts` implementing `AgentHost`.
2. Register it in `extension/src/host/registry.ts`.
3. Add the host ID to `AgentHostId` type in `host/types.ts`.
4. Add transcript parsing if the JSONL format differs.
5. Add a CLI provider in `extension/src/llm/` if the headless CLI differs.

### Adding a new UI language

1. Create `extension/l10n/bundle.l10n.<locale>.json` with all keys from `bundle.l10n.json`.
2. Update `UiLocaleSetting` in `l10n/uiTranslate.ts` to include the new locale.
3. Update `isChineseUiLanguage()` → generalize to `resolveUiLanguage()`.
4. Update `agentMindmap.ui.locale` enum in `extension/package.json`.
5. Add language switch link in `README.md`.

## Project Status & Roadmap

See `docs/IMPROVEMENT-PLAN.md` for the full improvement roadmap, covering:
- Phase 0: Open-source preparation (CONTRIBUTING.md, multi-language README, badges)
- Phase 1: Unified error handling (AgentMindmapError, agentLog, notify)
- Phase 2: Refactor entry file (commands/ + batch/ split)
- Phase 3: CI & code quality (ESLint, Prettier, GitHub Actions, pre-commit)
- Phase 4: Internationalization (UI i18n, prompt i18n, docs i18n)
- Phase 5: Community infrastructure (Issue/PR templates, architecture docs, v0.2.0 release)

## Git Conventions

- **Commit messages**: Use conventional commits style (`feat:`, `fix:`, `refactor:`, `docs:`, `i18n:`, `chore:`).
- **Branch naming**: `feature/<short-desc>`, `fix/<short-desc>`, `i18n/<locale>`.
- **PRs**: One logical change per PR. Pure refactors must not change behavior.
