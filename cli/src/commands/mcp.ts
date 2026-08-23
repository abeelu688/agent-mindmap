/**
 * `agent-mindmap mcp` - MCP server install/uninstall/status commands.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { Command } from "commander";
import {
  mergeAgentMindmapIntoConfig,
  resolveClaudeMcpConfigPath,
  resolveCursorMcpConfigPath,
  writeJsonAtomic,
  type McpServersConfig,
  type McpScope,
} from "@agent-mindmap/core";
import { CliConfigStore } from "../config/configStore";
import { log, logSuccess, logWarn, isJsonMode, printJson } from "../ui/logger";
import { buildCliPrompter } from "../ui/prompter";
import { syncMcpConfigFiles } from "../adapters/mcpConfigSync";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function resolveMcpServerEntry(): string {
  // The MCP server entry - the esbuild-bundled mcp-server/dist/index.js
  // declared as `bin` in mcp-server/package.json. Each surface package
  // ships its own @vscode/sqlite3, so the bundle resolves the native module
  // from mcp-server/node_modules without reaching into extension/.
  const cliDir = path.resolve(__dirname, "..");
  const mcpServerPath = path.resolve(cliDir, "..", "mcp-server", "dist", "index.js");
  return mcpServerPath;
}

/** Parse and validate the --scope option. Returns undefined on invalid input. */
function parseScope(raw: string | undefined): McpScope | undefined {
  if (!raw) return "project";
  const v = raw.trim().toLowerCase();
  if (v === "project" || v === "user") return v;
  return undefined;
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

/** Write config file. User-scope (global) files use atomic write-then-rename
 *  because they are large (e.g. ~/.claude.json) and may be written
 *  concurrently by the host app; project-scope files use the plain write. */
async function writeConfigFile(
  filePath: string,
  data: McpServersConfig,
  scope: McpScope
): Promise<void> {
  if (scope === "user") {
    await writeJsonAtomic(filePath, data);
    return;
  }
  await writeJsonFile(filePath, data);
}

// ────────────────────────────────────────────────────────────────────────────
// mcp install
// ────────────────────────────────────────────────────────────────────────────

export async function runMcpInstall(
  cwd: string,
  storeDir: string | undefined,
  options: { targets?: string; scope?: string }
) {
  const scope = parseScope(options.scope);
  if (!scope) {
    logWarn(`Invalid --scope "${options.scope ?? ""}". Use "project" or "user".`);
    return;
  }

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
        description: resolveCursorMcpConfigPath(scope, workspaceRoot),
        target: "cursor",
        picked: true,
      },
      {
        label: "Claude Code",
        description: resolveClaudeMcpConfigPath(scope, workspaceRoot),
        target: "claude",
        picked: false,
      },
    ];

    const picked = await prompter.showQuickPick(items, {
      canPickMany: true,
      title: `Select which AI products to configure (${scope} scope)`,
    });

    if (!picked || !Array.isArray(picked) || picked.length === 0) {
      logWarn("No targets selected.");
      return;
    }

    installCursor = picked.some((p) => p.target === "cursor");
    installClaude = picked.some((p) => p.target === "claude");
  }

  if (!installCursor && !installClaude) {
    logWarn("No targets selected.");
    return;
  }

  const result: { cursor?: string; claude?: string } = {};

  if (installCursor) {
    const configPath = resolveCursorMcpConfigPath(scope, workspaceRoot);
    const existing = await readJsonFile(configPath);
    const updated = mergeAgentMindmapIntoConfig(existing, serverEntry, storeDirPath);
    await writeConfigFile(configPath, updated, scope);
    result.cursor = configPath;
    logSuccess(`Cursor MCP config updated (${scope}): ${configPath}`);
  }

  if (installClaude) {
    const configPath = resolveClaudeMcpConfigPath(scope, workspaceRoot);
    const existing = await readJsonFile(configPath);
    const updated = mergeAgentMindmapIntoConfig(existing, serverEntry, storeDirPath);
    await writeConfigFile(configPath, updated, scope);
    result.claude = configPath;
    logSuccess(`Claude Code MCP config updated (${scope}): ${configPath}`);
  }

  if (scope === "user") {
    log(
      "Global config written. Restart Claude Code / Cursor (or reload MCP) so every project picks up the agent-mindmap server."
    );
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
  options: { targets?: string; scope?: string }
) {
  const scope = parseScope(options.scope);
  if (!scope) {
    logWarn(`Invalid --scope "${options.scope ?? ""}". Use "project" or "user".`);
    return;
  }

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
    const configPath = resolveCursorMcpConfigPath(scope, workspaceRoot);
    const existing = await readJsonFile(configPath);
    if (existing?.mcpServers?.["agent-mindmap"]) {
      delete existing.mcpServers["agent-mindmap"];
      if (Object.keys(existing.mcpServers).length === 0) {
        delete existing.mcpServers;
      }
      await writeConfigFile(configPath, existing, scope);
      result.cursor = configPath;
      logSuccess(`Removed agent-mindmap from Cursor MCP config (${scope}): ${configPath}`);
    } else {
      logWarn(`No agent-mindmap entry in Cursor MCP config (${scope}): ${configPath}`);
    }
  }

  if (uninstallClaude) {
    const configPath = resolveClaudeMcpConfigPath(scope, workspaceRoot);
    const existing = await readJsonFile(configPath);
    if (existing?.mcpServers?.["agent-mindmap"]) {
      delete existing.mcpServers["agent-mindmap"];
      if (Object.keys(existing.mcpServers).length === 0) {
        delete existing.mcpServers;
      }
      await writeConfigFile(configPath, existing, scope);
      result.claude = configPath;
      logSuccess(`Removed agent-mindmap from Claude Code MCP config (${scope}): ${configPath}`);
    } else {
      logWarn(`No agent-mindmap entry in Claude Code MCP config (${scope}): ${configPath}`);
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

  const cursorProjectPath = resolveCursorMcpConfigPath("project", workspaceRoot);
  const cursorUserPath = resolveCursorMcpConfigPath("user", workspaceRoot);
  const claudeProjectPath = resolveClaudeMcpConfigPath("project", workspaceRoot);
  const claudeUserPath = resolveClaudeMcpConfigPath("user", workspaceRoot);

  const cursorProject = await readJsonFile(cursorProjectPath);
  const cursorUser = await readJsonFile(cursorUserPath);
  const claudeProject = await readJsonFile(claudeProjectPath);
  const claudeUser = await readJsonFile(claudeUserPath);

  const status = {
    cursor: {
      project: {
        installed: !!cursorProject?.mcpServers?.["agent-mindmap"],
        configPath: cursorProjectPath,
      },
      user: {
        installed: !!cursorUser?.mcpServers?.["agent-mindmap"],
        configPath: cursorUserPath,
      },
    },
    claude: {
      project: {
        installed: !!claudeProject?.mcpServers?.["agent-mindmap"],
        configPath: claudeProjectPath,
      },
      user: {
        installed: !!claudeUser?.mcpServers?.["agent-mindmap"],
        configPath: claudeUserPath,
      },
    },
  };

  if (isJsonMode()) {
    printJson(status);
    return;
  }

  log("MCP server status:");
  log(
    `  Cursor (project): ${status.cursor.project.installed ? "✓ installed" : "✗ not installed"} (${cursorProjectPath})`
  );
  log(
    `  Cursor (user):     ${status.cursor.user.installed ? "✓ installed" : "✗ not installed"} (${cursorUserPath})`
  );
  log(
    `  Claude (project):  ${status.claude.project.installed ? "✓ installed" : "✗ not installed"} (${claudeProjectPath})`
  );
  log(
    `  Claude (user):     ${status.claude.user.installed ? "✓ installed" : "✗ not installed"} (${claudeUserPath})`
  );

  const anyInstalled =
    status.cursor.project.installed ||
    status.cursor.user.installed ||
    status.claude.project.installed ||
    status.claude.user.installed;
  if (!anyInstalled) {
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
      .option("--scope <scope>", "Installation scope: project or user (default: project)")
      .action(async () => {
        const opts = mcpCommand.optsWithGlobals();
        const cmdOpts = mcpCommand.commands.find((c) => c.name() === "install")?.opts() ?? {};
        await runMcpInstall(
          (opts.cwd as string) ?? process.cwd(),
          opts.storeDir as string | undefined,
          {
            targets: cmdOpts.targets as string | undefined,
            scope: cmdOpts.scope as string | undefined,
          }
        );
      })
  )
  .addCommand(
    new Command("uninstall")
      .description("Remove MCP server configuration")
      .option("--targets <list>", "Comma-separated targets: cursor,claude-code")
      .option("--scope <scope>", "Installation scope: project or user (default: project)")
      .action(async () => {
        const opts = mcpCommand.optsWithGlobals();
        const cmdOpts = mcpCommand.commands.find((c) => c.name() === "uninstall")?.opts() ?? {};
        await runMcpUninstall(
          (opts.cwd as string) ?? process.cwd(),
          opts.storeDir as string | undefined,
          {
            targets: cmdOpts.targets as string | undefined,
            scope: cmdOpts.scope as string | undefined,
          }
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
