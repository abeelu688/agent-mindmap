#!/usr/bin/env bash
# Build the CLI bundle and install it globally as `agent-mindmap` / `amind`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm run build:cli
npm install -g ./cli

echo "Installed. Try: agent-mindmap version   (or: amind version)"
