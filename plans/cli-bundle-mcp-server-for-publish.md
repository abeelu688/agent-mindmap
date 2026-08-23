# Plan: Bundle the MCP server into `@agent-mindmap/cli` for self-contained publishing

Status: **Draft / not started** — saved for when the CLI is published to npm.
Owner: wel
Created: 2026-07-22

## Problem

`amind mcp install` writes a config whose `args` point at the MCP server entry
resolved by `resolveMcpServerEntry()` in `cli/src/commands/mcp.ts`:

```ts
function resolveMcpServerEntry(): string {
  const cliDir = path.resolve(__dirname, "..");
  const mcpServerPath = path.resolve(cliDir, "..", "mcp-server", "dist", "index.js");
  return mcpServerPath;
}
```

The CLI is a single-file esbuild bundle at `cli/dist/index.js`, so at runtime
`__dirname = <pkg>/dist` and `cliDir = <pkg>`. The resolved path is therefore
`<pkg>/../mcp-server/dist/index.js` — i.e. it expects `@agent-mindmap/mcp-server`
to be installed as a **global sibling** of `@agent-mindmap/cli` under the same
npm scope.

This works today only because the local workflow installs both siblings
(`scripts/package-cli.sh` + `scripts/package-mcp-server.sh`). A published CLI
installed via `npm i -g @agent-mindmap/cli` has **no sibling mcp-server**, so
the config path is unresolvable, `node` fails with `MODULE_NOT_FOUND`, and
`claude mcp list` reports `Failed to connect`. **MCP is unusable for published-CLI
users.** This is the gap the user flagged.

## Prior art: the extension already solves this

`extension/src/mcp/mcpConfig.ts:23` does bundled-first with a dev fallback:

```ts
export async function resolveExistingMcpServerEntry(extensionPath: string) {
  const bundled = path.join(extensionPath, "mcp-server", "index.js"); // shipped in VSIX
  try {
    await fs.access(bundled);
    return bundled;
  } catch {
    const dev = path.join(extensionPath, "..", "mcp-server", "dist", "index.js"); // source tree
    await fs.access(dev);
    return dev;
  }
}
```

And `scripts/bundle-mcp-server.mjs` writes the bundle into `extension/mcp-server/index.js`
so the VSIX ships it. The extension is therefore **self-contained**. The CLI never got
the same treatment — this plan mirrors the extension's pattern for the CLI.

## Goal

`npm i -g @agent-mindmap/cli` (and `package-cli.sh` alone) yields a self-contained
CLI whose MCP server works out of the box. No separate `@agent-mindmap/mcp-server`
install required for CLI users.

## Non-goals

- Do **not** change the extension's flow (it already works).
- Do **not** remove `scripts/package-mcp-server.sh` (still useful as a standalone
  `agent-mindmap-mcp` bin / sibling-package layout; just no longer required for CLI users).
- Do **not** touch LLM prompts or `PIPELINE_VERSION` — no schema change here.

## Changes

### 1. `scripts/bundle-mcp-server.mjs` — add a third output to `cli/mcp-server/index.js`

Currently writes two outputs: `mcp-server/dist/index.js` (primary/dev) and
`extension/mcp-server/index.js` (VSIX). Add a third mirroring the VSIX copy:

- `const CLI_OUT_DIR = path.join(ROOT, "cli", "mcp-server");`
- `const CLI_OUT_FILE = path.join(CLI_OUT_DIR, "index.js");`
- `await fs.mkdir(CLI_OUT_DIR, { recursive: true });` alongside the existing mkdirs.
- After the VSIX copy block, do the same `writeFile(withShebang)` + `chmod(0o755)`
  for `CLI_OUT_FILE` (reuse the already-read `raw`/`withShebang`).
- Add a console log line: `Copied MCP server  -> ${CLI_OUT_FILE} (for CLI packaging)`.

