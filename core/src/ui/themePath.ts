import * as os from "os";
import * as path from "path";

export function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export function resolveThemeFilePath(
  raw: string,
  workspaceRoot?: string
): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("~/") || trimmed === "~") {
    return expandHome(trimmed);
  }
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  if (workspaceRoot) {
    return path.join(workspaceRoot, trimmed);
  }
  return path.resolve(trimmed);
}
