/**
 * `agent-mindmap context` — AI context sync commands.
 */
import { Command } from "commander";
import { syncAiContext } from "@agent-mindmap/core";
import { CliConfigStore } from "../config/configStore";
import { log, logSuccess, logError, isJsonMode, printJson, createSpinner } from "../ui/logger";
import { buildCliHostAccess } from "../adapters/analyzeDeps";
import { buildCliLogger } from "../ui/logger";
import { syncMcpConfigFiles } from "../adapters/mcpConfigSync";

// ────────────────────────────────────────────────────────────────────────────
// context sync
// ────────────────────────────────────────────────────────────────────────────

export async function runContextSync(cwd: string, storeDir: string | undefined) {
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();

  const hostAccess = await buildCliHostAccess(cwd, config);

  // Refresh MCP paths map + locale so the MCP server can resolve this
  // workspace's slug and localize tool examples (mirrors the extension's
  // `writePathsMaps()` + `syncMcpLocaleFile()`).
  await syncMcpConfigFiles(cwd, config);

  // Build MCP refresher adapter
  const mcpRefresher = {
    async refreshMcpIndex(projectSlug: string) {
      // Delegate to the SQLite-backed store so the MCP server (which uses
      // the same SQLite db) sees the revision bump and invalidates its
      // in-memory index cache.
      const storeDirPath = config.storeDir;
      const { buildCliStoreAccess } = await import("../adapters/cliStore");
      const storeAccess = buildCliStoreAccess(storeDirPath);
      const store = await storeAccess.getStore();
      const records = await store.listRecordsForProject(projectSlug);

      if (records.length === 0) return undefined;

      const lastAnalyzedAt = Math.max(...records.map((r) => r.meta.analyzedAt));
      const projectPath = records.find((r) => r.meta.projectPath)?.meta.projectPath;
      await store.bumpProjectRevision(projectSlug, records.length, {
        lastAnalyzedAt,
        projectPath,
      });

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
