# Review PR Plan — agent-mindmap (hardening & cleanup)

> **Source**: Codebase review conducted 2026-06-21 across the `agent-mindmap` repo (extension / webview / mcp-server / shared / test).
>
> **Scope**: Security, reliability, and engineering-quality fixes surfaced by review. These are _new_ PRs on top of the landed Team Mode work — they do not alter the Team Mode plan in the orchestration hub.
>
> **Convention**: PRs numbered `P<phase>.<sequence>`. Phases land in order; PRs within a phase land in sequence unless noted. Every PR keeps tests green (`npm run test:vitest`).
>
> **Status legend**: ✅ landed · 🔶 in progress · ⬜ not started

---

## Findings → PR mapping

| PR   | Severity | Area                | Summary                                                                 |
| ---- | -------- | ------------------- | ----------------------------------------------------------------------- |
| R1.1 | 高       | security (MCP)      | Code-ref path traversal escape                                          |
| R1.2 | 高       | security (export)   | Offline transcript HTML XSS via raw HTML + innerHTML                    |
| R2.1 | 中       | reliability (LLM)   | CLI stdout/stderr unbounded accumulation                                |
| R2.2 | 中       | reliability (MCP)   | Staleness reads whole file; large-file DoS                              |
| R2.3 | 中       | reliability (store) | LLM cache non-atomic write                                              |
| R2.4 | 中       | reliability (MCP)   | Resource `limit`/`offset` not normalized                                |
| R3.1 | 中       | Windows CLI         | `shell:true` fallback escaping incomplete                               |
| R3.2 | 中       | tooling             | Root `typecheck` skips mcp-server                                       |
| R3.3 | 低       | tooling             | `watch` script not cross-platform                                       |
| R4.1 | 中       | tests               | webview / MindMapHost lifecycle tests                                   |
| R4.2 | 中       | maintainability     | Split large modules (sessionLoader, extractCodeReferences, searchIndex) |
| R5.1 | 低       | docs                | Sync CLAUDE.md/README prompt-language description                       |
| R5.2 | 低       | webview CSP         | Tighten `style-src 'unsafe-inline'`                                     |
| R5.3 | 低       | module boundary     | Clarify shared re-export wrappers                                       |

---

## Phase R1 — Security

### P R1.1 — MCP code-ref path traversal hardening ⬜

- **Files**: `mcp-server/src/pathsMap.ts` (resolvePath, ~L90-96), `mcp-server/src/handlers.ts` (~L188-265), `test/mcpPathsMap.test.ts`
- **Problem**: `createPathsResolver().resolvePath()` does `path.join(map[slug], relPath)` directly from `CodeReference.path`, then handlers `fs.readFile()` the result. A persisted/team/LLM-sourced ref containing `../../etc/passwd` or an absolute path can escape the project root and read arbitrary local files during staleness checks.
- **Approach**:
  - Resolve to absolute via `path.resolve(root, relPath)`; require result `=== root` or startsWith `root + path.sep`.
  - Reject absolute paths, empty paths, and `..` escapes; return a new resolver result kind `{ kind: "path-escape" }`.
  - Handlers map `path-escape` → staleness `unknown` (or `stale`); never read the file.
  - Tests: `../secret.txt`, `../../etc/passwd`, absolute path, Windows `..\secret.txt`, symlink edge.
- **Deps**: none
- **Risk**: low — narrows resolution, adds error kind.

### P R1.2 — Offline transcript HTML sanitization ⬜

- **Files**: `extension/src/export/renderTranscriptMarkdownHtml.ts` (~L334, L365-373), `extension/src/export/exportPackage.ts` (~L171), new test file
- **Problem**: `MarkdownIt({ html: true })` keeps raw HTML from untrusted transcript content; the offline page injects it via `innerHTML`. Malicious `<script>`, `onerror`, or `javascript:` links execute when the exported HTML is opened in a browser.
- **Approach**:
  - Set `html: false` if no internal HTML is needed; otherwise sanitize with a whitelist sanitizer.
  - Add link-protocol allowlist (`http`, `https`, `mailto`); drop `javascript:`, `data:` (except images if required).
  - Keep project-generated citation/table markup working — verify export snapshot parity.
  - Tests: `<img src=x onerror=...>`, `<script>`, `javascript:` link, normal markdown unaffected.
