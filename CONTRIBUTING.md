# Contributing to Agent Mind Map

> **[中文版 / Chinese](CONTRIBUTING.zh-cn.md)**

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

The extension's UI strings (notifications, command labels, install guides) live in `extension/l10n/`. To add a new language (e.g., Japanese):

1. **Copy the English bundle as a starting point.** The placeholder files `bundle.l10n.ja.json` and `bundle.l10n.ko.json` already exist as empty templates:

   ```bash
   # Replace the placeholder with the full key set
   cat extension/l10n/bundle.l10n.json > extension/l10n/bundle.l10n.ja.json
   ```

   Then translate every value while keeping the keys intact. Placeholders like `{0}`, `{1}` must remain in the same positions.

2. **Wire the bundle into the runtime loader.** Open [`extension/src/l10n/uiTranslate.ts`](extension/src/l10n/uiTranslate.ts) and add the import + map entry:

   ```ts
   import jaL10n from "../../l10n/bundle.l10n.ja.json";

   const BUNDLES: Partial<Record<UiLocale, Record<string, string>>> = {
     "zh-cn": zhL10n as Record<string, string>,
     ja: jaL10n as Record<string, string>, // ← add
   };
   ```

3. **Update the locale enum.** [`extension/package.json`](extension/package.json) → `agentMindmap.ui.locale.enum` already lists `ja` and `ko`. If you're adding a brand-new language, add it there too.

4. **Verify key consistency.** Run `npm run check:l10n` — it ensures every locale bundle has the same keys as the English baseline.

5. **Add a cross-language link in the README.** Update [`README.md`](README.md) and [`README.zh-cn.md`](README.zh-cn.md) badges, then create `README.<locale>.md` if appropriate.

### Translating LLM Prompts

LLM prompts are currently in Chinese only. The English template scaffold is in place ([`promptOutline.ts`](extension/src/llm/promptOutline.ts) is the reference implementation), and the `agentMindmap.llm.promptLanguage` setting toggles between languages.

To add full English (or other language) prompts:

1. **Pick one prompt at a time.** Each `prompt*.ts` under `extension/src/llm/` has its own JSON output schema. Don't mass-translate — verify each one against the eval pipeline.

2. **Follow the `TEXTS` pattern in [`promptOutline.ts`](extension/src/llm/promptOutline.ts)**: extract every Chinese line into a `TEXTS: Record<PromptLanguage, ...>` object, then assemble the prompt from the localized strings. The JSON schema markers (`{"title":...}`) stay identical across languages.

3. **Verify the JSON output schema is unchanged.** Add a test that runs the new prompt against `validateSessionAnalysis()` (or the relevant validator) with a fixture transcript. Both `zh` and `en` outputs must validate identically.

4. **Run the eval pipeline** (`npm run eval`) with both `agentMindmap.llm.promptLanguage=zh` and `=en` to compare output quality. A direct word-for-word translation often produces worse results than the original — adapt as needed.

5. **Bump `PIPELINE_VERSION`** in [`pipelineVersions.ts`](extension/src/pipeline/pipelineVersions.ts) if your changes alter the JSON output shape (rare for pure language flips, but required for any schema tweak).

> **Note:** LLM prompt translation requires both fluency in the target language AND familiarity with AI product usage patterns. A direct word-for-word translation may produce worse results than the original.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
