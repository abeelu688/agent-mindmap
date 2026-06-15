# Changelog

All notable changes to Agent Mind Map will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Open-source readiness**: `CONTRIBUTING.md` (EN + zh-cn), `CODE_OF_CONDUCT.md`, `SECURITY.md`, MIT license header, README badges, double-language README cross-links
- **Unified error handling**: `AgentMindmapError` base class, `agentLog` (debug/info/warn/error), `notify()` / `notifyInfo` / `notifyWarning` / `notifyError`, `wrapCommand()` for command handlers — replaces 30+ scattered `console.*` calls and 24+ direct `vscode.window.showXxx` calls
- **Entry-file refactor**: `extension.ts` slimmed from 1,229 → 232 lines; commands extracted to `extension/src/commands/`, batch-merge orchestration into `extension/src/batch/`
- **CI / tooling**: ESLint 9 flat config, Prettier, GitHub Actions CI, husky + lint-staged pre-commit, `npm run typecheck:{extension,webview}`, `npm run check` umbrella script
- **Community infrastructure**: Issue templates (bug / feature / question), PR template, label catalog in `docs/MAINTAINING.md`, `docs/RELEASE.md` release runbook, `docs/ARCHITECTURE.md`

### Changed

- `LlmProviderError` retained alongside `AgentMindmapError`; `toMindmapError()` bridges them
- `extension/l10n/bundle.l10n.{json,zh-cn.json}` gain `notify.unexpected` key for the unified-error path
- `webview/` now has its own `tsconfig.json` (was missing)

### Deprecated

- `mindMapLog()` — call sites should migrate to `agentLog.info()` over time

---

## [0.2.2] — 2026-06-15

### Added

- **Multilingual mind map output**: auto-detect primary language from `user_query` questions (Chinese, English, Japanese, Korean); structural labels (e.g. "Related code", "Research", concept map titles) follow the detected language via `outputLanguageLabels`
- **UI locale placeholders**: `agentMindmap.ui.locale` extended with `ja` and `ko`; `scripts/check-l10n-keys.mjs` keeps locale bundles in sync with the English baseline
- **Multilingual eval fixtures**: sample JSONL workspaces in `test/fixtures/multilingual-jsonl/` and HTML export harness for cross-language smoke tests

### Changed

- **English LLM prompts**: production analysis prompts (`session-analysis`, `merge-session-analysis`, code-ref extraction) are now English; `agentMindmap.llm.promptLanguage` (`auto` | `en` | `zh`) acts as an output-language override and invalidates the session cache when changed
- **Pipeline version bump**: existing `SessionRecord` / merge caches re-analyze on upgrade

### Fixed

- **Code references**: transcripts using `ApplyPatch` tool calls no longer drop file paths or write snippets (Cursor + Claude Code parsers)
- **CI / local tests**: extension tests no longer require legacy eval fixtures to be present on disk

---

## [0.2.1] — 2026-06-13

### Changed

- Updated extension marketplace details with a clearer product overview, feature list, usage guide, settings summary, privacy note, GitHub repository link, and feedback path.

### Fixed

- Optimized code reference extraction via LLM for more accurate file path and line range detection.

---

## [0.2.0] — 2026-06-12

Initial public release. See `extension/CHANGELOG.md` for the feature list.

---

## [0.1.1] — 2026-06-12

Internal pre-release. Refer to git history for details.

[Unreleased]: https://github.com/abeelu688/agent-mindmap/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/abeelu688/agent-mindmap/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/abeelu688/agent-mindmap/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/abeelu688/agent-mindmap/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/abeelu688/agent-mindmap/releases/tag/v0.1.1
