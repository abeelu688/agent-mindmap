# Multilingual review checklists

Human review guides for Agent Mind Map's two locale systems:

| System              | What it controls                                    | Review artifacts                         |
| ------------------- | --------------------------------------------------- | ---------------------------------------- |
| **UI locale**       | Notifications, progress, menus, install guides      | Per-locale checklists in this folder     |
| **Mind map output** | Conversation language detection + structural labels | [mindmap-output.md](./mindmap-output.md) |

Shipped locales: `en`, `zh-cn`, `ja`, `ko`, `pt-br`, `es`, `de`, `fr`, `hi`, `id`.

## Quick start for reviewers

1. Pick a locale you are fluent in from [REVIEW-STATUS.md](./REVIEW-STATUS.md).
2. Open the matching checklist (e.g. [ja.md](./ja.md)).
3. Compare each **EN** / **target** pair. Tick the row when it passes the [review criteria](#review-criteria).
4. Fix strings in `extension/l10n/bundle.l10n.<locale>.json` when needed.
5. Run `npm run check:l10n` to confirm key parity with English.
6. Spot-check in the Extension Development Host:
   - Set `agentMindmap.ui.locale` to your locale (or `auto` with VS Code display language).
   - Trigger notifications: batch analyze, export, CLI-missing warning, webview context menu.
7. Open a PR with your fixes and update [REVIEW-STATUS.md](./REVIEW-STATUS.md) for your locale.

## Review criteria

- **Meaning** — Translation matches the English intent in UI context (not word-for-word if unnatural).
- **Placeholders** — `{0}`, `{1}`, … appear in the same order and count as English.
- **Product terms** — Keep consistent: `Agent Mind Map`, `LLM`, `CLI`, `VS Code`, `Concept Mind Map`.
- **Tone** — Short, actionable notification style; avoid overly formal or machine-translated phrasing.
- **Mixed strings** — Some AI-drafted entries may still contain English fragments; flag and fix them.

## Regenerating checklists

Checklists are generated from the live bundle JSON files. After English or locale bundles change, refresh:

```bash
npm run checklist:l10n
```

This updates `docs/multilingual-checklist/<locale>.md` EN/target pairs. **Do not** hand-edit generated key tables unless you plan to re-run the generator afterward (manual ticks in PR review are fine; committed checklist files are refreshed on the next generation).

## Suggested PR workflow (GitHub)

```text
i18n(ja): polish UI notifications and mark review complete

- Fix 12 strings in bundle.l10n.ja.json (ui.batch, ui.cliInstall)
- npm run check:l10n
- Update docs/multilingual-checklist/REVIEW-STATUS.md → ja UI review ✅
```

Partial reviews are welcome — fix one section (e.g. `ui.cliInstall`) and note progress in the PR.

## File index

| File                                     | Purpose                                  |
| ---------------------------------------- | ---------------------------------------- |
| [REVIEW-STATUS.md](./REVIEW-STATUS.md)   | Overall sign-off table                   |
| [zh-cn.md](./zh-cn.md)                   | Simplified Chinese (maintainer baseline) |
| [ja.md](./ja.md)                         | Japanese                                 |
| [ko.md](./ko.md)                         | Korean                                   |
| [pt-br.md](./pt-br.md)                   | Brazilian Portuguese                     |
| [es.md](./es.md)                         | Spanish                                  |
| [de.md](./de.md)                         | German                                   |
| [fr.md](./fr.md)                         | French                                   |
| [hi.md](./hi.md)                         | Hindi                                    |
| [id.md](./id.md)                         | Indonesian                               |
| [mindmap-output.md](./mindmap-output.md) | Conversation-language labels & detection |

## Related docs

- [CONTRIBUTING.md](../../CONTRIBUTING.md) — adding a new UI language
- [ARCHITECTURE.md](../ARCHITECTURE.md) — i18n layers
- `npm run check:l10n` — automated key consistency (not translation quality)
