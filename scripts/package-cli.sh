#!/usr/bin/env bash
# Build the CLI (and required webview media), then install it globally.
#
# `npm install -g ./cli` fails: cli/package.json has monorepo `file:../core` and
# `file:../shared` deps that do not exist under the global prefix. The esbuild
# bundle already inlines those packages, so we stage a packable package without
# them before installing.
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
ensure_dir_deps cli

# CLI media needs webview.js/css (vite) + transcript-markdown.js (extension esbuild).
if [[ ! -f "$ROOT/extension/media/webview.js" ]]; then
  echo "==> Building webview assets..."
  ensure_dir_deps webview
  npm run build:webview
fi

if [[ ! -f "$ROOT/extension/media/transcript-markdown.js" ]]; then
  echo "==> Building transcript-markdown.js (extension esbuild)..."
  ensure_dir_deps extension
  # Prefer the media-producing esbuild step only; skip eval/multilingual helpers.
  (
    cd "$ROOT/extension"
    node esbuild.config.mjs
  )
fi

echo "==> Building CLI..."
npm run build:cli

if [[ ! -f "$ROOT/cli/dist/index.js" ]]; then
  echo "ERROR: cli/dist/index.js missing after build" >&2
  exit 1
fi
if [[ ! -f "$ROOT/cli/media/webview.js" ]]; then
  echo "ERROR: cli/media/webview.js missing after build" >&2
  exit 1
fi

prefix="$(npm config get prefix)"
if [[ ! -w "$prefix" ]] && [[ ! -w "$(dirname "$prefix")" ]]; then
  prefix="${npm_config_prefix:-$HOME/.local}"
  mkdir -p "$prefix"
  echo "==> Default npm prefix is not writable; using $prefix"
fi

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/agent-mindmap-cli-pack.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

echo "==> Staging installable package (no file: monorepo deps) ..."
mkdir -p "$STAGE/dist" "$STAGE/media" "$STAGE/scripts"
cp -a "$ROOT/cli/dist/." "$STAGE/dist/"
cp -a "$ROOT/cli/media/." "$STAGE/media/"
cp -a "$ROOT/cli/scripts/patch-sqlite3-binding.js" "$STAGE/scripts/"

node <<EOF
const fs = require("fs");
const path = require("path");
const src = JSON.parse(fs.readFileSync(path.join("$ROOT", "cli", "package.json"), "utf8"));
const staged = {
  name: src.name,
  version: src.version,
  description: src.description,
  license: src.license,
  bin: src.bin,
  main: "dist/index.js",
  files: ["dist", "media", "scripts"],
  scripts: {
    postinstall: "node scripts/patch-sqlite3-binding.js",
  },
  dependencies: {
    // Bundled into dist/index.js — keep only native/runtime externals.
    "@vscode/sqlite3": src.dependencies["@vscode/sqlite3"],
  },
};
if (!staged.dependencies["@vscode/sqlite3"]) {
  console.error("ERROR: cli/package.json missing @vscode/sqlite3 dependency");
  process.exit(1);
}
fs.writeFileSync(path.join("$STAGE", "package.json"), JSON.stringify(staged, null, 2) + "\\n");
EOF

echo "==> Installing CLI globally (prefix=$prefix) ..."
npm install -g "$STAGE" --prefix "$prefix"

echo ""
echo "Done. CLI installed under $prefix"
echo "  bin: $prefix/bin/agent-mindmap"
echo "  bin: $prefix/bin/amind"
if [[ ":$PATH:" != *":$prefix/bin:"* ]]; then
  echo ""
  echo "Note: add to PATH if needed:"
  echo "  export PATH=\"$prefix/bin:\$PATH\""
fi
