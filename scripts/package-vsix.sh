#!/usr/bin/env bash
# Build webview + extension, then produce a .vsix for offline install.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Workspace: $ROOT"
echo "==> Building webview + extension..."
npm run build

echo "==> Packaging VSIX (vsce)..."
npm run package --prefix extension

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