The single producer of the mcp bundle now writes three locations. The `__MCP_SERVER_VERSION__`
define applies to all three (already does — it's in `buildOptions`).

### 2. `cli/src/commands/mcp.ts` — `resolveMcpServerEntry`: bundled-first, dev fallback

Mirror the extension. Make it async and try the bundled copy first:

```ts
async function resolveMcpServerEntry(): Promise<string> {
  const cliDir = path.resolve(__dirname, ".."); // <pkg>
  const bundled = path.resolve(cliDir, "mcp-server", "index.js"); // published/self-contained
  try {
    await fs.access(bundled);
    return bundled;
  } catch {
    const dev = path.resolve(cliDir, "..", "mcp-server", "dist", "index.js"); // source tree
    await fs.access(dev);
    return dev;
  }
}
```

- Update the sole caller in `runMcpInstall` (line ~91): `const serverEntry = await resolveMcpServerEntry();`.
- `fs/promises` is already imported at the top of the file (`import * as fs from "fs/promises"`).
- `__dirname` semantics confirmed: cli bundle is `dist/index.js`, so `__dirname = <pkg>/dist`,
  `cliDir = <pkg>`. Bundled resolves to `<pkg>/mcp-server/index.js`; dev fallback to
  `<pkg>/../mcp-server/dist/index.js`. Both correct.
- Blast radius: only `runMcpInstall` calls it. `mcp status` / `mcp uninstall` are unaffected
  (they don't resolve the entry).

### 3. `scripts/package-cli.sh` — build the mcp bundle and stage `cli/mcp-server/index.js`

- Add `npm run build:mcp` to the build sequence (after `npm run build:cli` is fine; `build:mcp`
  is independent and only needs root `node_modules` for esbuild, which is already ensured).
- Stage the bundled server: `mkdir -p "$STAGE/mcp-server"` and
  `cp -a "$ROOT/cli/mcp-server/index.js" "$STAGE/mcp-server/"`.
- Add `"mcp-server"` to the staged `package.json` `files` array (currently `["dist", "media", "scripts"]`).
- Add a post-stage guard like the existing ones:
  `if [[ ! -f "$ROOT/cli/mcp-server/index.js" ]]; then echo "ERROR ..."; exit 1; fi`.

### `@vscode/sqlite3` resolution (verification, no new dependency)

The mcp bundle externalizes only `@vscode/sqlite3` (see `bundle-mcp-server.mjs`
`external: ["@vscode/sqlite3"]`). In the staged/published cli package the mcp bundle
lives at `<pkg>/mcp-server/index.js`; node resolves `@vscode/sqlite3` by walking up:
`<pkg>/mcp-server/node_modules` (none) → `<pkg>/node_modules/@vscode/sqlite3`
(the cli package's own dep, already kept by `package-cli.sh` and patched by the cli
`postinstall: node scripts/patch-sqlite3-binding.js`). **No extra dependency and no
mcp-server `postinstall` needed** — the cli's patched `@vscode/sqlite3` is reused.

## Relationship to `scripts/package-mcp-server.sh`

After this change, `package-cli.sh` alone is self-contained — CLI users never need
`package-mcp-server.sh`. Keep `package-mcp-server.sh` for two remaining uses:

- the standalone `agent-mindmap-mcp` global bin, and
- anyone who wants the server as a separate global `@agent-mindmap/mcp-server` package.

Optionally add a one-line note to `README.md` / `docs/USAGE.md` that CLI install is
self-contained and the separate server package is optional.

## Dev-mode staleness tradeoff (known, acceptable)

`resolveMcpServerEntry` tries the bundled copy first. In the source tree,
`cli/mcp-server/index.js` may be **stale** from a prior `build:mcp` (the dev fallback
only triggers when it is _absent_, not when stale). This is the same tradeoff the
extension already accepts (`extension/mcp-server/index.js` can be stale in dev).
Mitigation: rerun `npm run build:mcp` after changing mcp-server source. Do not add
runtime staleness detection — over-engineering, and the extension doesn't.

## Testing

- `resolveMcpServerEntry` currently has **no direct tests** (grep found only the
  definition + the single caller). Add unit coverage in `cli/test/mcp.test.ts` (or a
  new `test/` file matching convention) for both branches: bundled-present → returns
  bundled; bundled-absent → returns dev fallback. Use `__testing` export if needed.
- Add a post-stage assertion in `package-cli.sh` (covered in change 3).
- Manual end-to-end (the real acceptance test):
  1. `npm uninstall -g @agent-mindmap/mcp-server` (remove the sibling so we prove
     self-containment), and remove the `agent-mindmap` entry from `~/.claude.json`.
  2. `bash scripts/package-cli.sh` (do **not** run `package-mcp-server.sh`).
  3. `amind mcp install --targets claude-code --scope user`.
  4. `claude mcp list` → `agent-mindmap … ✔ Connected`.
- Run `npm run check:boundaries`, `npm run typecheck`, `npm run test:vitest`.

## Open questions / decisions

- **Q1 — who calls `build:mcp`?** `package-cli.sh` (recommended: least coupling,
  `build:mcp` and `build:cli` stay distinct scripts) vs. making `build:cli` depend on
  `build:mcp` (so `build:cli` alone is publishable). Recommend: `package-cli.sh` calls it.
- **Q2 — async vs sync `resolveMcpServerEntry`?** Recommend **async** to mirror the
  extension exactly. `fs.existsSync` + sync return is a smaller-diff alternative if the
  signature change is unwanted.
- **Q3 — keep the dev fallback?** Yes — required for source-tree dev where
  `cli/mcp-server/index.js` may not exist yet.

## Out of scope / future

- The actual npm publish workflow (`npm publish`, version sync via
  `scripts/sync-version.mjs`, making `mcp-server/package.json` non-`private` if it is
  ever published separately) is a separate effort. **This plan only makes the CLI
  package self-contained so that publishing is viable** — it does not implement publishing.
