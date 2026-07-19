/**
 * `agent-mindmap mode` - show or set the project mode (workspace / repo).
 *
 * Top-level shortcut for `config set project.mode <mode>` so users don't have
 * to discover that config key. Switching to repo mode runs the prerequisite
 * gate (git repo + origin + cwd is repo root) up front so the failure surfaces
 * here, not later during `project analyze`.
 */
import { Command } from "commander";
import {
  checkRepoPrerequisites,
  normalizeRepoUriToSlug,
  type ProjectMode,
} from "@agent-mindmap/core";
import { CliConfigStore } from "../config/configStore";
import { log, logSuccess, logError, logWarn, isJsonMode, printJson } from "../ui/logger";
import { syncMcpConfigFiles } from "../adapters/mcpConfigSync";

function isProjectMode(value: string): value is ProjectMode {
  return value === "workspace" || value === "repo";
}

function normalizeModeArg(modeArg: string): ProjectMode | undefined {
  const normalized = modeArg.toLowerCase();
  if (!isProjectMode(normalized)) {
    logError(`Invalid mode "${modeArg}". Use "workspace" or "repo".`);
    return undefined;
  }
  return normalized;
}

async function runModeSet(
  cwd: string,
  storeDir: string | undefined,
  mode: ProjectMode
): Promise<void> {
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();

  if (mode === "repo") {
    const res = await checkRepoPrerequisites(cwd);
    if (!res.ok) {
      logError(`Cannot switch to repo mode: ${res.reason}`);
      logWarn(
        "Repo mode requires the current directory to be a git repo with an origin remote at the repo root."
      );
      process.exit(1);
    }
  }

  await config.set("project.mode", mode);
  await syncMcpConfigFiles(cwd, config);

  logSuccess(`Project mode set to: ${mode}`);
  if (mode === "repo") {
    const res = await checkRepoPrerequisites(cwd);
    if (res.ok) {
      log(`  Repo slug: ${normalizeRepoUriToSlug(res.uri)}`);
    }
  } else {
    log("  Slug is derived from the workspace folder path.");
  }
}

async function runModeShow(cwd: string, storeDir: string | undefined): Promise<void> {
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();
  const current = (config.get<string>("project.mode") ?? "workspace") as ProjectMode;
  const resolved = isProjectMode(current) ? current : "workspace";

  if (isJsonMode()) {
    const payload: { mode: ProjectMode; repoSlug?: string } = { mode: resolved };
    if (resolved === "repo") {
      const res = await checkRepoPrerequisites(cwd);
      if (res.ok) {
        payload.repoSlug = normalizeRepoUriToSlug(res.uri);
      }
    }
    printJson(payload);
    return;
  }

  log(`Current mode: ${resolved}`);
  if (resolved === "repo") {
    const res = await checkRepoPrerequisites(cwd);
    if (res.ok) {
      log(`  Repo slug: ${normalizeRepoUriToSlug(res.uri)}`);
    } else {
      logWarn(`  Repo prerequisites not met: ${res.reason}`);
    }
  }
  log("Use `amind mode workspace` or `amind mode repo` to change.");
}

export const modeCommand = new Command("mode")
  .description("Show or set the project mode (workspace or repo)")
  .argument(
    "[mode]",
    "Mode to set: 'workspace' (slug from folder path) or 'repo' (slug from git origin URI)"
  )
  .action(async (modeArg: string | undefined) => {
    const opts = modeCommand.optsWithGlobals();
    const cwd = (opts.cwd as string) ?? process.cwd();
    const storeDir = opts.storeDir as string | undefined;

    if (modeArg === undefined) {
      await runModeShow(cwd, storeDir);
      return;
    }

    const resolved = normalizeModeArg(modeArg);
    if (!resolved) {
      process.exit(1);
    }
    await runModeSet(cwd, storeDir, resolved);
  });
