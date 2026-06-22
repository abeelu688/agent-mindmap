/**
 * `installMcp` use case — install MCP server configuration for Cursor / Claude Code.
 *
 * The actual file-writing logic lives in core's `mcpConfigCore.ts`.
 * The use case handles target selection via Prompter and delegates config
 * writing through the McpInstaller port.
 */
import type { Prompter, QuickPickItem } from "../ports/Prompter";
import type { ConfigStore } from "../ports/ConfigStore";
import type { Logger } from "../ports/Logger";

export type McpInstaller = {
  /** Install MCP server config for the given targets. */
  installMcpServerConfig(opts: {
    extensionPath: string;
    workspaceRoot: string;
    storeDir: string;
    targets: { cursor: boolean; claude: boolean };
  }): Promise<UseCaseMcpInstallResult>;
  /** Show install hint after successful install. */
  showInstallHint(result: UseCaseMcpInstallResult): void;
  /** Get the Cursor MCP config path for display. */
  cursorMcpConfigPath(workspaceRoot: string): string;
  /** Get the Claude Code MCP config path for display. */
  claudeMcpConfigPath(workspaceRoot: string): string;
};

export type UseCaseMcpInstallResult = {
  cursorInstalled: boolean;
  claudeInstalled: boolean;
};

export type InstallMcpDeps = {
  prompter: Prompter;
  configStore: ConfigStore;
  logger: Logger;
  mcpInstaller: McpInstaller;
  /** The workspace root path. */
  workspacePath: string | undefined;
  /** The extension install path. */
  extensionPath: string;
  /** The store directory. */
  storeDir: string;
};

type TargetPick = QuickPickItem & { target: "cursor" | "claude" };

function defaultTargetsForHost(host: string | undefined): { cursor: boolean; claude: boolean } {
  if (host === "cursor") {
    return { cursor: true, claude: false };
  }
  if (host === "claude-code") {
    return { cursor: false, claude: true };
  }
  return { cursor: true, claude: true };
}

/**
 * Install the MCP server for selected targets.
 *
 * Returns `undefined` when cancelled or no workspace.
 */
export async function installMcp(
  deps: InstallMcpDeps
): Promise<UseCaseMcpInstallResult | undefined> {
  if (!deps.workspacePath) {
    deps.logger.warn("No workspace folder open");
    return undefined;
  }

  const host = deps.configStore.get<string>("host");
  const defaults = defaultTargetsForHost(host);

  const items: TargetPick[] = [
    {
      label: "Cursor",
      description: deps.mcpInstaller.cursorMcpConfigPath(deps.workspacePath),
      target: "cursor",
      picked: defaults.cursor,
    },
    {
      label: "Claude Code",
      description: deps.mcpInstaller.claudeMcpConfigPath(deps.workspacePath),
      target: "claude",
      picked: defaults.claude,
    },
  ];

  const picked = await deps.prompter.showQuickPick(items, {
    canPickMany: true,
    title: "Agent Mind Map: Install MCP Server",
    placeHolder: "Select which AI products to configure",
  });

  if (!picked || !Array.isArray(picked) || picked.length === 0) {
    return undefined;
  }

  const targets = {
    cursor: picked.some((p) => (p as TargetPick).target === "cursor"),
    claude: picked.some((p) => (p as TargetPick).target === "claude"),
  };

  try {
    const result = await deps.mcpInstaller.installMcpServerConfig({
      extensionPath: deps.extensionPath,
      workspaceRoot: deps.workspacePath,
      storeDir: deps.storeDir,
      targets,
    });
    deps.mcpInstaller.showInstallHint(result);
    return result;
  } catch (err) {
    deps.logger.error("Failed to install MCP server", err);
    return undefined;
  }
}
