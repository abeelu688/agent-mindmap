import * as fs from "fs";
import * as path from "path";

/** How the headless CLI process is launched (Windows argv limits differ by mode). */
export type CliSpawnTarget = {
  command: string;
  args: string[];
  shell: boolean;
  mode: "node-direct" | "shell-shim";
};

const CURSOR_AGENT_BIN =
  /^(agent|cursor-agent)(\.exe|\.cmd)?$/i;

type NodeIndexPair = { nodePath: string; indexPath: string };

function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of arr) {
    if (a && !seen.has(a)) {
      seen.add(a);
      out.push(a);
    }
  }
  return out;
}

function pathExists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function parseVersionKey(name: string): number {
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})-/i.exec(name);
  if (!m) {
    return 0;
  }
  const y = m[1]!;
  const mo = m[2]!.padStart(2, "0");
  const d = m[3]!.padStart(2, "0");
  return Number(`${y}${mo}${d}`);
}

function findNodeIndexUnderRoot(root: string): NodeIndexPair | undefined {
  const versionsDir = path.join(root, "versions");
  let best: { key: number; dir: string } | undefined;
  try {
    for (const entry of fs.readdirSync(versionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const key = parseVersionKey(entry.name);
      if (!key) {
        continue;
      }
      if (!best || key > best.key) {
        best = { key, dir: entry.name };
      }
    }
  } catch {
    // no versions dir
  }
  if (best) {
    const nodePath = path.join(versionsDir, best.dir, "node.exe");
    const indexPath = path.join(versionsDir, best.dir, "index.js");
    if (pathExists(nodePath) && pathExists(indexPath)) {
      return { nodePath, indexPath };
    }
  }
  const nodePath = path.join(root, "node.exe");
  const indexPath = path.join(root, "index.js");
  if (pathExists(nodePath) && pathExists(indexPath)) {
    return { nodePath, indexPath };
  }
  return undefined;
}

function cursorAgentInstallRoots(bin: string): string[] {
  const roots: string[] = [];
  const base = path.basename(bin);
  if (!CURSOR_AGENT_BIN.test(base)) {
    return roots;
  }
  if (/[\\/]/.test(bin)) {
    const dir = path.dirname(bin);
    roots.push(dir);
    const parent = path.dirname(dir);
    if (path.basename(dir).toLowerCase() === "versions") {
      roots.push(parent);
    }
  }
  const local = process.env.LOCALAPPDATA;
  if (local) {
    roots.push(path.join(local, "cursor-agent"));
  }
  return uniq(roots);
}

function tryResolveCursorAgentNode(bin: string): NodeIndexPair | undefined {
  for (const root of cursorAgentInstallRoots(bin)) {
    const pair = findNodeIndexUnderRoot(root);
    if (pair) {
      return pair;
    }
  }
  return undefined;
}

/**
 * On Windows, `.cmd` shims run under cmd.exe (~8k argv limit) and often drop
 * multiline prompts. Prefer `node.exe index.js` when we can locate Cursor Agent.
 */
export function resolveCliSpawnTarget(
  bin: string,
  args: string[]
): CliSpawnTarget {
  if (process.platform === "win32") {
    const nodePlan = tryResolveCursorAgentNode(bin);
    if (nodePlan) {
      return {
        command: nodePlan.nodePath,
        args: [nodePlan.indexPath, ...args],
        shell: false,
        mode: "node-direct",
      };
    }
  }
  return {
    command: bin,
    args,
    shell: process.platform === "win32",
    mode: "shell-shim",
  };
}

export const __testing = {
  cursorAgentInstallRoots,
  findNodeIndexUnderRoot,
  tryResolveCursorAgentNode,
  parseVersionKey,
};