- **Deps**: none
- **Risk**: medium — must verify export output still renders intended elements; snapshot tests guard this.

---

## Phase R2 — Reliability (resource & DoS guards)

### P R2.1 — Cap LLM CLI stdout/stderr ⬜

- **Files**: `extension/src/llm/headlessCli.ts` (~L88-89, L140-178)
- **Problem**: `stdout += chunk` / `stderr += chunk` accumulate without bound until process exit or timeout. Runaway LLM output or log storms can balloon extension-host memory; the error object retains full buffers.
- **Approach**:
  - Add `MAX_STDOUT_BYTES` (e.g. 8 MB) and `MAX_STDERR_BYTES`; on exceed, kill process, return `output-too-large`.
  - Keep only a stderr tail (e.g. last 32 KB) for error messages.
  - Tests: very large stdout, infinite stderr flood, normal output unaffected.
- **Deps**: none

### P R2.2 — Bound staleness file reads ⬜

- **Files**: `mcp-server/src/handlers.ts` (`readFileForCodeRef`, `backFillStaleness`, ~L188-265)
- **Problem**: Each distinct `(slug, path)` is fully `fs.readFile`'d in sequence. Large/minified/wrong-path files slow search/retrieve and spike memory.
- **Approach**:
  - `fs.stat` first; skip files over a threshold (e.g. 1–2 MB) → staleness `unknown`/`stale-large-file`.
  - Bounded concurrency for multi-hit reads instead of strict serial.
  - If code ref carries line numbers, read only relevant range for substring match.
  - Tests: large file, many hits, missing path.
- **Deps**: none

### P R2.3 — Atomic LLM cache writes ⬜

- **Files**: `extension/src/pipeline/llmStage.ts` (~L87-91), `extension/src/llm/summarizeSession.ts` (~L57-61), reuse `extension/src/store/atomicWrite.ts`
- **Problem**: Cache files are written with plain `fs.writeFile`. Concurrent analysis of the same project or an interrupted write can leave corrupt JSON; reads silently miss, silently re-costing LLM calls.
- **Approach**:
  - Route cache writes through the shared atomic-write helper (temp file + rename).
  - Log write failures at debug level instead of fully silent.
  - Tests: simulated half-write recovery, concurrent write to same cache key.
- **Deps**: none
- **Note**: CLAUDE.md already mandates atomic store writes — this brings caches in line.

### P R2.4 — Normalize MCP resource pagination ⬜

- **Files**: `mcp-server/src/index.ts` (~L270-286), shared helper
- **Problem**: Registered resources parse `uri.searchParams` `limit`/`offset` via `Number()` then use directly in `slice()`. `Infinity`, negative, `NaN`, or huge values produce broken paging / oversized responses.
- **Approach**:
  - Extract `parsePaginationParams()` clamping `limit 1..100`, `offset >= 0`; invalid → defaults.
  - Reuse for both tools and resources.
  - Tests: edge values across resource + tool paths.
- **Deps**: none

---

## Phase R3 — Engineering quality

### P R3.1 — Harden Windows CLI shell fallback ⬜

- **Files**: `extension/src/llm/resolveWindowsCliSpawn.ts` (~L114-144), `extension/src/llm/headlessCli.ts` (~L57-62), `test/resolveWindowsCliSpawn.test.ts`
- **Problem**: Windows fallback uses `shell: true` with a custom `escapeCmdArg()` that only handles double quotes; `cmd.exe` `%VAR%` / `!VAR!` / `^` / `&` / `|` semantics are not covered. `command: bin` may come from user-configured `agentMindmap.llm.cliPath`.
- **Approach**:
  - Prefer resolving the real `.exe` / node-direct spawn; eliminate `shell:true` where possible.
  - If fallback remains, implement argv escaping covering `%`, `!`, `^`, `&`, `|`, `<`, `>`.
  - Validate user-configured `cliPath` more strictly.
  - Tests: metachar args, spaces, quotes.
- **Deps**: none

### P R3.2 — Include mcp-server in root typecheck ⬜

