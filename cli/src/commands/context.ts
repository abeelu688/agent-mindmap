/**
 * `agent-mindmap context` — AI context sync commands.
 */
import * as path from "path";
import * as os from "os";
import { Command } from "commander";
import { syncAiContext } from "@agent-mindmap/core";
import { CliConfigStore } from "../config/configStore";
import { log, logSuccess, logError, isJsonMode, printJson, createSpinner } from "../ui/logger";
import { buildCliHostAccess } from "../adapters/analyzeDeps";
import { buildCliLogger } from "../ui/logger";

// ────────────────────────────────────────────────────────────────────────────
// context sync
// ────────────────────────────────────────────────────────────────────────────

export async function runContextSync(cwd: string, storeDir: string | undefined) {
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();

  const hostAccess = buildCliHostAccess(cwd);

  // Build MCP refresher adapter
  const mcpRefresher = {
    async refreshMcpIndex(projectSlug: string) {
      // CLI does not have MCP index support (that's extension-only).
      // Report the project slug + record count instead.
      const storeDirPath = storeDir ?? path.join(os.homedir(), ".agent-mindmap-store");
      const { buildCliStoreAccess } = await import("../adapters/cliStore");
      const storeAccess = buildCliStoreAccess(storeDirPath);
      const store = await storeAccess.getStore();
      const records = await store.listRecordsForProject(projectSlug);

      if (records.length === 0) return undefined;

      return { projectSlug, recordCount: records.length };
    },
  };

  const spinner = createSpinner("Syncing AI context…");
  spinner.start();

  try {
    const result = await syncAiContext({
      hostAccess,
      logger: buildCliLogger(),
      mcpRefresher,
    });

    if (!result) {
      spinner.warn("No analyzed sessions for this project.");
      return;
    }

    spinner.succeed("Context sync complete");

    if (isJsonMode()) {
      printJson(result);
      return;
    }

    logSuccess(`Project: ${result.projectSlug}`);
    log(`  Records: ${result.recordCount}`);
  } catch (err) {
    spinner.fail("Context sync failed");
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

export const contextCommand = new Command("context")
  .description("Manage AI context for the workspace")
  .addCommand(
    new Command("sync").description("Sync AI context (refresh MCP index)").action(async () => {
      const opts = contextCommand.optsWithGlobals();
      await runContextSync(
        (opts.cwd as string) ?? process.cwd(),
        opts.storeDir as string | undefined
      );
    })
  );
