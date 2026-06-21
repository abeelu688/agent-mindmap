import * as vscode from "vscode";
import {
  claudeMcpConfigPath,
  cursorMcpConfigPath,
  installMcpServerConfig,
  showMcpInstallHint,
} from "../mcp/mcpConfig";
import { t } from "../l10n/uiTranslate";
import { notifyError, notifyWarning } from "../notify";
import { getStoreDir, getWorkspacePath } from "../paths";

type Target = "cursor" | "claude";

type TargetPick = vscode.QuickPickItem & { target: Target; picked: boolean };

function defaultTargetsForHost(host: string | undefined): { cursor: boolean; claude: boolean } {
  if (host === "cursor") {
    return { cursor: true, claude: false };
  }
  if (host === "claude-code") {
    return { cursor: false, claude: true };
  }
  return { cursor: true, claude: true };
}

export async function commandInstallMcp(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = getWorkspacePath();
  if (!workspaceRoot) {
    notifyWarning(
      t(
        "ui.mcp.install.noWorkspace",
        "Agent Mind Map: Open a workspace folder before installing the MCP server."
      )
    );
    return;
  }
  const storeDir = getStoreDir();

  const host = vscode.workspace.getConfiguration("agentMindmap").get<string>("host", "auto");
  const defaults = defaultTargetsForHost(host);

  const items: TargetPick[] = [
    {
      label: "Cursor",
      description: cursorMcpConfigPath(workspaceRoot),
      target: "cursor",
      picked: defaults.cursor,
    },
    {
      label: "Claude Code",
      description: claudeMcpConfigPath(workspaceRoot),
      target: "claude",
      picked: defaults.claude,
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: t("ui.mcp.install.quickPickTitle", "Agent Mind Map: Install MCP Server"),
    placeHolder: t(
      "ui.mcp.install.quickPickPlaceholder",
      "Select which AI products to configure (writes to the workspace)."
    ),
  });
  if (!picked || picked.length === 0) {
    return;
  }
  const targets = {
    cursor: picked.some((p) => p.target === "cursor"),
    claude: picked.some((p) => p.target === "claude"),
  };

  try {
    const result = await installMcpServerConfig(
      context.extensionPath,
      workspaceRoot,
      storeDir,
      targets
    );
    showMcpInstallHint(result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    notifyError(
      t(
        "ui.mcp.install.failed",
        "Agent Mind Map: Failed to install MCP server. Build the extension first (npm run build). {0}",
        detail
      ),
      err
    );
  }
}
