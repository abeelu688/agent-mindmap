#!/usr/bin/env bash
# Build webview + extension, then produce a .vsix for offline install.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

node_major() {
  node -p 'Number(process.versions.node.split(".")[0])'
}

# @vscode/vsce 3.x pulls cheerio/undici that require Node 20+ (global File API).
ensure_node20_for_vsce() {
  if (( $(node_major) >= 20 )); then
    return 0
  fi

  local candidate dir
  local -a candidates=(
    "/usr/share/cursor/resources/app/resources/helpers/node"
    "/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]] && (( $("$candidate" -p 'Number(process.versions.node.split(".")[0])') >= 20 )); then
      dir="$(dirname "$candidate")"
      PATH="$dir:$PATH"
      export PATH
      echo "==> Using Node $(node -v) from $dir for VSIX packaging"
      return 0
    fi
  done

  if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    if nvm use 20 >/dev/null 2>&1 || nvm use 22 >/dev/null 2>&1 || nvm use lts/iron >/dev/null 2>&1 || nvm use lts/jod >/dev/null 2>&1; then
      echo "==> Using Node $(node -v) via nvm for VSIX packaging"
      return 0
    fi
  fi

  echo "ERROR: @vscode/vsce requires Node.js 20+. Current: $(node -v)" >&2
  echo "Install Node 20, e.g.: nvm install 20 && nvm use 20" >&2
  exit 1
}

echo "==> Workspace: $ROOT"
echo "==> Building webview + extension..."
npm run build

echo "==> Downloading @vscode/sqlite3 prebuilds for all platforms..."
bash "$ROOT/scripts/download-sqlite3-prebuilds.sh"

echo "==> Packaging VSIX (vsce)..."
ensure_node20_for_vsce
(
  cd "$ROOT/extension"
  npm run package
)

shopt -s nullglob
vsix_files=("$ROOT"/extension/*.vsix)
shopt -u nullglob

if ((${#vsix_files[@]} == 0)); then
  echo "ERROR: No .vsix found under extension/" >&2
  exit 1
fi

# Newest file wins if multiple versions exist.
VSIX="$(ls -1t "${vsix_files[@]}" | head -1)"

echo ""
echo "Done. VSIX:"
echo "  $VSIX"
echo ""
echo "Copy to another machine, then install:"
echo "  cursor --install-extension \"$VSIX\""
echo "  # or VS Code:"
echo "  code --install-extension \"$VSIX\""
echo ""
echo "Or in the editor: Extensions → ⋯ → Install from VSIX…"