- **Files**: `package.json` (scripts ~L23-30), `mcp-server/tsconfig.json`
- **Problem**: `mcp-server/tsconfig.json` is `strict: true`, but root `typecheck` (and therefore `check`) only covers shared/extension/webview — MCP server type errors can slip past local + CI checks.
- **Approach**:
  - Add `"typecheck:mcp": "tsc --noEmit --project mcp-server/tsconfig.json"`.
  - Wire it into the root `typecheck` aggregate.
- **Deps**: none
- **Risk**: low; may surface pre-existing errors to fix in the same PR.

### P R3.3 — Cross-platform `watch` script ⬜

- **Files**: `package.json` (~L14)
- **Problem**: `"watch": "npm run watch --prefix extension & npm run watch --prefix webview"` relies on POSIX `&`; unreliable on Windows / other shells; orphaned watchers on partial exit.
- **Approach**: use `concurrently` or `npm-run-all`; ensure both children are cleaned on SIGINT/SIGTERM.
- **Deps**: none

---

## Phase R4 — Tests & maintainability

### P R4.1 — webview / MindMapHost lifecycle tests ⬜

- **Files**: new tests under `test/`; possibly extend `vitest.config.ts` for jsdom where needed
- **Problem**: ~100 tests cover pure logic/pipeline, but `webview/src/main.ts`, `extension/src/webview/MindMapHost.ts`, `MindMapPanel.ts`, and command handlers lack direct tests — verified only manually.
- **Approach**:
  - jsdom tests for webview message handling, node click, UI-setting update, loading/batch status.
  - VS Code mock tests for `MindMapHost`: postMessage queue, dispose, file-watch + listener lifecycle.
  - Thin command-handler integration tests for error paths and user prompts.
- **Deps**: none

### P R4.2 — Split large modules ⬜

- **Files**: `extension/src/sessionLoader.ts`, `extension/src/llm/extractCodeReferences.ts`, `shared/src/searchIndex.ts` (each 20–32 KB)
- **Problem**: These mix orchestration + IO + transform + error handling + UI glue; high change risk.
- **Approach**: behavior-preserving splits —
  - `sessionLoader.ts`: cache/freshness · provider selection · store persistence · webview update.
  - `extractCodeReferences.ts`: prompt build · parse/validate · post-process.
  - `searchIndex.ts`: tokenization · ranking · render-support data.
  - Move/add tests with each split.
- **Deps**: none; sequence after R4.1 so the new surfaces are test-backed.

---

## Phase R5 — Docs & hardening (low severity)

### P R5.1 — Sync prompt-language docs ⬜

- **Files**: `CLAUDE.md` (~L167), `README.md` (~L147-148); cross-ref `extension/src/llm/promptLanguage.ts`, `promptSessionAnalysis.ts`
- **Problem**: CLAUDE.md says prompts are "hardcoded in Chinese", but production prompts are English and `OutputLanguage` defaults to English. Misleads contributors changing prompt/schema/cache version.
- **Approach**: rewrite the LLM-prompt section to reflect current English prompts + output-language detection; note any legacy Chinese prompts; clarify when `PIPELINE_VERSION` must bump.

### P R5.2 — Tighten webview CSP `style-src` ⬜

- **Files**: `extension/src/webview/mindMapHtml.ts` (~L19), `extension/src/webview/MindMapPanel.ts` (~L47)
- **Problem**: `style-src` allows `'unsafe-inline'`. If mind-elixir / project code can move to classes/nonces, this can be removed.
- **Approach**: audit inline-style usage; migrate to nonce/hash or classes if feasible; otherwise document the constraint in-code.

### P R5.3 — Clarify shared re-export wrappers ⬜

- **Files**: `extension/src/llm/{topicGraphValidate,normalizeConceptPath,llmError,outlineValidate}.ts`, `shared/src/index.ts` (~L97-100)
- **Problem**: Several extension modules only re-export `shared`, blurring import boundaries.
- **Approach**: decide policy (keep as extension-local API with a comment, or migrate callers to import `@agent-mindmap/shared` directly and delete wrappers); execute consistently.

---

## Sequencing

```
R1 (security) → R2 (reliability) → R3 (tooling) → R4 (tests/split) → R5 (docs/hardening)
```

R1 and R2 are independent of each other and can interleave. R4.2 should follow R4.1. Everything else is parallelizable.
