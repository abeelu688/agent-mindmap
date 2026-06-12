#!/usr/bin/env bash
# Download @vscode/sqlite3 prebuilt native binaries for all platforms.
# Places them under extension/node_modules/@vscode/sqlite3/lib/binding/
# so sqlite3-binding.js can find them at runtime.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQLITE3_DIR="$ROOT/extension/node_modules/@vscode/sqlite3"
BINDING_DIR="$SQLITE3_DIR/lib/binding"

# Prebuilds from TryGhost/node-sqlite3 v5.1.x (ABI-compatible with @vscode/sqlite3 v5.1.12-vscode)
PREBUILD_VERSION="v5.1.7"
BASE_URL="https://github.com/TryGhost/node-sqlite3/releases/download/${PREBUILD_VERSION}"

# Platforms: napi-v6 only (VS Code 1.85+ ships Node 18+ which supports napi-v6)
# Format: napi-v{napi}-{platform}-{libc}-{arch}
PLATFORMS=(
  "napi-v6-darwin-arm64"
  "napi-v6-darwin-x64"
  "napi-v6-linux-arm64"
  "napi-v6-linux-x64"
  "napi-v6-linuxmusl-arm64"
  "napi-v6-linuxmusl-x64"
  "napi-v6-win32-x64"
)

echo "==> Downloading @vscode/sqlite3 prebuilds (${PREBUILD_VERSION})..."

mkdir -p "$BINDING_DIR"

for platform in "${PLATFORMS[@]}"; do
  target_dir="$BINDING_DIR/$platform"
  if [[ -f "$target_dir/node_sqlite3.node" ]]; then
    echo "  [skip] $platform (already exists)"
    continue
  fi

  tarball="sqlite3-${PREBUILD_VERSION}-${platform}.tar.gz"
  url="${BASE_URL}/${tarball}"
  tmpdir="$(mktemp -d)"

  echo -n "  [$platform] "
  if curl -sL "$url" -o "$tmpdir/$tarball"; then
    mkdir -p "$target_dir"
    # Extract only the .node file from the tarball
    tar xzf "$tmpdir/$tarball" -C "$target_dir" --include="*.node" --strip-components=2 2>/dev/null || \
    tar xzf "$tmpdir/$tarball" -C "$target_dir" --wildcards="*.node" --strip-components=2 2>/dev/null || \
    tar xzf "$tmpdir/$tarball" -C "$target_dir" 2>/dev/null

    # Find and move the .node file to the correct location
    node_file="$(find "$target_dir" -name "*.node" -type f 2>/dev/null | head -1)"
    if [[ -n "$node_file" && "$node_file" != "$target_dir/node_sqlite3.node" ]]; then
      mv "$node_file" "$target_dir/node_sqlite3.node"
    fi

    if [[ -f "$target_dir/node_sqlite3.node" ]]; then
      size="$(du -sh "$target_dir/node_sqlite3.node" | cut -f1)"
      echo "OK ($size)"
    else
      echo "FAILED (no .node found in tarball)"
      rm -rf "$target_dir"
    fi
  else
    echo "FAILED (download error)"
  fi

  rm -rf "$tmpdir"
done

echo ""
echo "Prebuilds downloaded to: $BINDING_DIR/"
ls -la "$BINDING_DIR/" 2>/dev/null
