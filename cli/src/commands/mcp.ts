/**
 * `agent-mindmap mcp` — MCP server install/uninstall/status commands.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { Command } from "commander";
import {
  cursorMcpConfigPath,
  claudeMcpConfigPath,
  mergeAgentMindmapIntoConfig,
  type McpServersConfig,
} from "@agent-mindmap/core";
import { CliConfigStore } from "../config/configStore";
import { log, logSuccess, logWarn, isJsonMode, printJson } from "../ui/logger";
import { buildCliPrompter } from "../ui/prompter";
import { syncMcpConfigFiles } from "../adapters/mcpConfigSync";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function resolveMcpServerEntry(): string {
  // The MCP server binary — resolve relative to the CLI package
  const cliDir = path.resolve(__dirname, "..");
  const mcpServerPath = path.resolve(cliDir, "..", "mcp-server", "dist", "index.js");
  return mcpServerPath;
}

async function readJsonFile(filePath: string): Promise<McpServersConfig | undefined> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as McpServersConfig;
  } catch {
    return undefined;
  }
}

async function writeJsonFile(filePath: string, data: McpServersConfig): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
}

// ────────────────────────────────────────────────────────────────────────────
// mcp install
// ────────────────────────────────────────────────────────────────────────────

export async function runMcpInstall(
  cwd: string,
  storeDir: string | undefined,
  options: { targets?: string }
) {
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();

  const storeDirPath = config.storeDir;
  const serverEntry = resolveMcpServerEntry();
  const workspaceRoot = cwd;

  // Determine targets
  let installCursor = false;
  let installClaude = false;

  if (options.targets) {
    const parts = options.targets.split(",").map((t) => t.trim().toLowerCase());
    installCursor = parts.includes("cursor");
    installClaude = parts.includes("claude") || parts.includes("claude-code");
  } else {
    // Interactive selection
    const prompter = buildCliPrompter();
    const items = [
      {
        label: "Cursor",
        description: cursorMcpConfigPath(workspaceRoot),
        target: "cursor",
        picked: true,
      },
      {
        label: "Claude Code",
        description: claudeMcpConfigPath(workspaceRoot),
        target: "claude",
        picked: false,
      },
    ];

    const picked = await prompter.showQuickPick(
      items as import("@agent-mindmap/core").QuickPickItem[],
      {
        canPickMany: true,
        title: "Select which AI products to configure",
      }
    );

    if (!picked || !Array.isArray(picked) || picked.length === 0) {
      logWarn("No targets selected.");
      return;
    }

    installCursor = (picked as { target: string }[]).some((p) => p.target === "cursor");
    installClaude = (picked as { target: string }[]).some((p) => p.target === "claude");
  }

  if (!installCursor && !installClaude) {
    logWarn("No targets selected.");
    return;
  }

  const result: { cursor?: string; claude?: string } = {};

  if (installCursor) {
    const configPath = cursorMcpConfigPath(workspaceRoot);
    const existing = await readJsonFile(configPath);
    const updated = mergeAgentMindmapIntoConfig(existing, serverEntry, storeDirPath);
    await writeJsonFile(configPath, updated);
    result.cursor = configPath;
    logSuccess(`Cursor MCP config updated: ${configPath}`);
  }

  if (installClaude) {
    const configPath = claudeMcpConfigPath(workspaceRoot);
    const existing = await readJsonFile(configPath);
    const updated = mergeAgentMindmapIntoConfig(existing, serverEntry, storeDirPath);
    await writeJsonFile(configPath, updated);
    result.claude = configPath;
    logSuccess(`Claude Code MCP config updated: ${configPath}`);
  }

  if (isJsonMode()) {
    printJson(result);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// mcp uninstall
// ────────────────────────────────────────────────────────────────────────────

export async function runMcpUninstall(
  cwd: string,
  _storeDir: string | undefined,
  options: { targets?: string }
) {
  const workspaceRoot = cwd;

  let uninstallCursor = false;
  let uninstallClaude = false;

  if (options.targets) {
    const parts = options.targets.split(",").map((t) => t.trim().toLowerCase());
    uninstallCursor = parts.includes("cursor");
    uninstallClaude = parts.includes("claude") || parts.includes("claude-code");
  } else {
    uninstallCursor = true;
    uninstallClaude = true;
  }

  const result: { cursor?: string; claude?: string } = {};

  if (uninstallCursor) {
    const configPath = cursorMcpConfigPath(workspaceRoot);
    const existing = await readJsonFile(configPath);
    if (existing?.mcpServers?.["agent-mindmap"]) {
      delete existing.mcpServers["agent-mindmap"];
      if (Object.keys(existing.mcpServers).length === 0) {
        delete existing.mcpServers;
      }
      await writeJsonFile(configPath, existing);
      result.cursor = configPath;
      logSuccess(`Removed agent-mindmap from Cursor MCP config: ${configPath}`);
    } else {
      logWarn(`No agent-mindmap entry in Cursor MCP config: ${configPath}`);
    }
  }

  if (uninstallClaude) {
    const configPath = claudeMcpConfigPath(workspaceRoot);
    const existing = await readJsonFile(configPath);
    if (existing?.mcpServers?.["agent-mindmap"]) {
      delete existing.mcpServers["agent-mindmap"];
      if (Object.keys(existing.mcpServers).length === 0) {
        delete existing.mcpServers;
      }
      await writeJsonFile(configPath, existing);
      result.claude = configPath;
      logSuccess(`Removed agent-mindmap from Claude Code MCP config: ${configPath}`);
    } else {
      logWarn(`No agent-mindmap entry in Claude Code MCP config: ${configPath}`);
    }
  }

  if (isJsonMode()) {
    printJson(result);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// mcp status
// ────────────────────────────────────────────────────────────────────────────

export async function runMcpStatus(cwd: string, storeDir: string | undefined) {
  void storeDir;
  const workspaceRoot = cwd;

  const cursorConfigPath = cursorMcpConfigPath(workspaceRoot);
  const claudeConfigPath = claudeMcpConfigPath(workspaceRoot);

  const cursorExisting = await readJsonFile(cursorConfigPath);
  const claudeExisting = await readJsonFile(claudeConfigPath);

  const cursorInstalled = !!cursorExisting?.mcpServers?.["agent-mindmap"];
  const claudeInstalled = !!claudeExisting?.mcpServers?.["agent-mindmap"];

  const status = {
    cursor: {
      installed: cursorInstalled,
      configPath: cursorConfigPath,
    },
    claude: {
      installed: claudeInstalled,
      configPath: claudeConfigPath,
    },
  };

  if (isJsonMode()) {
    printJson(status);
    return;
  }

  log("MCP server status:");
  log(
    `  Cursor:      ${cursorInstalled ? "✓ installed" : "✗ not installed"} (${cursorConfigPath})`
  );
  log(
    `  Claude Code: ${claudeInstalled ? "✓ installed" : "✗ not installed"} (${claudeConfigPath})`
  );

  if (!cursorInstalled && !claudeInstalled) {
    logWarn("  Run `agent-mindmap mcp install` to install.");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// mcp refresh-paths
// ────────────────────────────────────────────────────────────────────────────

/**
 * Rewrite `mcp-mode.json`, `workspace-paths.json`, `repo-paths.json`, and
 * `mcp-locale.json` under the store dir so the stdio MCP server can resolve
 * this workspace's slug and localize tool examples. Mirrors the extension's
 * `writePathsMaps()` + `syncMcpLocaleFile()` triggered on activate / config
 * change / analyze.
 */
