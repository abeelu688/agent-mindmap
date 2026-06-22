import * as vscode from "vscode";
import { installMcp, type UseCaseMcpInstallResult } from "@agent-mindmap/core";
import {
  claudeMcpConfigPath,
  cursorMcpConfigPath,
  installMcpServerConfig,
  showMcpInstallHint,
} from "../mcp/mcpConfig";
import { t } from "../l10n/uiTranslate";
import { notifyWarning } from "../notify";
import { getStoreDir, getWorkspacePath } from "../paths";
import { buildPrompter, buildLogger } from "../adapters/coreUseCaseDeps";

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
  await installMcp({
    prompter: buildPrompter(),
    configStore: {
      get: (key) => vscode.workspace.getConfiguration("agentMindmap").get(key),
      set: (key, val) =>
        vscode.workspace
          .getConfiguration("agentMindmap")
          .update(key, val, vscode.ConfigurationTarget.Global),
    },
    logger: buildLogger(),
    mcpInstaller: {
      installMcpServerConfig: async (opts): Promise<UseCaseMcpInstallResult> => {
        const result = await installMcpServerConfig(
          context.extensionPath,
          opts.workspaceRoot,
          opts.storeDir,
          opts.targets
        );
        return {
          cursorInstalled: !!result.cursorConfigPath,
          claudeInstalled: !!result.claudeConfigPath,
        };
      },
      showInstallHint: (result: UseCaseMcpInstallResult) => {
        showMcpInstallHint({
          cursorConfigPath: result.cursorInstalled ? "installed" : undefined,
          claudeConfigPath: result.claudeInstalled ? "installed" : undefined,
        });
      },
      cursorMcpConfigPath,
      claudeMcpConfigPath,
    },
    workspacePath: workspaceRoot,
    extensionPath: context.extensionPath,
    storeDir: getStoreDir(),
  });
}
