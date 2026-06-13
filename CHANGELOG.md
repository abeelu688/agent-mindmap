# Changelog

All notable changes to Agent Mind Map will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Open-source readiness**: `CONTRIBUTING.md` (EN + zh-cn), `CODE_OF_CONDUCT.md`, `SECURITY.md`, MIT license header, README badges, double-language README cross-links
- **Unified error handling**: `AgentMindmapError` base class, `agentLog` (debug/info/warn/error), `notify()` / `notifyInfo` / `notifyWarning` / `notifyError`, `wrapCommand()` for command handlers — replaces 30+ scattered `console.*` calls and 24+ direct `vscode.window.showXxx` calls
- **Entry-file refactor**: `extension.ts` slimmed from 1,229 → 232 lines; commands extracted to `extension/src/commands/`, batch-merge orchestration into `extension/src/batch/`
- **CI / tooling**: ESLint 9 flat config, Prettier, GitHub Actions CI, husky + lint-staged pre-commit, `npm run typecheck:{extension,webview}`, `npm run check` umbrella script
- **i18n infrastructure**: `bundle.l10n.ja.json` and `bundle.l10n.ko.json` placeholders; `agentMindmap.ui.locale` extended to `auto | en | zh-cn | ja | ko`; new `agentMindmap.llm.promptLanguage` setting; `resolvePromptLanguage()` follows UI locale; `promptOutline.ts` is the reference implementation for language-aware prompts; `scripts/check-l10n-keys.mjs` ensures locale bundles stay in sync with the English baseline
- **Community infrastructure**: Issue templates (bug / feature / question), PR template, label catalog in `docs/MAINTAINING.md`, this `CHANGELOG.md`, `docs/RELEASE.md` release runbook, `docs/ARCHITECTURE.md`

### Changed

- `LlmProviderError` retained alongside `AgentMindmapError`; `toMindmapError()` bridges them
- `extension/l10n/bundle.l10n.{json,zh-cn.json}` gain `notify.unexpected` key for the unified-error path
- `extension/package.json` settings: `agentMindmap.ui.locale` enum widened, `agentMindmap.llm.promptLanguage` added
- `webview/` now has its own `tsconfig.json` (was missing)

### Deprecated

- `mindMapLog()` — call sites should migrate to `agentLog.info()` over time

### Known issues

- 3 pre-existing test failures unrelated to this release: `sessionStore.test.ts > isRecordFresh`, `workspaceToSlug.test.ts > windows drive letter slug`, `reattachTimeout.test.ts > scaleMergeSessionAnalysisTimeoutMs`
- 49 pre-existing TypeScript errors in `extension/src/` and 17 in `webview/src/` — `tsc --noEmit` runs as a non-blocking soft check in CI; tracked for future cleanup
- LLM prompts other than `promptOutline.ts` are still Chinese-only; a community migration is open in CONTRIBUTING

---

## [0.1.1] — 2026-06-12

Internal pre-release. Refer to git history for details.

[Unreleased]: https://github.com/abeelu688/agent-mindmap/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/abeelu688/agent-mindmap/releases/tag/v0.1.1
