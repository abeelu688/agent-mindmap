#!/usr/bin/env bash
# Run the workspace build in bash so gvm/zsh cd hooks cannot break compilation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm run version:sync
npm run build:shared
npm run build:mcp
npm run build:webview
npm run build:extension
