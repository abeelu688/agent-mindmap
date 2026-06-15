<!-- Thanks for the contribution! Filling this out helps us review faster. -->

## Summary

<!-- One or two sentences: what does this PR do, and why? -->

## Linked issues

<!-- e.g. Closes #42, Refs #15 -->

## Type of change

<!-- Mark all that apply with [x] -->

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (anything that changes a public API, setting key, or stored data shape)
- [ ] Refactor (no functional change)
- [ ] Documentation
- [ ] i18n / translation
- [ ] CI / tooling

## How has this been tested?

<!-- Describe the tests you ran. -->

- [ ] `npm run build` passes
- [ ] `npm run test:vitest` passes
- [ ] `npm test` passes (extension node tests)
- [ ] Manually verified in Extension Development Host (F5)
- [ ] `npm run lint` clean (or only existing warnings)
- [ ] `npm run check:l10n` passes (if l10n bundles changed)
- [ ] If I polished translations, I updated `docs/multilingual-checklist/REVIEW-STATUS.md` for the locale

## Screenshots / mind-map snapshots

<!-- For UI changes only — drag images into this box. -->

## Checklist

- [ ] Branch follows naming convention (`feature/...`, `fix/...`, `i18n/...`)
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] If I changed a `prompt*.ts` JSON output schema, I bumped `PIPELINE_VERSION`
- [ ] If I added a user-visible string, I added the key to `bundle.l10n.json` and every shipped `bundle.l10n.*.json`
- [ ] I read [CONTRIBUTING.md](../CONTRIBUTING.md)

## Notes for reviewers

<!-- Anything reviewers should pay extra attention to? Edge cases, follow-up work, design tradeoffs? -->
