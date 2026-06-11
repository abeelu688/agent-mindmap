import * as fs from "fs";
import * as path from "path";
import type { CodeReference } from "./types";

/**
 * Filter code references to only include files within the project.
 *
 * - Absolute paths: kept only if they start with `projectPath` (cross-platform).
 * - Relative paths: kept only if the file exists under `projectPath`.
 * - If `projectPath` is absent, all paths are kept (best-effort).
 */
export function filterProjectCodeReferences(
  refs: CodeReference[],
  projectPath?: string
): CodeReference[] {
  if (!projectPath || !refs.length) {
    return refs;
  }
  const normalizedRoot = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return refs.filter((ref) => {
    const p = ref.path.replace(/\\/g, "/");
    // Absolute path (POSIX /x/y or Windows C:/x/y)
    if (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) {
      const normalizedP = p.replace(/\\/g, "/");
      return normalizedP.startsWith(normalizedRoot + "/") || normalizedP === normalizedRoot;
    }
    // Relative path — check file existence
    try {
      const full = path.resolve(projectPath, p);
      fs.accessSync(full);
      return true;
    } catch {
      return false;
    }
  });
}
