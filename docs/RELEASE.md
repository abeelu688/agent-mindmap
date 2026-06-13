# Release Process

This document describes how maintainers cut a new release of Agent Mind Map.

## Version Numbering

Agent Mind Map follows [SemVer](https://semver.org/):

- **Major** (`x.0.0`) — breaking changes to settings, stored data shape, or public API
- **Minor** (`0.x.0`) — new features, non-breaking
- **Patch** (`0.0.x`) — bug fixes, doc changes, internal refactors

Until `1.0.0`, `0.x.0` may include breaking changes — call them out in `CHANGELOG.md`.

## Pre-release Checklist

Before bumping the version:

- [ ] All changes since the previous release are described in `CHANGELOG.md` under `## [Unreleased]`
- [ ] `npm run check` passes locally (typecheck + lint + format + concept-nodes + l10n)
- [ ] `npm run build` succeeds
- [ ] `npm run test:vitest` and `npm test` pass (modulo the 3 documented pre-existing failures)
- [ ] Manual smoke test:
  - Press F5 in VS Code, run **Open Latest Session** in a workspace with at least one Cursor or Claude Code transcript
  - Run **Analyze All Sessions (Current Project)** and confirm the concept mind map renders
  - Right-click empty canvas → **Download mind map & transcripts…** and verify the offline export works in a browser
- [ ] If `PIPELINE_VERSION` was bumped, confirm the cache invalidation works: an old `SessionRecord` file should be re-analyzed instead of reused

## Cutting the Release

1. **Bump the version in the root `package.json`** (the single source of truth):

   ```bash
   # Edit package.json → "version": "0.2.0"
   npm run version:sync   # writes the same value into extension/ and webview/
   ```

   `npm run build` and `npm run package:vsix` also auto-run `version:sync` first, so you don't strictly need to call it by hand — but it's idempotent and useful when reviewing the diff.

2. **Update `CHANGELOG.md`** — rename `## [Unreleased]` to `## [0.2.0] — YYYY-MM-DD`, then re-add an empty `## [Unreleased]` section above it. Update the link references at the bottom.

3. **Commit** the version bump on a release branch:

   ```bash
   git checkout -b release/v0.2.0
   git add package.json extension/package.json webview/package.json CHANGELOG.md
   git commit -m "chore(release): v0.2.0"
   ```

4. **Open a PR** from `release/v0.2.0` → `main`. Wait for CI green.

5. **Merge** the PR (squash merge is fine).

6. **Tag** the release on `main`:

   ```bash
   git checkout main
   git pull
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

7. **Build the VSIX**:

   ```bash
   npm run package:vsix
   # Output: agent-mindmap-0.2.0.vsix in repo root
   ```

8. **Create a GitHub Release** at https://github.com/your-org/agent-mindmap/releases/new
   - Tag: `v0.2.0`
   - Title: `v0.2.0`
   - Description: paste the relevant section of `CHANGELOG.md`
   - Attach the `.vsix` file as a release asset
   - Mark as the latest release

9. **(Optional) Publish to VS Code Marketplace**:

   ```bash
   npx vsce publish --packagePath agent-mindmap-0.2.0.vsix
   # Requires VSCE_PAT env var or `vsce login`
   ```

   See [VS Code Marketplace publishing docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for first-time setup.

10. **Announce** in repo Discussions / README pinned section if it's a notable release.

## Hotfix Releases

For urgent patches against the latest release:

```bash
git checkout v0.2.0
git checkout -b hotfix/v0.2.1
# fix bug, bump to 0.2.1, update CHANGELOG
git commit -am "fix(...): description"
git push -u origin hotfix/v0.2.1
# open PR, get review, merge, tag v0.2.1, repeat steps 6-10 above
```

## Yanking a Release

If a release goes out broken, **don't delete the tag** — instead:

1. Cut a new patch immediately (`v0.2.1`) that fixes the issue
2. On the broken GitHub Release page, edit the description with a `⚠️ DO NOT USE — see v0.2.1` banner at the top
3. If already published to the Marketplace, use [`vsce unpublish`](https://github.com/microsoft/vscode-vsce#unpublishing) only as a last resort — most users will already have the broken version cached

## Rolling Back stored data

The library at `~/.agent-mindmap/` carries a `schema.json` with `schemaVersion`. If you ever need to bump the schema in a way that's not backwards-compatible, write migration code in `extension/src/store/` rather than asking users to delete their library.
