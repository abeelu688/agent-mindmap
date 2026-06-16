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

/** @deprecated Use {@link cursorMcpConfigPath}. */
export function projectMcpConfigPath(workspaceRoot: string): string {
  return cursorMcpConfigPath(workspaceRoot);
}

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

export async function refreshMcpIndexForWorkspace(): Promise<{ projectSlug: string; recordCount: number } | undefined> {
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
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function installMcpServerConfig(
  extensionPath: string,
  workspaceRoot: string,
  storeDir: string
): Promise<McpInstallResult> {
  const serverEntry = await resolveExistingMcpServerEntry(extensionPath);
  const cursorConfigPath = cursorMcpConfigPath(workspaceRoot);
  const claudeConfigPathResolved = claudeMcpConfigPath(workspaceRoot);
  const cursorExisting = await readJsonFile<McpServersConfig>(cursorConfigPath);
  const claudeExisting = await readJsonFile<McpServersConfig>(claudeConfigPathResolved);
  await writeJsonFile(
    cursorConfigPath,
    mergeAgentMindmapIntoConfig(cursorExisting, serverEntry, storeDir)
  );
  await writeJsonFile(
    claudeConfigPathResolved,
    mergeAgentMindmapIntoConfig(claudeExisting, serverEntry, storeDir)
  );
  return {
    cursorConfigPath,
    claudeConfigPath: claudeConfigPathResolved,
  };
}

export async function isMcpInstalled(workspaceRoot: string): Promise<boolean> {
  const cursor = await readJsonFile<McpServersConfig>(cursorMcpConfigPath(workspaceRoot));
  const claude = await readJsonFile<McpServersConfig>(claudeMcpConfigPath(workspaceRoot));
  return Boolean(
    cursor?.mcpServers?.["agent-mindmap"] || claude?.mcpServers?.["agent-mindmap"]
  );
}

export function showMcpInstallHint(result: McpInstallResult): void {
  void vscode.window
    .showInformationMessage(
      "Agent Mind Map: MCP server configured for Cursor (.cursor/mcp.json) and Claude Code (.mcp.json). Restart Cursor or reload MCP in Claude Code (/mcp).",
      "Open Cursor config",
      "Open Claude config"
    )
    .then((choice) => {
      if (choice === "Open Cursor config") {
        void vscode.commands.executeCommand("vscode.open", vscode.Uri.file(result.cursorConfigPath));
      } else if (choice === "Open Claude config") {
        void vscode.commands.executeCommand("vscode.open", vscode.Uri.file(result.claudeConfigPath));
      }
    });
}
