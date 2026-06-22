# @agent-mindmap/core

VS Code-free business logic shared between the [Agent Mind Map VS Code
extension](../extension) and the upcoming [Agent Mind Map CLI](../cli) (not yet
present in the repo).

> **Status — P1.1 scaffold only.** This package currently exports nothing
> useful. Subsequent phase-1 PRs (see
> [`plans/cli-master.md`](../../agent-mindmap-projects/plans/cli-master.md) in
> the orchestration hub) move VS Code-free modules out of `extension/src/` into
> `core/src/`:
>
> - P1.2 — `transcript/`
> - P1.3 — `host/`
> - P1.4 — `store/`
> - P1.5 — `pipeline/`
> - P1.6 — `llm/`
> - P1.7 — `mindmap/`
> - P1.8 — `export/`
> - P1.9 — `mcp/` (core half)
> - P1.10 — `codeRefQueue.ts` (with VS Code-free `drainCodeRefQueue()`)
> - P1.11 — `useCases/` thin orchestrators

## Why this package exists

The extension and the CLI are two surfaces over the same pipeline. By keeping
the pipeline / store / transcript / host / llm / export / queue logic in this
package, we avoid duplicate implementations and guarantee that a session
analyzed in either surface lands the same way on disk.

Anything that touches the `vscode` module belongs in `extension/` — not here.

## Build & test

```bash
npm install --prefix core
npm run build --prefix core
npm test --prefix core
```

The root `npm run build` already invokes `build:core` between `build:shared`
and `build:mcp`.

## See also

- [`docs/CLI.md`](../../agent-mindmap-projects/docs/CLI.md) — CLI design
- [`plans/cli-master.md`](../../agent-mindmap-projects/plans/cli-master.md) — Master PR plan (P1.1 lands this scaffold)
- [`extension/CLAUDE.md`](../CLAUDE.md) — extension conventions
