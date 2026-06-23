/**
 * `agent-mindmap project` — project-level commands.
 */
import { Command } from "commander";
import * as os from "os";
import * as path from "path";
import {
  analyzeProject,
  listSessions,
  getCodeRefQueueDepth,
  readSnapshotManifest,
  readMergeSnapshot,
  type SnapshotManifest,
  type MergeSnapshot,
} from "@agent-mindmap/core";
import { CliConfigStore } from "../config/configStore";
import {
  log,
  logSuccess,
  logError,
  logWarn,
  isJsonMode,
  printJson,
  createSpinner,
} from "../ui/logger";
import { buildCliHostAccess, buildCliAnalyzeProjectDeps } from "../adapters/analyzeDeps";

// ────────────────────────────────────────────────────────────────────────────
// project analyze
// ────────────────────────────────────────────────────────────────────────────

export async function runProjectAnalyze(
  cwd: string,
  storeDir: string | undefined,
  options: { force?: boolean }
) {
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();

  const spinner = createSpinner("Analyzing project…");
  spinner.start();

  const controller = new AbortController();
  const signal = controller.signal;

  const onSigint = () => {
    controller.abort();
    spinner.fail("Cancelled");
    process.exit(130);
  };
  process.on("SIGINT", onSigint);

  const progress: import("@agent-mindmap/core").ProgressReporter = {
    report(update) {
      const msg = typeof update === "string" ? update : (update.message ?? "");
      spinner.text = msg || "Analyzing project…";
    },
  };

  try {
    const deps = await buildCliAnalyzeProjectDeps(cwd, config, signal, progress);
    const handle = await analyzeProject(deps);

    spinner.succeed("Project analysis complete");

    // Wait for background work
    if (handle.completed) {
      const bgSpinner = createSpinner("Draining code-ref queue…");
      bgSpinner.start();
      await handle.completed();
      bgSpinner.succeed("Code-ref queue drained");
    }

    const result = handle.result;
    if (isJsonMode()) {
      printJson(result);
      return;
    }

    logSuccess(`Project: ${result.projectSlug}`);
    log(`  Total:     ${result.total}`);
    log(`  Analyzed:  ${result.analyzed}`);
    log(`  Cached:    ${result.skippedFresh}`);
    log(`  Fallback:  ${result.turnFallbacks}`);
    log(`  Failed:    ${result.failed}`);
    if (result.cliMissingCount > 0) {
      logWarn(`  CLI missing: ${result.cliMissingCount}`);
    }
    if (result.failures.length > 0) {
      log("");
      logWarn("Failures:");
      for (const f of result.failures) {
        logError(`  ${f.label}: ${f.message}`);
      }
    }
  } catch (err) {
    spinner.fail("Project analysis failed");
    if (err instanceof Error) {
      logError(err.message);
    } else {
      logError(String(err));
    }
    process.exit(1);
  } finally {
    process.off("SIGINT", onSigint);
  }
  void options;
}

// ────────────────────────────────────────────────────────────────────────────
// project status
// ────────────────────────────────────────────────────────────────────────────

export async function runProjectStatus(cwd: string, storeDir: string | undefined) {
  const hostAccess = buildCliHostAccess(cwd);
  const result = await listSessions({ hostAccess });

  if (!result) {
    logWarn("No workspace or host detected.");
    return;
  }

  const storeDirPath = storeDir ?? path.join(os.homedir(), ".agent-mindmap-store");
  const { ensureStore, readRecord } = await import("@agent-mindmap/core");
  await ensureStore(storeDirPath);

  let analyzedCount = 0;
  let staleCount = 0;

  for (const session of result.sessions) {
    try {
      const record = await readRecord(storeDirPath, result.projectSlug, session.id);
      if (record) {
        analyzedCount++;
      } else {
        staleCount++;
      }
    } catch {
      staleCount++;
    }
  }

  // Snapshot / merge status
  let manifest: SnapshotManifest | undefined;
  try {
    manifest = await readSnapshotManifest(storeDirPath, result.projectSlug);
  } catch {
    // no manifest
  }

  let mergeSnapshot: MergeSnapshot | undefined;
  try {
    mergeSnapshot = await readMergeSnapshot(storeDirPath, result.projectSlug);
  } catch {
    // no merge snapshot
  }

  const lastMergeAt = mergeSnapshot?.meta?.builtAt;
  // MergeSnapshot is always deterministic; kind="llm-refined" lives on MergeRecordMeta
  const mergeMode: "deterministic" | null = mergeSnapshot ? "deterministic" : null;
  const snapshotNodeCount = manifest?.nodes?.length ?? 0;
  const latestSnapshotAt = manifest?.nodes?.length
    ? Math.max(...manifest.nodes.map((n) => n.builtAt))
    : undefined;

  // Code-ref queue depth
  const queueDepth = getCodeRefQueueDepth();

  const status = {
    projectSlug: result.projectSlug,
    scanDir: result.scanDir,
    totalSessions: result.sessions.length,
    analyzed: analyzedCount,
    stale: staleCount,
    storeDir: storeDirPath,
    mergeMode: mergeMode ?? null,
    lastMergeAt: lastMergeAt ?? null,
    latestSnapshotAt: latestSnapshotAt ?? null,
    snapshotNodes: snapshotNodeCount,
    codeRefQueueDepth: queueDepth,
  };

  if (isJsonMode()) {
    printJson(status);
    return;
  }

  log(`Project: ${status.projectSlug}`);
  log(`  Scan dir:    ${status.scanDir}`);
  log(`  Sessions:    ${status.totalSessions} total`);
  log(`  Analyzed:    ${analyzedCount}`);
  log(`  Stale:       ${staleCount}`);
  log(`  Store:       ${status.storeDir}`);
  if (mergeMode) {
    log(`  Merge mode:  ${mergeMode}`);
  }
  if (lastMergeAt) {
    log(`  Last merge:  ${new Date(lastMergeAt).toISOString()}`);
  }
  if (latestSnapshotAt) {
    log(
      `  Snapshot:    ${snapshotNodeCount} nodes, latest ${new Date(latestSnapshotAt).toISOString()}`
    );
  }
  if (queueDepth > 0) {
    logWarn(`  Code-ref queue: ${queueDepth} pending item(s)`);
  } else {
    log(`  Code-ref queue: empty`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Command registration
// ────────────────────────────────────────────────────────────────────────────

export const projectCommand = new Command("project")
  .description("Manage and analyze projects")
  .addCommand(
    new Command("analyze")
      .description("Analyze all sessions in the current project")
      .option("--force", "Force re-analysis of all sessions")
      .action(async () => {
        const opts = projectCommand.optsWithGlobals();
        const cmdOpts = projectCommand.commands.find((c) => c.name() === "analyze")?.opts() ?? {};
        await runProjectAnalyze(
          (opts.cwd as string) ?? process.cwd(),
          opts.storeDir as string | undefined,
          { force: cmdOpts.force as boolean | undefined }
        );
      })
  )
  .addCommand(
    new Command("status").description("Show project analysis status").action(async () => {
      const opts = projectCommand.optsWithGlobals();
      await runProjectStatus(
        (opts.cwd as string) ?? process.cwd(),
        opts.storeDir as string | undefined
      );
    })
  );
