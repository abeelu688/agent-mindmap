/**
 * `agent-mindmap team` — team service commands.
 */
import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { CliConfigStore, userConfigDir } from "../config/configStore";
import {
  log,
  logSuccess,
  logError,
  logWarn,
  isJsonMode,
  printJson,
  createSpinner,
} from "../ui/logger";
import { buildCliPrompter } from "../ui/prompter";
import { buildCliLogger } from "../ui/logger";

// ────────────────────────────────────────────────────────────────────────────
// Token file storage
// ────────────────────────────────────────────────────────────────────────────

function tokenFilePath(): string {
  return path.join(userConfigDir(), "team-token");
}

async function readTeamToken(): Promise<string> {
  // Env var override
  const envToken = process.env.AGENT_MINDMAP_TEAM_TOKEN;
  if (envToken) return envToken;

  try {
    return (await fs.readFile(tokenFilePath(), "utf-8")).trim();
  } catch {
    return "";
  }
}

async function writeTeamToken(token: string): Promise<void> {
  const filePath = tokenFilePath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, token, { mode: 0o600 });
}

// ────────────────────────────────────────────────────────────────────────────
// team configure
// ────────────────────────────────────────────────────────────────────────────

export async function runTeamConfigure(cwd: string, storeDir: string | undefined) {
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();

  const prompter = buildCliPrompter();

  // 1. Server URL
  const currentUrl = config.get<string>("team.serverUrl") ?? "";
  const serverUrl = await prompter.showInputBox({
    prompt: "Team service URL",
    value: currentUrl || "http://localhost:8080",
  });

  if (!serverUrl) {
    logWarn("Cancelled.");
    return;
  }

  // 2. Validate connectivity
  const spinner = createSpinner("Validating connection…");
  spinner.start();

  try {
    const response = await fetch(`${serverUrl.replace(/\/+$/, "")}/healthz`);
    if (!response.ok) {
      spinner.fail(`Server returned ${response.status}`);
      logError("Could not reach the team service. Check the URL and try again.");
      return;
    }
    spinner.succeed("Connection OK");
  } catch (err) {
    spinner.fail("Connection failed");
    logError(`Could not reach ${serverUrl}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // 3. API Key / Token
  const currentToken = await readTeamToken();
  const token = await prompter.showInputBox({
    prompt: "API key (or token)",
    value: currentToken ? "••••••••" : "",
  });

  if (!token || token === "••••••••") {
    if (currentToken) {
      log("  Token: (unchanged)");
    } else {
      logWarn("No API key set. Team push will not work until you provide one.");
    }
  } else {
    await writeTeamToken(token);
    logSuccess("Token saved (mode 0600)");
  }

  // 4. Persist server URL
  await config.set("team.serverUrl", serverUrl.replace(/\/+$/, ""));
  logSuccess(`Team service configured: ${serverUrl.replace(/\/+$/, "")}`);
}

// ────────────────────────────────────────────────────────────────────────────
// team status
// ────────────────────────────────────────────────────────────────────────────

export async function runTeamStatus(cwd: string, storeDir: string | undefined) {
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();

  const serverUrl = config.get<string>("team.serverUrl") ?? "";
  const token = await readTeamToken();
  const tokenPresent = token.length > 0;
  const tokenMasked = tokenPresent ? `${token.slice(0, 4)}…${token.slice(-4)}` : "(not set)";

  const status = {
    serverUrl: serverUrl || "(not configured)",
    tokenPresent,
    tokenMasked: tokenPresent ? tokenMasked : null,
    envTokenOverride: !!process.env.AGENT_MINDMAP_TEAM_TOKEN,
  };

  if (isJsonMode()) {
    printJson(status);
    return;
  }

  log("Team service status:");
  log(`  Server URL:   ${status.serverUrl}`);
  log(`  Token:        ${tokenMasked}`);
  if (process.env.AGENT_MINDMAP_TEAM_TOKEN) {
    log(`  Token source: AGENT_MINDMAP_TEAM_TOKEN env var`);
  }
  if (!serverUrl) {
    logWarn("  Team mode is not configured. Run `agent-mindmap team configure`.");
  } else if (!tokenPresent) {
    logWarn("  Server URL is set but no API key. Run `agent-mindmap team configure`.");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// team push
// ────────────────────────────────────────────────────────────────────────────

export async function runTeamPush(cwd: string, storeDir: string | undefined) {
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();

  const serverUrl = config.get<string>("team.serverUrl") ?? "";
  const token = await readTeamToken();

  if (!serverUrl) {
    logError("Team mode is not configured. Run `agent-mindmap team configure` first.");
    process.exit(1);
  }

  if (!token) {
    logError("API key is missing. Run `agent-mindmap team configure` to set it.");
    process.exit(1);
  }

  const spinner = createSpinner("Pushing sessions to team service…");
  spinner.start();

  try {
    // Build the CLI team push adapter and call the core use case
    const { pushToTeam } = await import("@agent-mindmap/core");
    const { RemoteStore } = await import("@agent-mindmap/shared");
    const { buildCliStoreAccess } = await import("../adapters/cliStore");

    const storeDirPath = storeDir ?? path.join(os.homedir(), ".agent-mindmap-store");
    const remoteStore = new RemoteStore(serverUrl, token);
    const localStoreAccess = buildCliStoreAccess(storeDirPath);
    const localStore = await localStoreAccess.getStore();
    const allRecords = await localStore.listAllRecords();

    if (allRecords.length === 0) {
      spinner.succeed("No local sessions to push.");
      return;
    }

    // Build the TeamPushAccess adapter
    const { PushQueue } = await import("@agent-mindmap/core");
    const pushQueue = new PushQueue(
      localStore as import("@agent-mindmap/shared").SqliteStore,
      remoteStore
    );

    const teamPushAccess = {
      async isTeamModeEnabled() {
        return !!(serverUrl && token);
      },
      hasServerUrl() {
        return !!serverUrl;
      },
      async getLocalStore() {
        return localStore;
      },
      async setPendingFlagsForAllProjects(
        store: import("@agent-mindmap/shared").Store,
        records: import("@agent-mindmap/shared").SessionRecord[]
      ) {
        const PENDING_PREFIX = "push-pending:";
        const projectMaxAt = new Map<string, number>();
        for (const rec of records) {
          const slug = rec.meta.projectSlug;
          if (!slug) continue;
          projectMaxAt.set(slug, Math.max(projectMaxAt.get(slug) ?? 0, rec.meta.analyzedAt));
        }
        // Write pending flags via the store's KV interface if available
        const sqliteStore = store as import("@agent-mindmap/shared").SqliteStore;
        for (const [slug, maxAt] of projectMaxAt) {
          const pendingKey = PENDING_PREFIX + slug;
          const current = (await sqliteStore.readKvJson?.(pendingKey)) ?? 0;
          if (maxAt > current) {
            await sqliteStore.writeKvJson?.(pendingKey, maxAt);
          }
        }
      },
      async drainAllPushQueues() {
        await pushQueue.drain();
      },
    };

    await pushToTeam({
      teamPushAccess,
      prompter: buildCliPrompter(),
      logger: buildCliLogger(),
    });

    pushQueue.dispose();
    spinner.succeed(`Pushed ${allRecords.length} session(s) to team service`);

    if (isJsonMode()) {
      printJson({ pushed: allRecords.length, serverUrl });
    }
  } catch (err) {
    spinner.fail("Push failed");
    if (err instanceof Error) {
      logError(err.message);
    } else {
      logError(String(err));
    }
    process.exit(1);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Command registration
// ────────────────────────────────────────────────────────────────────────────

export const teamCommand = new Command("team")
  .description("Manage team service integration")
  .addCommand(
    new Command("configure")
      .description("Configure team service URL and API key")
      .action(async () => {
        const opts = teamCommand.optsWithGlobals();
        await runTeamConfigure(
          (opts.cwd as string) ?? process.cwd(),
          opts.storeDir as string | undefined
        );
      })
  )
  .addCommand(
    new Command("status").description("Show team service configuration status").action(async () => {
      const opts = teamCommand.optsWithGlobals();
      await runTeamStatus(
        (opts.cwd as string) ?? process.cwd(),
        opts.storeDir as string | undefined
      );
    })
  )
  .addCommand(
    new Command("push").description("Push local sessions to the team service").action(async () => {
      const opts = teamCommand.optsWithGlobals();
      await runTeamPush((opts.cwd as string) ?? process.cwd(), opts.storeDir as string | undefined);
    })
  );
