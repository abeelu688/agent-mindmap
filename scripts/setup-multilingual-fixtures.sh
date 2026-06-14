#!/usr/bin/env bash
# Wire multilingual JSONL fixtures into Cursor-style project layout for manual testing.
#
# Creates:
#   <TEST_ROOT>/<slug>/agent-transcripts/<session-id>/<session-id>.jsonl  (symlinks)
#   /zh/inventory/admin, /en/payments/api, /ja/docs/portal, /ko/observability/hub  (empty workspaces)
#
# Usage:
#   ./scripts/setup-multilingual-fixtures.sh
#   ./scripts/setup-multilingual-fixtures.sh --transcripts-only
#   TEST_ROOT=/tmp/my-fixtures ./scripts/setup-multilingual-fixtures.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES="${AGENT_MINDMAP_FIXTURES_DIR:-$ROOT/test/fixtures/multilingual-jsonl/cursor-projects}"
TEST_ROOT="${AGENT_MINDMAP_TEST_PROJECTS_DIR:-/tmp/agent-mindmap-multilingual-test}"
STORE_DIR="${AGENT_MINDMAP_TEST_STORE_DIR:-/tmp/agent-mindmap-test-store}"

TRANSCRIPTS_ONLY=0

SLUGS=(
  zh-inventory-admin
  en-payments-api
  ja-docs-portal
  ko-observability-hub
)

# slug -> workspace path (must encode back to the same slug via workspaceToSlug)
WORKSPACE_PATHS=(
  /zh/inventory/admin
  /en/payments/api
  /ja/docs/portal
  /ko/observability/hub
)

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Prepare multilingual JSONL fixtures for Agent Mind Map manual testing.

Options:
  --transcripts-only   Only link fixtures under TEST_ROOT; skip workspace folders
  -h, --help           Show this help

Environment:
  AGENT_MINDMAP_FIXTURES_DIR       Source fixtures (default: test/fixtures/.../cursor-projects)
  AGENT_MINDMAP_TEST_PROJECTS_DIR  Cursor projects override root (default: $TEST_ROOT)
  AGENT_MINDMAP_TEST_STORE_DIR     Suggested library store dir (default: $STORE_DIR)

After running, set in Extension Development Host settings:
  "agentMindmap.projectsDir": "$TEST_ROOT"
  "agentMindmap.storeDir": "$STORE_DIR"
  "agentMindmap.llm.promptLanguage": "auto"
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --transcripts-only)
      TRANSCRIPTS_ONLY=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "$FIXTURES" ]]; then
  echo "error: fixtures directory not found: $FIXTURES" >&2
  exit 1
fi

ensure_dir() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    echo "  [ok] $dir"
    return 0
  fi
  if mkdir -p "$dir" 2>/dev/null; then
    echo "  [created] $dir"
    return 0
  fi
  echo "  [sudo] creating $dir ..."
  if ! sudo -n mkdir -p "$dir" 2>/dev/null && ! sudo mkdir -p "$dir"; then
    echo "error: could not create $dir." >&2
    echo "       Run manually: sudo mkdir -p $dir && sudo chown \"\$(id -un)\" $dir" >&2
    return 1
  fi
  sudo chown "$(id -u):$(id -g)" "$dir" 2>/dev/null || true
  echo "  [created] $dir"
}

link_transcripts_for_slug() {
  local slug="$1"
  local src="$FIXTURES/$slug"
  local dest_root="$TEST_ROOT/$slug/agent-transcripts"

  if [[ ! -d "$src" ]]; then
    echo "error: missing fixture project: $src" >&2
    exit 1
  fi

  mkdir -p "$dest_root"
  local count=0
  for session_dir in "$src"/*; do
    [[ -d "$session_dir" ]] || continue
    local session_id
    session_id="$(basename "$session_dir")"
    local jsonl="$session_dir/$session_id.jsonl"
    if [[ ! -f "$jsonl" ]]; then
      echo "warning: skipping $session_dir (missing $session_id.jsonl)" >&2
      continue
    fi
    ln -sfn "$session_dir" "$dest_root/$session_id"
    count=$((count + 1))
  done
  echo "  [$slug] linked $count session(s) -> $dest_root"
}

setup_transcripts() {
  echo "==> Linking fixtures"
  echo "    source:  $FIXTURES"
  echo "    projects: $TEST_ROOT"
  mkdir -p "$TEST_ROOT"
  for slug in "${SLUGS[@]}"; do
    link_transcripts_for_slug "$slug"
  done
}

setup_workspaces() {
  echo "==> Creating workspace folders (slug-compatible paths)"
  local failed=0
  local i
  for i in "${!WORKSPACE_PATHS[@]}"; do
    local ws="${WORKSPACE_PATHS[$i]}"
    local slug="${SLUGS[$i]}"
    if ensure_dir "$ws"; then
      echo "       $slug  <=>  $ws"
    else
      failed=1
    fi
  done
  if [[ "$failed" -ne 0 ]]; then
    echo "error: workspace folder setup incomplete (sudo may be required)." >&2
    exit 1
  fi
}

print_next_steps() {
  cat <<EOF

==> Done

1. Build the extension:
     npm run build

2. Press F5 to launch Extension Development Host, then set:
     "agentMindmap.host": "cursor"
     "agentMindmap.projectsDir": "$TEST_ROOT"
     "agentMindmap.storeDir": "$STORE_DIR"
     "agentMindmap.llm.promptLanguage": "auto"
     "agentMindmap.llm.dumpIo": true

3. Open ONE workspace folder at a time and run:
     Agent Mind Map: Analyze and Merge Current Project
     (choose "Force re-analyze all" on first run)

   Workspace folders:
     /zh/inventory/admin      (Chinese)
     /en/payments/api         (English)
     /ja/docs/portal          (Japanese)
     /ko/observability/hub    (Korean)

4. Log-pollution sessions to spot-check:
     *-002 in zh / ja / ko projects

5. Optional parser-only check (no LLM):
     npm run test:vitest -- test/promptLanguage.test.ts
EOF
}

setup_transcripts
if [[ "$TRANSCRIPTS_ONLY" -eq 0 ]]; then
  setup_workspaces
fi
print_next_steps
