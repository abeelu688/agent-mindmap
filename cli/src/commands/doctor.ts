/**
 * `agent-mindmap doctor` — diagnostics check.
 */
import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  createCursorHost,
  createClaudeHost,
  type AgentHostId,
  CORE_PACKAGE_VERSION,
} from "@agent-mindmap/core";
import { CliConfigStore } from "../config/configStore";
import { log, logSuccess, logError, logWarn, isJsonMode, printJson } from "../ui/logger";

function getCursorProjectsRoot(): string {
  return path.join(os.homedir(), ".cursor");
}

function getClaudeProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

type DoctorResult = {
  cliVersion: string;
  coreVersion: string;
  storeDir: string;
  storeExists: boolean;
  detectedHosts: { id: AgentHostId; scanDir: string | null; cliFound: boolean }[];
  configPath: string;
  configExists: boolean;
  cwd: string;
  workspaceSlug: string | null;
};

async function runDoctor(cwd: string, storeDirOverride?: string): Promise<DoctorResult> {
  const fsModule = require("fs"); // eslint-disable-line @typescript-eslint/no-require-imports
  const pathModule = require("path"); // eslint-disable-line @typescript-eslint/no-require-imports
  const pkgPath = pathModule.join(__dirname, "..", "..", "package.json");
  const pkg = JSON.parse(fsModule.readFileSync(pkgPath, "utf-8")) as { version: string };

  const storeDir = storeDirOverride ?? path.join(os.homedir(), ".agent-mindmap-store");
  let storeExists = false;
  try {
    await fs.access(storeDir);
    storeExists = true;
  } catch {
    storeExists = false;
  }

  const config = new CliConfigStore({ cwd, storeDir: storeDirOverride });
  await config.load();

  const cursorHost = createCursorHost(
    getCursorProjectsRoot,
    () => "Install Cursor CLI from cursor.sh"
  );
  const claudeHost = createClaudeHost(
    getClaudeProjectsRoot,
    () => "Install Claude CLI from claude.ai"
  );

  const detectedHosts: { id: AgentHostId; scanDir: string | null; cliFound: boolean }[] = [
    {
      id: "cursor",
      scanDir: cursorHost.getSessionsScanDir(cwd) ?? null,
      cliFound: false,
    },
    {
      id: "claude-code",
      scanDir: claudeHost.getSessionsScanDir(cwd) ?? null,
      cliFound: false,
    },
  ];

  // Check CLI availability
  for (const host of detectedHosts) {
    try {
      const { exec } = await import("child_process");
      const cliCmd = host.id === "cursor" ? "cursor-agent" : "claude";
      await new Promise<void>((resolve, reject) => {
        exec(`${cliCmd} --version`, { timeout: 5000 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      host.cliFound = true;
    } catch {
      host.cliFound = false;
    }
  }

  const configPath = config.userConfigFilePath;
  let configExists = false;
  try {
    await fs.access(configPath);
    configExists = true;
  } catch {
    configExists = false;
  }

  const activeHostId = config.get<string>("host") ?? "auto";
  let workspaceSlug: string | null = null;
  if (activeHostId === "cursor") {
    workspaceSlug = cursorHost.encodeWorkspacePath(cwd);
  } else if (activeHostId === "claude-code") {
    workspaceSlug = claudeHost.encodeWorkspacePath(cwd);
  } else {
    // Auto-detect
    const cursorDir = cursorHost.getSessionsScanDir(cwd);
    if (cursorDir) {
      try {
        await fs.access(cursorDir);
        workspaceSlug = cursorHost.encodeWorkspacePath(cwd);
      } catch {
        // Try claude
      }
    }
    if (!workspaceSlug) {
      const claudeDir = claudeHost.getSessionsScanDir(cwd);
      if (claudeDir) {
        try {
          await fs.access(claudeDir);
          workspaceSlug = claudeHost.encodeWorkspacePath(cwd);
        } catch {
          // No hosts detected
        }
      }
    }
  }

  return {
    cliVersion: pkg.version,
    coreVersion: CORE_PACKAGE_VERSION,
    storeDir,
    storeExists,
    detectedHosts,
    configPath,
    configExists,
    cwd,
    workspaceSlug,
  };
}

export const doctorCommand = new Command("doctor")
  .description("Run diagnostics and check environment")
  .action(async () => {
    const opts = doctorCommand.optsWithGlobals();
    const cwd = (opts.cwd as string) ?? process.cwd();
    const storeDir = opts.storeDir as string | undefined;

    const result = await runDoctor(cwd, storeDir);

    if (isJsonMode()) {
      printJson(result);
      return;
    }

    log(`Agent Mind Map CLI v${result.cliVersion}`);
    log(`  @agent-mindmap/core: v${result.coreVersion}`);
    log("");
    log("Store:");
    log(`  Directory: ${result.storeDir}`);
    if (result.storeExists) {
      logSuccess("Store directory exists");
    } else {
      logWarn("Store directory not found (will be created on first use)");
    }
    log("");
    log("Hosts:");
    for (const host of result.detectedHosts) {
      const scanStatus = host.scanDir
        ? await fs
            .access(host.scanDir)
            .then(() => "found")
            .catch(() => "not found")
        : "N/A";
      const cliStatus = host.cliFound ? "installed" : "not found";
      log(`  ${host.id}:`);
      log(`    Scan dir: ${host.scanDir ?? "(none)"} [${scanStatus}]`);
      log(`    CLI: ${cliStatus}`);
    }
    log("");
    log("Config:");
    log(`  Path: ${result.configPath}`);
    if (result.configExists) {
      logSuccess("Config file exists");
    } else {
      logWarn("Config file not found (will be created on first set)");
    }
    log("");
    log("Workspace:");
    log(`  CWD: ${result.cwd}`);
    log(`  Slug: ${result.workspaceSlug ?? "(not resolved)"}`);

    // Exit non-zero if no hosts have transcripts
    const anyScanDirFound = result.detectedHosts.some((h) => h.scanDir !== null);
    if (!anyScanDirFound) {
      logError("No agent transcript directories found. Is this a Cursor or Claude Code project?");
      process.exit(1);
    }
  });
