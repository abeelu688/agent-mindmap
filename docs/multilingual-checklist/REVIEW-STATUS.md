# Multilingual review status

> Track human sign-off per locale. Update this file when a locale checklist is fully reviewed.

| Locale  | Language             | UI bundle              | UI review       | Mind map labels | Detection tests | Notes                                |
| ------- | -------------------- | ---------------------- | --------------- | --------------- | --------------- | ------------------------------------ |
| `en`    | English              | baseline               | n/a             | n/a             | n/a             | Source strings in `bundle.l10n.json` |
| `zh-cn` | Simplified Chinese   | [zh-cn.md](./zh-cn.md) | ✅ Maintainer   | ✅ Shipped      | ✅ Covered      | 简体中文                             |
| `ja`    | Japanese             | [ja.md](./ja.md)       | ⏳ Needs review | ✅ Shipped      | ⏳ Needs review | 日本語                               |
| `ko`    | Korean               | [ko.md](./ko.md)       | ⏳ Needs review | ✅ Shipped      | ⏳ Needs review | 한국어                               |
| `pt-br` | Brazilian Portuguese | [pt-br.md](./pt-br.md) | ⏳ Needs review | ⏳ Needs review | ⏳ Needs review | Português (Brasil)                   |
| `es`    | Spanish              | [es.md](./es.md)       | ⏳ Needs review | ⏳ Needs review | ⏳ Needs review | Español                              |
| `de`    | German               | [de.md](./de.md)       | ⏳ Needs review | ⏳ Needs review | ⏳ Needs review | Deutsch                              |
| `fr`    | French               | [fr.md](./fr.md)       | ⏳ Needs review | ⏳ Needs review | ⏳ Needs review | Français                             |
| `hi`    | Hindi                | [hi.md](./hi.md)       | ⏳ Needs review | ⏳ Needs review | ⏳ Needs review | हिन्दी                               |
| `id`    | Indonesian           | [id.md](./id.md)       | ⏳ Needs review | ⏳ Needs review | ⏳ Needs review | Bahasa Indonesia                     |

## Mind map output (conversation language)

Separate from UI bundles. Review:

- Structural labels: [`extension/src/mindmap/outputLanguageLabels.ts`](../../extension/src/mindmap/outputLanguageLabels.ts)
- Detection heuristics: [`extension/src/llm/promptLanguage.ts`](../../extension/src/llm/promptLanguage.ts)
- Tests: [`test/promptLanguage.test.ts`](../../test/promptLanguage.test.ts), [`test/outputLanguageLabels.test.ts`](../../test/outputLanguageLabels.test.ts)
- Fixture transcripts: [`test/fixtures/multilingual-jsonl/`](../../test/fixtures/multilingual-jsonl/)

See [mindmap-output.md](./mindmap-output.md) for the output-language checklist.
