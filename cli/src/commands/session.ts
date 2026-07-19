/**
 * `agent-mindmap session` — session-related commands.
 */
import * as path from "path";
import { Command } from "commander";
import {
  listSessions,
  analyzeSession,
  buildOutlineMindMap,
  exportMindMapPackage,
  ensureModelConfigured,
  type ListSessionsResult,
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
import { DualSpinner } from "../ui/dualSpinner";
import { buildCliHostAccess, buildCliAnalyzeSessionDepsAsync } from "../adapters/analyzeDeps";
import { resolveMediaDir } from "../mediaDir";

// ────────────────────────────────────────────────────────────────────────────
// session list
// ────────────────────────────────────────────────────────────────────────────

export async function runSessionList(
  cwd: string,
  storeDir: string | undefined,
  options: { allHosts?: boolean; limit?: number; json?: boolean }
) {
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();

  const hostAccess = await buildCliHostAccess(cwd, config);

  const result: ListSessionsResult | undefined = await listSessions({ hostAccess });

  if (!result) {
    logWarn("No sessions found. Is this a Cursor or Claude Code project?");
    return;
  }

  let sessions = result.sessions;
  if (options.limit) {
    sessions = sessions.slice(0, options.limit);
  }

  if (isJsonMode()) {
    printJson(
      sessions.map((s) => ({
        id: s.id,
        label: s.label,
        mtimeMs: s.mtimeMs,
        hostId: s.hostId,
        projectSlug: s.projectSlug,
      }))
    );
    return;
  }

  if (sessions.length === 0) {
    logWarn("No sessions found.");
    return;
  }

  for (const s of sessions) {
    const age = formatAge(s.mtimeMs);
    log(`  ${s.id.slice(0, 8)}  ${age.padStart(6)}  ${s.label}`);
  }
  log(`\n${sessions.length} session(s)`);
}

// ────────────────────────────────────────────────────────────────────────────
// session show
// ────────────────────────────────────────────────────────────────────────────

export async function runSessionShow(cwd: string, storeDir: string | undefined, sessionId: string) {
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();

  const hostAccess = await buildCliHostAccess(cwd, config);
  const result = await listSessions({ hostAccess });

  if (!result) {
    logError("No sessions found.");
    return;
  }

  const session = result.sessions.find((s) => s.id === sessionId || s.id.startsWith(sessionId));
  if (!session) {
    logError(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  // Check library for existing record
  const storeDirPath = config.storeDir;
  let record: import("@agent-mindmap/shared").SessionRecord | undefined;
  try {
    const { readRecord } = await import("@agent-mindmap/core");
    record = await readRecord(storeDirPath, result.projectSlug, session.id);
  } catch {
    // No record
  }

  const info = {
    id: session.id,
    label: session.label,
    hostId: session.hostId,
    projectSlug: session.projectSlug,
    transcriptPath: session.filePath,
    mtimeMs: session.mtimeMs,
    analyzed: !!record,
    analyzedAt: record?.meta.analyzedAt,
    outlineTopics: record?.outline?.outline?.length ?? 0,
    llmProvider: record?.meta.llm?.provider,
    llmModel: record?.meta.llm?.model,
  };

  if (isJsonMode()) {
    printJson(info);
    return;
  }

  log(`Session: ${info.label}`);
  log(`  ID:            ${info.id}`);
  log(`  Host:          ${info.hostId ?? "(unknown)"}`);
  log(`  Project:       ${info.projectSlug}`);
  log(`  Transcript:    ${info.transcriptPath}`);
  log(`  Modified:      ${new Date(info.mtimeMs).toISOString()}`);
  if (info.analyzed) {
    logSuccess(`Analyzed at ${new Date(info.analyzedAt!).toISOString()}`);
    log(`  Topics:        ${info.outlineTopics}`);
    log(`  LLM:           ${info.llmProvider}${info.llmModel ? ` / ${info.llmModel}` : ""}`);
  } else {
    logWarn("Not yet analyzed");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// session analyze
// ────────────────────────────────────────────────────────────────────────────

export async function runSessionAnalyze(
  cwd: string,
  storeDir: string | undefined,
  options: { latest?: boolean; force?: boolean; sessionId?: string }
) {
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();

  // ── Gate: ensure LLM CLI is configured and available ───────────────────
  const hostAccess = await buildCliHostAccess(cwd, config);
  const host = await hostAccess.getActiveHost();
  const modelCheck = await ensureModelConfigured({
    configStore: config,
    hostDefaultProvider: host.defaultLlmProvider,
    cliPath: (config.get<string>("llm.cliPath") ?? "").trim() || undefined,
  });
  if (!modelCheck.ok) {
    if (modelCheck.reason === "not-configured") {
      logError("No LLM provider configured. Run `agent-mindmap model select` to choose one.");
    } else {
      logError("Configured LLM CLI not found. Run `agent-mindmap model select` to reconfigure.");
    }
    process.exit(1);
  }

  const result = await listSessions({ hostAccess });

  if (!result || result.sessions.length === 0) {
    logError("No sessions found.");
    process.exit(1);
  }

  let session = result.sessions[0]!;
  if (!options.latest && options.sessionId) {
    const sessionIdPrefix = options.sessionId;
    const found = result.sessions.find(
      (s) => s.id === sessionIdPrefix || s.id.startsWith(sessionIdPrefix)
    );
    if (!found) {
      logError(`Session not found: ${options.sessionId}`);
      process.exit(1);
    }
    session = found;
  }

  const dual = new DualSpinner(`Analyzing session: ${session.label}`);
  dual.start();

  const controller = new AbortController();
  const signal = controller.signal;

  // Handle SIGINT
  const onSigint = () => {
    controller.abort();
    dual.fail("Cancelled");
    process.exit(130);
  };
  process.on("SIGINT", onSigint);

  const mainProgress: import("@agent-mindmap/core").ProgressReporter = {
    report(update) {
      const msg = typeof update === "string" ? update : (update.message ?? "");
      dual.updatePrimary(msg || `Analyzing: ${session.label}`);
    },
  };

  const codeRefProgress: import("@agent-mindmap/core").ProgressReporter = {
    report(update) {
      const msg = typeof update === "string" ? update : (update.message ?? "");
      if (msg) {
        dual.updateSecondary(`Code refs: ${msg}`);
      }
    },
  };

  try {
    const deps = await buildCliAnalyzeSessionDepsAsync(
      cwd,
      config,
      signal,
      mainProgress,
      codeRefProgress
    );
    const handle = await analyzeSession(session, deps, { forceRefresh: options.force });

    dual.succeedPrimary("Analysis complete");

    // Wait for background work (code-ref queue drain) — critical for CLI
    if (handle.completed) {
      await handle.completed();
      dual.succeedSecondary("Code-ref queue drained");
    }

    const loaded = handle.result;
    if (isJsonMode()) {
      printJson({
        sessionId: loaded.session.id,
        label: loaded.session.label,
        source: loaded.source,
        fromLibrary: loaded.fromLibrary,
        topics: loaded.mindMap?.children?.length ?? 0,
      });
      return;
    }

    logSuccess(`Session: ${loaded.session.label}`);
    log(`  Source: ${loaded.source}${loaded.fromLibrary ? " (from library)" : ""}`);
    log(`  Topics: ${loaded.mindMap?.children?.length ?? 0}`);
  } catch (err) {
    dual.fail("Analysis failed");
    if (err instanceof Error) {
      logError(err.message);
    } else {
      logError(String(err));
    }
    process.exit(1);
  } finally {
    process.off("SIGINT", onSigint);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// session dump
// ────────────────────────────────────────────────────────────────────────────

export async function runSessionDump(
  cwd: string,
  storeDir: string | undefined,
  sessionId: string,
  options: { output?: string; force?: boolean; withAnalyze?: boolean }
) {
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();

  const hostAccess = await buildCliHostAccess(cwd, config);
  const result = await listSessions({ hostAccess });

  if (!result) {
    logError("No sessions found.");
    process.exit(1);
  }

  const session = result.sessions.find((s) => s.id === sessionId || s.id.startsWith(sessionId));
  if (!session) {
    logError(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  // Optionally analyze first
  if (options.withAnalyze) {
    await runSessionAnalyze(cwd, storeDir, {
      latest: false,
      force: false,
      sessionId: session.id,
    });
  }

  const storeDirPath = config.storeDir;
  const { readRecord, ensureStore } = await import("@agent-mindmap/core");
  await ensureStore(storeDirPath);

  const record = await readRecord(storeDirPath, result.projectSlug, session.id);
  if (!record) {
    logError(`Session not yet analyzed: ${session.id}`);
    logError("Run `agent-mindmap session analyze` first, or use --with-analyze.");
    process.exit(1);
  }

  // Build mind map from record
  const sessionMeta = {
    sessionId: record.meta.sessionId,
    projectSlug: record.meta.projectSlug,
    projectPath: record.meta.projectPath,
    sessionLabel: record.meta.sessionLabel,
    transcriptPath: record.meta.transcriptPath,
  };

  const mindMap = buildOutlineMindMap(
    record.outline,
    record.meta.sessionLabel,
    sessionMeta,
    record.sessionAnalysis?.codeReferences,
    record.meta.projectPath,
    record.meta.outputLanguage
  );

  // Resolve output directory
  const defaultOutDir = path.join(
    process.cwd(),
    "agent-mindmap-export",
    `${record.meta.hostId ?? "session"}-${session.id.slice(0, 8)}-${Date.now()}`
  );
  const outDir = options.output ?? defaultOutDir;

  // Resolve media directory
  const mediaDir = resolveMediaDir();

  const spinner = createSpinner("Exporting mind map package…");
  spinner.start();

  try {
    const exportResult = await exportMindMapPackage({
      outDir,
      mindMap,
      mediaDir,
      ui: { preset: "auto", direction: 2 },
      onWarning: (msg) => logWarn(msg),
      title: record.meta.sessionLabel,
    });

    spinner.succeed("Export complete");

    if (isJsonMode()) {
      printJson({ outDir: exportResult.outDir, transcripts: exportResult.transcriptCount });
      return;
    }

    logSuccess(`Exported to: ${exportResult.outDir}`);
    log(`  Transcripts: ${exportResult.transcriptCount}`);
    log(`  Open:        ${path.join(exportResult.outDir, "index.html")}`);
  } catch (err) {
    spinner.fail("Export failed");
    if (err instanceof Error) {
      logError(err.message);
    } else {
      logError(String(err));
    }
    process.exit(1);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function formatAge(mtimeMs: number): string {
  const diff = Date.now() - mtimeMs;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ────────────────────────────────────────────────────────────────────────────
// Command registration
// ────────────────────────────────────────────────────────────────────────────

export const sessionCommand = new Command("session")
  .description("Manage and analyze agent chat sessions")
  .addCommand(
    new Command("list")
      .description("List sessions for the current workspace")
      .option("--all-hosts", "Include sessions from all hosts")
      .option("--limit <n>", "Limit number of sessions", parseInt)
      .action(async () => {
        const opts = sessionCommand.optsWithGlobals();
        const cmd = opts._command as Command | undefined;
        const cmdOpts = cmd?.opts() ?? {};
        await runSessionList(
          (opts.cwd as string) ?? process.cwd(),
          opts.storeDir as string | undefined,
          { allHosts: cmdOpts.allHosts, limit: cmdOpts.limit, json: opts.json }
        );
      })
  )
  .addCommand(
    new Command("show")
      .description("Show session metadata")
      .argument("<id>", "Session ID (or prefix)")
      .action(async (sessionId: string) => {
        const opts = sessionCommand.optsWithGlobals();
        await runSessionShow(
          (opts.cwd as string) ?? process.cwd(),
          opts.storeDir as string | undefined,
          sessionId
        );
      })
  )
  .addCommand(
    new Command("analyze")
      .description("Analyze a session using the LLM pipeline")
      .option("--latest", "Analyze the most recent session (default)")
      .option("--force", "Force re-analysis even if cached")
      .argument("[id]", "Session ID (or prefix)")
      .action(async (sessionId?: string) => {
        const opts = sessionCommand.optsWithGlobals();
        const cmdOpts = sessionCommand.commands.find((c) => c.name() === "analyze")?.opts() ?? {};
        await runSessionAnalyze(
          (opts.cwd as string) ?? process.cwd(),
          opts.storeDir as string | undefined,
          { latest: !sessionId, force: cmdOpts.force, sessionId }
        );
      })
  )
  .addCommand(
    new Command("dump")
      .description("Export session mind map as an offline HTML package")
      .argument("<id>", "Session ID (or prefix)")
      .option("-o, --output <dir>", "Output directory")
      .option("--force", "Overwrite existing output directory")
      .option("--with-analyze", "Analyze the session first if needed")
      .action(async (sessionId: string) => {
        const opts = sessionCommand.optsWithGlobals();
        const cmdOpts = sessionCommand.commands.find((c) => c.name() === "dump")?.opts() ?? {};
        await runSessionDump(
          (opts.cwd as string) ?? process.cwd(),
          opts.storeDir as string | undefined,
          sessionId,
          {
            output: cmdOpts.output as string | undefined,
            force: cmdOpts.force as boolean | undefined,
            withAnalyze: cmdOpts.withAnalyze as boolean | undefined,
          }
        );
      })
  );
