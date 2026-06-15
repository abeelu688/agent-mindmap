# Mind map output language — review checklist

UI bundles ([locale checklists](./README.md)) are separate from **conversation language**: what the LLM writes for titles/summaries and the structural chrome (`Research`, `Related code`, concept map titles).

## Supported output languages

| Language   | Detection | Structural labels | Manual override                      |
| ---------- | --------- | ----------------- | ------------------------------------ |
| English    | ✅        | ✅                | `agentMindmap.llm.promptLanguage=en` |
| Chinese    | ✅        | ✅                | `agentMindmap.llm.promptLanguage=zh` |
| Japanese   | ✅        | ✅                | auto only                            |
| Korean     | ✅        | ✅                | auto only                            |
| Portuguese | ✅        | ✅                | auto only                            |
| Spanish    | ✅        | ✅                | auto only                            |
| German     | ✅        | ✅                | auto only                            |
| French     | ✅        | ✅                | auto only                            |
| Hindi      | ✅        | ✅                | auto only                            |
| Indonesian | ✅        | ✅                | auto only                            |

## Code to review

- [ ] [`extension/src/mindmap/outputLanguageLabels.ts`](../../extension/src/mindmap/outputLanguageLabels.ts) — `summaryPrefix`, `relatedCode`, `research`, `conclusion`, `conceptTitleAll`, `uncategorized`, etc.
- [ ] [`extension/src/llm/promptLanguage.ts`](../../extension/src/llm/promptLanguage.ts) — `user_query` language scoring (script + Latin stopwords).
- [ ] [`test/promptLanguage.test.ts`](../../test/promptLanguage.test.ts) — add real-world query samples if detection fails for your language.
- [ ] [`test/outputLanguageLabels.test.ts`](../../test/outputLanguageLabels.test.ts) — label mapping smoke tests.

## Manual smoke test

1. Use or add a fixture under [`test/fixtures/multilingual-jsonl/`](../../test/fixtures/multilingual-jsonl/) with `user_query` text in your language.
2. Analyze the session (F5 Extension Development Host).
3. Confirm:
   - [ ] Outline node titles/summaries are in the expected language.
   - [ ] Structural labels (`Research`, `Conclusion`, `Related code`, concept map title) match [`outputLanguageLabels.ts`](../../extension/src/mindmap/outputLanguageLabels.ts).
4. For Latin languages: include a query mixed with English identifiers (`getUserById`, stack traces) and verify detection still picks your language.

## Sign-off

| Language   | Labels reviewed | Detection reviewed | Fixture added | Reviewer | PR  |
| ---------- | --------------- | ------------------ | ------------- | -------- | --- |
| Portuguese | ☐               | ☐                  | ☐             |          |     |
| Spanish    | ☐               | ☐                  | ☐             |          |     |
| German     | ☐               | ☐                  | ☐             |          |     |
| French     | ☐               | ☐                  | ☐             |          |     |
| Hindi      | ☐               | ☐                  | ☐             |          |     |
| Indonesian | ☐               | ☐                  | ☐             |          |     |
| Japanese   | ☐               | ☐                  | ☐             |          |     |
| Korean     | ☐               | ☐                  | ☐             |          |     |

Update [REVIEW-STATUS.md](./REVIEW-STATUS.md) when a row is fully checked.
