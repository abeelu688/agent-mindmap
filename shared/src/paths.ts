import * as os from "os";
import * as path from "path";

/** Cursor project slug under `~/.cursor/projects/`. */
export function workspaceToSlug(fsPath: string): string {
  if (process.platform === "win32") {
    return fsPath
      .toLowerCase()
      .replace(/^([a-z]):\\/, "$1-")
      .replace(/\\/g, "-")
      .replace(/_/g, "-");
  }
  return fsPath.replace(/^\//, "").replace(/\//g, "-");
}

/** Best-effort inverse of {@link workspaceToSlug} (lossy). */
export function slugToWorkspacePath(slug: string): string {
  if (process.platform === "win32") {
    if (/^[a-z]-/.test(slug)) {
      const drive = slug[0].toUpperCase();
      const rest = slug.slice(2).replace(/-/g, "\\");
      return `${drive}:\\${rest}`;
    }
    return slug.replace(/-/g, "\\");
  }
  return "/" + slug.replace(/-/g, "/");
}

export function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** Resolve store directory from env or default `~/.agent-mindmap/`. */
export function resolveStoreDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AGENT_MINDMAP_STORE_DIR?.trim();
  if (override) {
    return expandHome(override);
  }
  return path.join(os.homedir(), ".agent-mindmap");
}
