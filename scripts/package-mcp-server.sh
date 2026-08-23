#!/usr/bin/env bash
# Build the MCP server, then install it globally as @agent-mindmap/mcp-server.
#
# Mirrors package-cli.sh. The CLI's `amind mcp install` writes a config that
# points at `<cliDir>/../mcp-server/dist/index.js`, i.e. it expects the MCP
# server to live as a sibling of @agent-mindmap/cli under the same global
# scope. package-cli.sh only installs the CLI, so this script fills the gap by
# installing the server package alongside it.
#
# `npm install -g ./mcp-server` fails for the same reason as the CLI:
# mcp-server/package.json has monorepo `file:../core` and `file:../shared` deps
# that do not exist under the global prefix. The esbuild bundle already inlines
# those packages, so we stage a packable package without them before installing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Workspace: $ROOT"

ensure_dir_deps() {
  local dir="$1"
  if [[ ! -d "$ROOT/$dir/node_modules" ]]; then
    echo "==> Installing $dir dependencies..."
    npm install --prefix "$dir"
  fi
}

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "==> Installing root dependencies..."
  npm install
fi

ensure_dir_deps shared
ensure_dir_deps core
ensure_dir_deps mcp-server

echo "==> Building MCP server..."
npm run build:mcp

if [[ ! -f "$ROOT/mcp-server/dist/index.js" ]]; then
  echo "ERROR: mcp-server/dist/index.js missing after build" >&2
  exit 1
fi

prefix="$(npm config get prefix)"
if [[ ! -w "$prefix" ]] && [[ ! -w "$(dirname "$prefix")" ]]; then
  prefix="${npm_config_prefix:-$HOME/.local}"
  mkdir -p "$prefix"
  echo "==> Default npm prefix is not writable; using $prefix"
fi

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/agent-mindmap-mcp-pack.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

echo "==> Staging installable package (no file: monorepo deps) ..."
mkdir -p "$STAGE/dist" "$STAGE/scripts"
cp -a "$ROOT/mcp-server/dist/." "$STAGE/dist/"
cp -a "$ROOT/mcp-server/scripts/patch-sqlite3-binding.js" "$STAGE/scripts/"

node <<EOF
const fs = require("fs");
const path = require("path");
const src = JSON.parse(fs.readFileSync(path.join("$ROOT", "mcp-server", "package.json"), "utf8"));
const staged = {
  name: src.name,
  version: src.version,
  description: src.description,
  license: src.license || "MIT",
  bin: src.bin,
  main: "dist/index.js",
  files: ["dist", "scripts"],
  scripts: {
    postinstall: "node scripts/patch-sqlite3-binding.js",
  },
  dependencies: {
    // Bundled into dist/index.js - keep only native/runtime externals.
    "@vscode/sqlite3": src.dependencies["@vscode/sqlite3"],
  },
};
if (!staged.dependencies["@vscode/sqlite3"]) {
  console.error("ERROR: mcp-server/package.json missing @vscode/sqlite3 dependency");
  process.exit(1);
}
fs.writeFileSync(path.join("$STAGE", "package.json"), JSON.stringify(staged, null, 2) + "\\n");
EOF

echo "==> Installing MCP server globally (prefix=$prefix) ..."
npm install -g "$STAGE" --prefix "$prefix"

echo ""
echo "Done. MCP server installed under $prefix"
echo "  entry: $prefix/lib/node_modules/@agent-mindmap/mcp-server/dist/index.js"
if [[ -n "$(command -v agent-mindmap-mcp 2>/dev/null)" ]]; then
  echo "  bin:   $prefix/bin/agent-mindmap-mcp"
fi
echo ""
echo "The path written by 'amind mcp install' now resolves. Verify with:"
echo "  claude mcp list"
