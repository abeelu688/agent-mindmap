# Maintenance Guide

This document is for project maintainers. Contributors should read [CONTRIBUTING.md](../CONTRIBUTING.md) instead.

## GitHub Labels

When the repo is first published, create the following labels (Settings → Labels). Existing default labels (`bug`, `enhancement`, `question`, `documentation`, `good first issue`, `help wanted`) are kept; the rest are project-specific.

| Label              | Color     | Description                                             |
| ------------------ | --------- | ------------------------------------------------------- |
| `bug`              | `#d73a4a` | Something isn't working                                 |
| `enhancement`      | `#a2eeef` | New feature or request                                  |
| `question`         | `#d876e3` | User has a usage question                               |
| `documentation`    | `#0075ca` | Improvements or additions to docs                       |
| `good first issue` | `#7057ff` | Approachable for new contributors                       |
| `help wanted`      | `#008672` | Maintainer is looking for community help                |
| `i18n`             | `#fbca04` | Translation / localization work                         |
| `area:llm`         | `#5319e7` | Touches LLM prompts, providers, or pipeline stages      |
| `area:ui`          | `#5319e7` | Mind map rendering, themes, webview                     |
| `area:store`       | `#5319e7` | Library persistence, atomic writes, freshness checks    |
| `area:merge`       | `#5319e7` | Concept trie / batch snapshot / ontology                |
| `area:host`        | `#5319e7` | Cursor / Claude Code / new host adapters                |
| `area:ci`          | `#5319e7` | GitHub Actions, ESLint, Prettier, husky                 |
| `breaking-change`  | `#b60205` | Changes a public API, setting key, or stored data shape |
| `wontfix`          | `#ffffff` | Maintainer has decided not to address this              |
| `duplicate`        | `#cfd3d7` | Already filed elsewhere                                 |
| `needs-repro`      | `#fef2c0` | Awaiting reproducible test case from reporter           |

### Bulk creation

Run this `gh` script after creating the repo:

```bash
gh label create i18n --color fbca04 --description "Translation / localization work"
gh label create area:llm --color 5319e7 --description "Touches LLM prompts, providers, or pipeline stages"
gh label create area:ui --color 5319e7 --description "Mind map rendering, themes, webview"
gh label create area:store --color 5319e7 --description "Library persistence, atomic writes, freshness checks"
gh label create area:merge --color 5319e7 --description "Concept trie / batch snapshot / ontology"
gh label create area:host --color 5319e7 --description "Cursor / Claude Code / new host adapters"
gh label create area:ci --color 5319e7 --description "GitHub Actions, ESLint, Prettier, husky"
gh label create breaking-change --color b60205 --description "Changes a public API, setting key, or stored data shape"
gh label create needs-repro --color fef2c0 --description "Awaiting reproducible test case from reporter"
```

## Release Process

See [docs/RELEASE.md](RELEASE.md) for the full step-by-step.
