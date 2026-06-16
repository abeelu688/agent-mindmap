import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import {
  bumpMcpProjectRevision,
  listRecordsForProject,
  workspaceToSlug,
} from "@agent-mindmap/shared";
import { getStoreDir, getWorkspacePath } from "../paths";
import {
  claudeMcpConfigPath,
  cursorMcpConfigPath,
  mergeAgentMindmapIntoConfig,
  type McpInstallResult,
  type McpServersConfig,
} from "./mcpConfigCore";

export {
  claudeMcpConfigPath,
  cursorMcpConfigPath,
  mergeAgentMindmapIntoConfig,
  type McpInstallResult,
  type McpServersConfig,
} from "./mcpConfigCore";

export async function resolveExistingMcpServerEntry(extensionPath: string): Promise<string> {
  const bundled = path.join(extensionPath, "mcp-server", "index.js");
  try {
    await fs.access(bundled);
    return bundled;
  } catch {
    const dev = path.join(extensionPath, "..", "mcp-server", "dist", "index.js");
    await fs.access(dev);
    return dev;
  }
}

export async function refreshMcpIndexForProject(projectSlug: string): Promise<void> {
  const storeDir = getStoreDir();
  const records = await listRecordsForProject(storeDir, projectSlug);
  await bumpMcpProjectRevision(storeDir, projectSlug, records.length);
}

export async function refreshMcpIndexForWorkspace(): Promise<
  { projectSlug: string; recordCount: number } | undefined
> {
  const projectPath = getWorkspacePath();
  if (!projectPath) {
    return undefined;
  }
  const projectSlug = workspaceToSlug(projectPath);
  const storeDir = getStoreDir();
  const records = await listRecordsForProject(storeDir, projectSlug);
  if (!records.length) {
    return undefined;
  }
  await bumpMcpProjectRevision(storeDir, projectSlug, records.length);
  return { projectSlug, recordCount: records.length };
}

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse JSON at ${filePath}: ${detail}`);
  }
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function installMcpServerConfig(
  extensionPath: string,
  workspaceRoot: string,
  storeDir: string,
  targets: { cursor: boolean; claude: boolean }
): Promise<McpInstallResult> {
  const serverEntry = await resolveExistingMcpServerEntry(extensionPath);
  const cursorConfigPath = cursorMcpConfigPath(workspaceRoot);
  const claudeConfigPathResolved = claudeMcpConfigPath(workspaceRoot);
  if (targets.cursor) {
    const cursorExisting = await readJsonFile<McpServersConfig>(cursorConfigPath);
    await writeJsonFile(
      cursorConfigPath,
      mergeAgentMindmapIntoConfig(cursorExisting, serverEntry, storeDir)
    );
  }
  if (targets.claude) {
    const claudeExisting = await readJsonFile<McpServersConfig>(claudeConfigPathResolved);
    await writeJsonFile(
      claudeConfigPathResolved,
      mergeAgentMindmapIntoConfig(claudeExisting, serverEntry, storeDir)
    );
  }
  return {
    cursorConfigPath: targets.cursor ? cursorConfigPath : undefined,
    claudeConfigPath: targets.claude ? claudeConfigPathResolved : undefined,
  };
}

export async function isMcpInstalled(workspaceRoot: string): Promise<boolean> {
  const cursor = await readJsonFile<McpServersConfig>(cursorMcpConfigPath(workspaceRoot)).catch(
    () => undefined
  );
  const claude = await readJsonFile<McpServersConfig>(claudeMcpConfigPath(workspaceRoot)).catch(
    () => undefined
  );
  return Boolean(cursor?.mcpServers?.["agent-mindmap"] || claude?.mcpServers?.["agent-mindmap"]);
}

export function showMcpInstallHint(result: McpInstallResult): void {
  const targets: string[] = [];
  if (result.cursorConfigPath) {
    targets.push("Cursor (.cursor/mcp.json)");
  }
  if (result.claudeConfigPath) {
    targets.push("Claude Code (.mcp.json)");
  }
  if (!targets.length) {
    return;
  }
  const message = `Agent Mind Map: MCP server configured for ${targets.join(" and ")}. Restart Cursor or reload MCP in Claude Code (/mcp).`;
  const actions: string[] = [];
  if (result.cursorConfigPath) actions.push("Open Cursor config");
  if (result.claudeConfigPath) actions.push("Open Claude config");
  void vscode.window.showInformationMessage(message, ...actions).then((choice) => {
    if (choice === "Open Cursor config" && result.cursorConfigPath) {
      void vscode.commands.executeCommand("vscode.open", vscode.Uri.file(result.cursorConfigPath));
    } else if (choice === "Open Claude config" && result.claudeConfigPath) {
      void vscode.commands.executeCommand("vscode.open", vscode.Uri.file(result.claudeConfigPath));
    }
  });
}

/**
 * Detect stale `agent-mindmap` entries in `.cursor/mcp.json` / `.mcp.json` whose
 * `args[0]` path no longer exists (typical after the extension is upgraded and
 * the previous version directory is deleted), and rewrite them in place to
 * point at the current bundled MCP server entry.
 *
 * Runs silently — it only logs to console; emits at most one info message
 * after a successful refresh.
 */
export async function refreshStaleMcpInstall(
  extensionPath: string,
  workspaceRoot: string
): Promise<void> {
  const cursorPath = cursorMcpConfigPath(workspaceRoot);
  const claudePath = claudeMcpConfigPath(workspaceRoot);
  let serverEntry: string | undefined;
  const refreshed: string[] = [];

  for (const [label, configPath] of [
    ["Cursor", cursorPath],
    ["Claude Code", claudePath],
  ] as const) {
    let existing: McpServersConfig | undefined;
    try {
      existing = await readJsonFile<McpServersConfig>(configPath);
    } catch (err) {
      console.warn(
        `[agent-mindmap] cannot parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    const entry = existing?.mcpServers?.["agent-mindmap"];
    if (!entry) {
      continue;
    }
    const referenced = entry.args?.[0];
    if (!referenced) {
      continue;
    }
    let stillValid = true;
    try {
      await fs.access(referenced);
    } catch {
      stillValid = false;
    }
    if (stillValid) {
      continue;
    }
    if (!serverEntry) {
      try {
        serverEntry = await resolveExistingMcpServerEntry(extensionPath);
      } catch {
        // Bundled server isn't available — bail; the user will need to rebuild.
        return;
      }
    }
    const storeDir = entry.env?.AGENT_MINDMAP_STORE_DIR;
    const merged = mergeAgentMindmapIntoConfig(existing, serverEntry, storeDir ?? "");
    try {
      await writeJsonFile(configPath, merged);
      refreshed.push(label);
    } catch (err) {
      console.warn(
        `[agent-mindmap] failed to refresh ${configPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (refreshed.length) {
    void vscode.window.showInformationMessage(
      `Agent Mind Map: Refreshed stale MCP server path in ${refreshed.join(" and ")} after extension upgrade.`
    );
  }
}
