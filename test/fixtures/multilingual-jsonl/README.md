# Multilingual JSONL fixtures

Cursor-style transcript fixtures for manual Agent Mind Map language testing.

Layout:

```text
test/fixtures/multilingual-jsonl/cursor-projects/<project-slug>/<session-id>/<session-id>.jsonl
test/fixtures/multilingual-jsonl/workspaces/demo-app/src/...   # shared code tree
```

Projects (user_query language only):

- `zh-inventory-admin` — Chinese, 5 sessions
- `en-payments-api` — English, 5 sessions
- `ja-docs-portal` — Japanese, 5 sessions
- `ko-observability-hub` — Korean, 5 sessions

**Testing uniformity:** for each session number (001–005), all four projects share the same
`tool_use` paths, StrReplace/Write payloads, and assistant summary text. Only `user_query`
lines differ by language.

Regenerate fixtures after editing templates:

```bash
npm run fixtures:generate
```

Each session includes:

- user_query text in the project language
- identical tool_use + code edits on `workspaces/demo-app/`
- one assistant summary (English, shared)
- a follow-up user_query to exercise session-level language voting
- session 002: shared English log block + translated question (payload down-weighting)

## Manual extension testing

**Requires a headless LLM CLI** (`agent` / `cursor-agent`, or `claude`). Without it, analysis fails and **no HTML is written**.

If only `claude` is installed (common on Homebrew Mac), the script auto-selects `claude-cli`:

```bash
npm run build
npm run fixtures:html -- \
  --project zh-inventory-admin \
  --session zh-inventory-admin-003 \
  --model sonnet \
  --force-refresh
```

Explicit CLI + model:

```bash
npm run fixtures:html -- \
  --provider claude-cli \
  --cli-path /opt/homebrew/bin/claude \
  --model sonnet \
  --project zh-inventory-admin \
  --session zh-inventory-admin-003 \
  --force-refresh

open test/fixtures/multilingual-jsonl/html-out/zh-inventory-admin/sessions/zh-inventory-admin-003/index.html
```

Environment alternatives: `AGENT_MINDMAP_LLM_PROVIDER`, `AGENT_MINDMAP_LLM_CLI_PATH`, `AGENT_MINDMAP_LLM_MODEL`.

Output directory (gitignored): `test/fixtures/multilingual-jsonl/html-out/`

### Single session (session-analysis + code-ref LLM)

Code-heavy scenario: `*-003` in any project (same code paths in all languages).

```bash
npm run fixtures:html -- \
  --project zh-inventory-admin \
  --session zh-inventory-admin-003 \
  --force-refresh

open test/fixtures/multilingual-jsonl/html-out/zh-inventory-admin/sessions/zh-inventory-admin-003/index.html
```

Same code, different language:

```bash
npm run fixtures:html -- --project en-payments-api --session en-payments-api-003 --force-refresh
```

### Full project (all sessions + merge)

```bash
npm run fixtures:html -- --project zh-inventory-admin --force-refresh
open test/fixtures/multilingual-jsonl/html-out/zh-inventory-admin/merged/index.html
```

### Legacy: symlink fixtures into Cursor project layout

```bash
chmod +x scripts/setup-multilingual-fixtures.sh
./scripts/setup-multilingual-fixtures.sh
```
