# Fixture workspace sources

Single shared tree used by **all** language projects (`demo-app`).

- JSONL `tool_use` paths (`src/...`) are identical across zh / en / ja / ko
- Only `user_query` text differs by language
- Session `*-003` is the code-heavy scenario (Read / StrReplace / Write on import files)

Regenerate JSONL from templates:

```bash
npm run fixtures:generate
```
