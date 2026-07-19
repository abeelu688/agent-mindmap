/**
 * CLI slug resolver - resolves the workspace slug for a given cwd, honoring
 * the `project.mode` config (workspace vs repo). In repo mode, the slug is
 * derived from `git config --get remote.origin.url` (via `normalizeRepoUriToSlug`);
 * in workspace mode, it falls back to the host's `encodeWorkspacePath`.
 */
import { checkRepoPrerequisites, normalizeRepoUriToSlug } from "@agent-mindmap/core";
import type { AgentHost } from "@agent-mindmap/core";
import type { CliConfigStore } from "../config/configStore";

export type ProjectMode = "workspace" | "repo";

function readProjectMode(config: CliConfigStore): ProjectMode {
  const raw = config.get<string>("project.mode") ?? "workspace";
  return raw === "repo" ? "repo" : "workspace";
}

/** folder fsPath -> resolved slug (per mode). Cleared when mode may change. */
const slugCache = new Map<string, string>();

/**
 * Resolve the workspace slug for `cwd` using the configured project mode.
 *
 * - **repo mode**: requires git repo with origin and cwd == repo root; slug
 *   from `normalizeRepoUriToSlug(originUrl)`. Falls back to workspace slug if
 *   git/origin/root check fails.
 * - **workspace mode**: host.encodeWorkspacePath(cwd).
 *
 * Result is cached per folder for the process lifetime.
 */
export async function resolveWorkspaceSlug(
  cwd: string,
  config: CliConfigStore,
  host: AgentHost
): Promise<string> {
  const cacheKey = `${readProjectMode(config)}\0${cwd}`;
  const cached = slugCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let slug = host.encodeWorkspacePath(cwd);
  if (readProjectMode(config) === "repo") {
    const res = await checkRepoPrerequisites(cwd);
    if (res.ok) {
      slug = normalizeRepoUriToSlug(res.uri);
    }
    // On failure: keep workspace slug fallback. The doctor command surfaces
    // the issue via a separate repo-mode diagnostic.
  }
  slugCache.set(cacheKey, slug);
  return slug;
}

/** Sync lookup of a folder's cached slug. `undefined` if not yet resolved. */
export function getCachedSlug(cwd: string, config: CliConfigStore): string | undefined {
  return slugCache.get(`${readProjectMode(config)}\0${cwd}`);
}

/** Clear the slug cache (used by tests). */
export function clearSlugCache(): void {
  slugCache.clear();
}

export const __testing = {
  slugCache,
  readProjectMode,
};