export async function runMcpRefreshPaths(cwd: string, storeDir: string | undefined) {
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();
  await syncMcpConfigFiles(cwd, config);

  const storeDirPath = config.storeDir;
  if (isJsonMode()) {
    printJson({ storeDir: storeDirPath, cwd });
    return;
  }

  logSuccess(`MCP paths map synced to ${storeDirPath}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Command registration
// ────────────────────────────────────────────────────────────────────────────

export const mcpCommand = new Command("mcp")
  .description("Manage MCP server configuration")
  .addCommand(
    new Command("install")
      .description("Install MCP server configuration for Cursor and/or Claude Code")
      .option("--targets <list>", "Comma-separated targets: cursor,claude-code")
      .action(async () => {
        const opts = mcpCommand.optsWithGlobals();
        const cmdOpts = mcpCommand.commands.find((c) => c.name() === "install")?.opts() ?? {};
        await runMcpInstall(
          (opts.cwd as string) ?? process.cwd(),
          opts.storeDir as string | undefined,
          { targets: cmdOpts.targets as string | undefined }
        );
      })
  )
  .addCommand(
    new Command("uninstall")
      .description("Remove MCP server configuration")
      .option("--targets <list>", "Comma-separated targets: cursor,claude-code")
      .action(async () => {
        const opts = mcpCommand.optsWithGlobals();
        const cmdOpts = mcpCommand.commands.find((c) => c.name() === "uninstall")?.opts() ?? {};
        await runMcpUninstall(
          (opts.cwd as string) ?? process.cwd(),
          opts.storeDir as string | undefined,
          { targets: cmdOpts.targets as string | undefined }
        );
      })
  )
  .addCommand(
    new Command("status").description("Show MCP server installation status").action(async () => {
      const opts = mcpCommand.optsWithGlobals();
      await runMcpStatus(
        (opts.cwd as string) ?? process.cwd(),
        opts.storeDir as string | undefined
      );
    })
  )
  .addCommand(
    new Command("refresh-paths")
      .description("Rewrite MCP paths map + locale file under the store dir")
      .action(async () => {
        const opts = mcpCommand.optsWithGlobals();
        await runMcpRefreshPaths(
          (opts.cwd as string) ?? process.cwd(),
          opts.storeDir as string | undefined
        );
      })
  );
