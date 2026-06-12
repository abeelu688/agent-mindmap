# Contributing to Agent Mind Map

Thank you for your interest in contributing! This guide covers everything you need to get started.

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-org/agent-mindmap.git
cd agent-mindmap
npm install
npm install --prefix extension
npm install --prefix webview

# Build
npm run build

# Test
npm run test:vitest    # vitest (no build needed)
npm test               # extension node tests (builds first)

# Develop
npm run watch          # watch both extension + webview
# Then press F5 in VS Code to launch Extension Development Host
```

## Development Workflow

1. **Fork** the repository
2. **Create a branch** from `main`: `feature/short-desc`, `fix/short-desc`, or `i18n/locale`
3. **Make changes** — follow the coding conventions below
4. **Test** — run `npm run test:vitest && npm test`
5. **Lint** — run `npm run lint` (if configured)
6. **Commit** — use [Conventional Commits](https://www.conventionalcommits.org/) format
7. **Push** and open a **Pull Request**

## Commit Messages

Use the Conventional Commits format:

```
type(scope): description

feat(llm): add Japanese prompt language support
fix(store): prevent race condition in atomic write
refactor(commands): extract analyzeProject from extension.ts
docs: update README with multi-language badges
i18n(ja): add Japanese UI translations
chore: update dependencies
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `i18n`, `test`, `chore`, `perf`

## Coding Conventions

### TypeScript

- `strict: true` — all new code must pass `tsc --noEmit`
- Prefer `type` over `interface` for object shapes
- Use `import type` for type-only imports
- Use `as const` for literal objects used as enums

### Error Handling

- LLM errors: use `LlmProviderError` with a specific `LlmErrorCode`
- Never silently swallow errors in `catch {}` — at minimum, log them
- Store/transcript errors should use the unified logging system (see `src/log.ts`)

### Import Order

1. Node builtins (`fs`, `path`, `child_process`)
2. External packages (`vscode`, `markdown-it`)
3. Internal modules (`../llm/`, `../store/`)

### Testing

- Test files go in `test/` at the repo root
- Name the test file after the source module: `reattachChanges.test.ts` → `reattachChanges.ts`
- VS Code API is stubbed via `test/vscode-stub.cjs`
- Use `__testing` exports for testing internal functions
- Run tests before submitting: `npm run test:vitest && npm test`

### L10n / i18n

- UI strings: use `t(key, englishMessage, ...args)` or `uiTranslate(key, englishMessage, ...args)`
- Always add new keys to **both** `extension/l10n/bundle.l10n.json` AND `extension/l10n/bundle.l10n.zh-cn.json`
- LLM prompt language is controlled by the `PromptLanguage` type

## Architecture Overview

For a detailed architecture description, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (coming soon) or read [CLAUDE.md](CLAUDE.md).

Key points:

- **Extension** (`extension/src/`) runs in Node.js, handles LLM calls and data persistence
- **Webview** (`webview/src/`) runs in a browser iframe, renders the mind map via mind-elixir
- **Two rendering modes**: Topic view (LLM-powered) and Turn view (chronological fallback)
- **Store** (`~/.agent-mindmap/`) persists analysis results across sessions and projects
- **No API key needed** — uses the existing Cursor/Claude CLI subscription

## Common Tasks

### Adding a New LLM Prompt Stage

1. Create `extension/src/llm/promptXxx.ts` with `buildXxxPrompt()`
2. Add schema name to `LlmResponseSchema` in `llm/types.ts`
3. Add `parseXxxFromStdout()` in `llm/headlessCli.ts`
4. Add the case to `parseBySchema()` in `headlessCli.ts`
5. Bump `PIPELINE_VERSION` if the output schema is new or changed
6. Add tests in `test/`

### Adding a New Host (e.g., Windsurf)

1. Create `extension/src/host/windsurfHost.ts` implementing `AgentHost`
2. Register in `extension/src/host/registry.ts`
3. Add host ID to `AgentHostId` type in `host/types.ts`
4. Add transcript parsing if JSONL format differs
5. Add CLI provider in `extension/src/llm/` if headless CLI differs

### Adding a New UI Language

1. Create `extension/l10n/bundle.l10n.<locale>.json` with all keys from `bundle.l10n.json`
2. Update `UiLocaleSetting` in `l10n/uiTranslate.ts`
3. Update `agentMindmap.ui.locale` enum in `extension/package.json`
4. Add a cross-link in `README.md`
5. Add prompt translations if applicable (see below)

### Translating LLM Prompts

LLM prompts are currently in Chinese only. To add English (or other language) prompts:

1. Extract fixed text from `promptXxx.ts` into a `promptTexts` object keyed by `PromptLanguage`
2. Extend `PromptLanguage` type in `llm/promptLanguage.ts`
3. Ensure the JSON output schema remains identical across languages
4. Add `agentMindmap.llm.promptLanguage` setting (or follow `ui.locale`)
5. Bump `PIPELINE_VERSION` — prompt language changes invalidate caches

> **Note:** LLM prompt translation requires both fluency in the target language AND familiarity with AI product usage patterns. A direct word-for-word translation may produce worse results than the original.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
