# Multilingual JSONL fixtures

Cursor-style transcript fixtures for manual Agent Mind Map language testing.

Layout:

```text
test/fixtures/multilingual-jsonl/cursor-projects/<project-slug>/<session-id>/<session-id>.jsonl
test/fixtures/multilingual-jsonl/workspaces/demo-app/src/...   # shared code tree
```

Projects (user_query language only):

- `zh-inventory-admin` - Chinese, 5 sessions
- `en-payments-api` - English, 5 sessions
- `ja-docs-portal` - Japanese, 5 sessions
- `ko-observability-hub` - Korean, 5 sessions

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

The former `npm run fixtures:html` harness was removed because it depended on the deleted
`extension/src/sessionLoader.ts` orchestration (now living in `@agent-mindmap/core`
use cases). To exercise these fixtures today:

1. Symlink them into your Cursor project layout:

   ```bash
   chmod +x scripts/setup-multilingual-fixtures.sh
   ./scripts/setup-multilingual-fixtures.sh
   ```

2. Open the target project in Cursor, run an analysis via the extension, and inspect the
   rendered mind map / exported HTML package.

The JSONL fixtures themselves are still valid and cover the same scenarios (code-heavy
`*-003`, mixed-language voting, etc.).
