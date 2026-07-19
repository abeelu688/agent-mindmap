import { execFile } from "child_process";
import * as path from "path";

/**
 * Normalize a git remote URI to a repo slug by stripping scheme, host:port, and
 * `user@` scp prefix; keep everything after the host including the trailing
 * `.git`. Same repo reachable via http / gogs@ / ssh collapses to one slug.
 *
 * Worked examples (TEAM_MODE.md §Q5 rule 2):
 *   http://192.168.1.70:2000/ailab/agent-mindmap.git -> ailab/agent-mindmap.git
 *   gogs@192.168.1.70:ailab/agent-mindmap.git       -> ailab/agent-mindmap.git
 *   ssh://git@github.com:22/org/repo.git             -> org/repo.git
 *   https://github.com/org/repo.git                  -> org/repo.git
 */
export function normalizeRepoUriToSlug(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed) {
    return "";
  }

  // ssh://git@github.com:22/org/repo.git  OR  https://host:port/path
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/]+)\/(.+)$/.exec(trimmed);
  if (schemeMatch) {
    return stripTrailingSlashes(schemeMatch[3]!);
  }

  // gogs@192.168.1.70:ailab/agent-mindmap.git  (scp-style: user@host:path)
  // The path begins at the first `:` after the host - but only when there's a
  // `user@` prefix, to avoid misreading a Windows drive path `C:/...`.
  const scpMatch = /^([^@\s]+@[^:\s]+):(.+)$/.exec(trimmed);
  if (scpMatch) {
    return stripTrailingSlashes(scpMatch[2]!);
  }

  // Already a bare path-like string (e.g. "ailab/agent-mindmap.git") - return as-is.
  return stripTrailingSlashes(trimmed);
}

/** Strip trailing slashes; the trailing `.git` is intentionally kept (it separates repo slugs from workspace slugs). */
function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, "");
}

type GitRunResult = { ok: true; stdout: string } | { ok: false; kind: "missing" | "failed" };

function runGit(folder: string, args: string[]): Promise<GitRunResult> {
  return new Promise((resolve) => {
    execFile("git", ["-C", folder, ...args], { timeout: 10000 }, (err, stdout) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        resolve({ ok: false, kind: "missing" });
        return;
      }
      if (err) {
        resolve({ ok: false, kind: "failed" });
        return;
      }
      resolve({ ok: true, stdout: stdout ?? "" });
    });
  });
}

export type RepoPrereqResult = { ok: true; uri: string } | { ok: false; reason: string };

/**
 * Check the two repo-mode prerequisites for a workspace folder (TEAM_MODE.md
 * §Q5 rule 1): (a) git repo with `origin` resolving, (b) folder IS the repo
 * root. Returns the origin URI on success, or a reason string on failure.
 */
export async function checkRepoPrerequisites(folder: string): Promise<RepoPrereqResult> {
  const [originRes, toplevelRes] = await Promise.all([
    runGit(folder, ["config", "--get", "remote.origin.url"]),
    runGit(folder, ["rev-parse", "--show-toplevel"]),
  ]);

  if (originRes.ok === false && originRes.kind === "missing") {
    return { ok: false, reason: "git 不可用" };
  }
  if (toplevelRes.ok === false && toplevelRes.kind === "missing") {
    return { ok: false, reason: "git 不可用" };
  }
  if (toplevelRes.ok === false) {
    return { ok: false, reason: "非 git 仓库" };
  }
  const originUri = originRes.ok ? originRes.stdout.trim() : "";
  if (!originUri) {
    return { ok: false, reason: "无 origin remote" };
  }
  const toplevel = toplevelRes.stdout.trim();
  if (path.resolve(toplevel) !== path.resolve(folder)) {
    return { ok: false, reason: "非 repo 根目录" };
  }
  return { ok: true, uri: originUri };
}

export const __testing = {
  normalizeRepoUriToSlug,
  runGit,
};
