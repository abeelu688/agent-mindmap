# @agent-mindmap/core

VS Code-free business logic shared between the [Agent Mind Map VS Code
extension](../extension) and the [Agent Mind Map CLI](../cli).

## Why this package exists

The extension and the CLI are two surfaces over the same pipeline. By keeping
the pipeline / store / transcript / host / llm / export / queue logic in this
package, we avoid duplicate implementations and guarantee that a session
analyzed in either surface lands the same way on disk.

Anything that touches the `vscode` module belongs in `extension/` — not here.

## Architecture — core/ vs extension/ boundary

### What lives in core/

| Directory     | Contents                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pipeline/`   | Session analysis pipeline, merge pipeline, snapshot hierarchy, all pipeline stages                               |
| `batch/`      | Batch concept merge orchestrators                                                                                |
| `store/`      | Store types, session record management, ontology store, merge snapshot (with `Store` injection)                  |
| `llm/`        | LLM provider factory, prompt builders, headless CLI dispatch, IO dump                                            |
| `transcript/` | JSONL parsing, session listing, Cursor state.vscdb reader                                                        |
| `host/`       | Host abstraction (AgentHost), host registry, slug derivation                                                     |
| `mindmap/`    | Mind map data builders (topic/turn/merge views)                                                                  |
| `export/`     | Offline HTML package export                                                                                      |
| `mcp/`        | MCP config core logic (VS Code-aware half stays in extension)                                                    |
| `useCases/`   | Thin orchestrators consumed by command handlers                                                                  |
| `ports/`      | Port interfaces: `ProgressReporter`, `LocalizedStringResolver`, `MindMapSink`, `LlmDumpDeps`, `HeartbeatFactory` |
| `ui/`         | Theme/layout direction types                                                                                     |

### What stays in extension/ (and why)

| Path                                             | Reason it can't move to core                                       |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `src/extension.ts`                               | VS Code `activate`/`deactivate` entry point                        |
| `src/commands/`                                  | VS Code command handlers using `vscode.window`, `vscode.workspace` |
| `src/webview/`                                   | `vscode.window.createWebviewPanel`                                 |
| `src/l10n/uiTranslate.ts`                        | `vscode.l10n.t()`                                                  |
| `src/progress.ts`, `progressHelpers.ts`          | `vscode.window.withProgress`                                       |
| `src/notify.ts`                                  | `vscode.window.showInformationMessage`                             |
| `src/host/cursorHost.ts`                         | VS Code wrapper around core host logic                             |
| `src/store/storeClient.ts`, `storeFactory.ts`    | `ExtensionContext.globalStorageUri`                                |
| `src/store/sanitizeRecords.ts`                   | Adapter — injects `getHostById()`                                  |
| `src/store/mergeConceptTrie.ts`                  | Adapter — injects `getHostById()`                                  |
| `src/pipeline/llmStage.ts`, `llmStageAdapter.ts` | Adapters — inject VS Code-backed progress                          |
| `src/pipeline/deltaMergePipeline.ts`             | Adapter — injects `tryReuseBatchMerge` from extension              |
| `src/pipeline/batchMergeCache.ts`                | Adapter — uses `getStoreDir()` + `mindMapLog`                      |
| `src/adapters/`                                  | Wire core ports to VS Code APIs (provider, host, store)            |
| `src/llm/cliInstallGuideUi.ts`                   | VS Code UI for CLI install                                         |

### Dependency injection pattern

Core functions that need surface-specific behavior accept **port interfaces**
as parameters rather than importing concrete implementations:

- `Store` — injected by extension (`getStoreForDir()`) or CLI (`buildCliStoreAccess()`)
- `ProgressReporter` — extension provides VS Code progress; CLI provides `ora` spinner
- `LlmDumpDeps` — extension provides VS Code file picker; CLI provides no-op
- `LocalizedStringResolver` — extension provides `vscode.l10n.t()`; CLI provides English passthrough
- `sanitizeRecord` — extension injects host-specific transcript parsing; CLI does the same
- `tryReuseBatchMergeFn` — extension injects cache lookup; CLI skips caching

### Boundary rules (enforced by CI)

See `plans/cli-refactor-cleanup-master.md` § Architecture rules A1–A10. The
key rules:

- **A1**: core/ is VS Code-free — no `import "vscode"`, no extension/cli imports
- **A2**: cli/ imports only from `@agent-mindmap/core` (or `@agent-mindmap/shared`)
- **A5**: No pure re-export shims — callers import directly from `@agent-mindmap/core`
- **A9**: No deep imports into `@agent-mindmap/core/` — use the barrel

These are enforced by:

- `scripts/check-package-boundaries.mjs` (run by `npm run check:boundaries`)
- `eslint import/no-restricted-paths` zones (run by `npm run lint`)
- `scripts/smoke-cli-boundaries.mjs` (run by `npm run smoke:cli-boundaries`)

## Build & test

```bash
npm run build:core       # Build shared + core
npm run typecheck:core   # Type-check core only
npm run test:vitest      # Run all vitest tests
```

The root `npm run build` already invokes `build:core` between `build:shared`
and `build:mcp`.

## See also

- [`docs/CLI.md`](../../agent-mindmap-projects/docs/CLI.md) — CLI design
- [`plans/cli-master.md`](../../agent-mindmap-projects/plans/cli-master.md) — Original CLI plan (Phases 1-5 landed)
- [`plans/cli-refactor-cleanup-master.md`](../../agent-mindmap-projects/plans/cli-refactor-cleanup-master.md) — Refactor cleanup plan (R0–R5)
- [`CLAUDE.md`](../CLAUDE.md) — Workspace-level conventions
