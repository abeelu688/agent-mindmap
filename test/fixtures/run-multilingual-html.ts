import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";
import {
  buildProjectConceptMergeForBatch,
  toConceptMergeLlmOpts,
} from "../../extension/src/batch/conceptMerge";
import { exportMindMapPackage } from "../../extension/src/export/exportPackage";
import { cursorHost } from "../../extension/src/host/cursorHost";
import { getProvider } from "../../extension/src/llm";
import { readLlmOptions } from "../../extension/src/llmOptions";
import { buildOutlineMindMap } from "../../extension/src/mindmap/buildOutlineMindMap";
import type { SessionMeta } from "../../extension/src/mindmap/origin";
import type { ProjectMergeMode } from "../../extension/src/pipeline/deltaMergePipeline";
import { drainCodeRefQueue } from "../../extension/src/codeRefQueue";
import {
  ensureStore,
  listRecords,
  readRecord,
  readMergeRecord,
  conceptTrieMergePath,
} from "../../extension/src/store/sessionStore";
import { sanitizeSessionRecord } from "../../extension/src/store/sanitizeRecords";
import { deleteSnapshotHierarchy } from "../../extension/src/store/mergeSnapshot";
import {
  listCursorSessions,
} from "../../extension/src/transcript/listSessions";
import type { MindMapRoot, TranscriptSession } from "../../extension/src/transcript/types";
import {
  loadSession,
  runProjectSessionBatches,
  type AnalyzeProjectBatchInfo,
  type LoadDeps,
} from "../../extension/src/sessionLoader";
import type { SessionRecord } from "../../extension/src/store/storeTypes";
import type { LlmErrorCode } from "../../extension/src/llm/types";

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(__dirname, "../..");
const FIXTURES_ROOT = path.join(
  REPO_ROOT,
  "test/fixtures/multilingual-jsonl/cursor-projects"
);
const DEFAULT_OUT = path.join(REPO_ROOT, "test/fixtures/multilingual-jsonl/html-out");
const WORKSPACES_ROOT = path.join(REPO_ROOT, "test/fixtures/multilingual-jsonl/workspaces");

const ALL_PROJECTS = [
  "zh-inventory-admin",
  "en-payments-api",
  "ja-docs-portal",
  "ko-observability-hub",
] as const;

type CliOptions = {
  projects: string[];
  sessionIds: string[];
  outDir: string;
  storeDir: string;
  forceRefresh: boolean;
  skipMerge: boolean;
  withMerge: boolean;
  exportOnly: boolean;
  provider?: "cursor-cli" | "claude-cli";
  cliPath?: string;
  model?: string;
};

function usage(): string {
  return `Usage: node extension/dist/multilingual-html-run.js [options]

Analyze multilingual JSONL fixtures with the same session + merge pipeline as
the VS Code extension, then write offline HTML packages (like Download Package).

Options:
  --all                 Process all fixture projects (default)
  --project <slug>      Process one project (repeatable)
  --session <id>        Process one or more session ids (repeatable)
  --out-dir <path>      HTML output root (default: test/fixtures/multilingual-jsonl/html-out)
  --store-dir <path>    Analysis library store (default: <out-dir>/.store)
  --force-refresh       Ignore library cache and re-run LLM stages
  --skip-merge          Only per-session HTML (no concept merge package)
  --with-merge          When using --session, still run merge (default: skip merge)
  --export-only         Skip LLM/analysis; export HTML from existing store only
  --provider <id>       LLM provider: cursor-cli | claude-cli
  --cli-path <path>     Headless CLI binary (e.g. /opt/homebrew/bin/claude)
  --model <name>        Model passed to CLI via --model
  -h, --help            Show this help

Environment (alternatives to flags):
  AGENT_MINDMAP_LLM_PROVIDER   cursor-cli | claude-cli | auto
  AGENT_MINDMAP_LLM_CLI_PATH   Path to agent / cursor-agent / claude
  AGENT_MINDMAP_LLM_MODEL      Model name for --model

If cursor-agent is missing but \`claude\` is on PATH, claude-cli is auto-selected.

Requires a built extension + webview (npm run build) and a working headless CLI.
`;
}

async function whichPath(name: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("which", [name]);
    const resolved = stdout.trim();
    return resolved || undefined;
  } catch {
    return undefined;
  }
}

function applyLlmEnvFromOpts(opts: CliOptions): void {
  if (opts.provider) {
    process.env.AGENT_MINDMAP_LLM_PROVIDER = opts.provider;
  }
  if (opts.cliPath) {
    process.env.AGENT_MINDMAP_LLM_CLI_PATH = opts.cliPath;
    if (!opts.provider && !process.env.AGENT_MINDMAP_LLM_PROVIDER) {
      const base = path.basename(opts.cliPath);
      if (base === "claude") {
        process.env.AGENT_MINDMAP_LLM_PROVIDER = "claude-cli";
      } else if (base === "agent" || base === "cursor-agent") {
        process.env.AGENT_MINDMAP_LLM_PROVIDER = "cursor-cli";
      }
    }
  }
  if (opts.model) {
    process.env.AGENT_MINDMAP_LLM_MODEL = opts.model;
  }
}

/** Pick claude-cli when cursor-agent is unavailable unless provider is explicitly cursor-cli. */
async function autoDetectLlmEnv(opts: CliOptions): Promise<void> {
  if (opts.exportOnly) {
    return;
  }
  if (process.env.AGENT_MINDMAP_LLM_CLI_PATH?.trim()) {
    return;
  }

  const explicitProvider = opts.provider ?? process.env.AGENT_MINDMAP_LLM_PROVIDER?.trim();
  if (explicitProvider === "claude-cli") {
    const claude = await whichPath("claude");
    if (claude) {
      process.env.AGENT_MINDMAP_LLM_CLI_PATH = claude;
    }
    return;
  }
  if (explicitProvider === "cursor-cli") {
    for (const bin of ["agent", "cursor-agent"]) {
      const resolved = await whichPath(bin);
      if (resolved) {
        process.env.AGENT_MINDMAP_LLM_CLI_PATH = resolved;
        return;
      }
    }
    return;
  }

  for (const bin of ["agent", "cursor-agent"]) {
    const resolved = await whichPath(bin);
    if (resolved) {
      process.env.AGENT_MINDMAP_LLM_PROVIDER = "cursor-cli";
      process.env.AGENT_MINDMAP_LLM_CLI_PATH = resolved;
      return;
    }
  }

  const claude = await whichPath("claude");
  if (claude) {
    process.env.AGENT_MINDMAP_LLM_PROVIDER = "claude-cli";
    process.env.AGENT_MINDMAP_LLM_CLI_PATH = claude;
  }
}

function formatLlmCliMissingHint(providerId: string): string {
  if (providerId === "claude-cli") {
    return [
      "Headless LLM CLI not found (claude).",
      "Install Claude Code CLI or run with:",
      "  AGENT_MINDMAP_LLM_CLI_PATH=/path/to/claude npm run fixtures:html -- ...",
    ].join("\n");
  }
  return [
    "Headless LLM CLI not found (agent / cursor-agent).",
    "Install: curl https://cursor.com/install -fsS | bash",
    "Or run with:",
    "  AGENT_MINDMAP_LLM_CLI_PATH=/path/to/agent npm run fixtures:html -- ...",
    "Or use Claude CLI:",
    "  AGENT_MINDMAP_LLM_PROVIDER=claude-cli AGENT_MINDMAP_LLM_CLI_PATH=/path/to/claude npm run fixtures:html -- ...",
  ].join("\n");
}

async function preflightLlmCli(context: vscode.ExtensionContext): Promise<void> {
  const llmOpts = await readLlmOptions(context);
  console.log(`LLM provider: ${llmOpts.provider}`);
  if (llmOpts.model) {
    console.log(`LLM model: ${llmOpts.model}`);
  }

  const configured = llmOpts.cliPath?.trim();
  if (configured) {
    try {
      await fs.access(configured);
      console.log(`LLM CLI: ${configured}`);
      return;
    } catch {
      throw new Error(`Configured LLM CLI not executable: ${configured}`);
    }
  }

  const candidates =
    llmOpts.provider === "claude-cli" ? ["claude"] : ["agent", "cursor-agent"];
  for (const bin of candidates) {
    const resolved = await whichPath(bin);
    if (resolved) {
      process.env.AGENT_MINDMAP_LLM_CLI_PATH = resolved;
      console.log(`LLM CLI: ${resolved}`);
      return;
    }
  }

  throw new Error(formatLlmCliMissingHint(llmOpts.provider));
}

function formatAnalyzeFailure(
  failures: Array<{ sessionId: string; llmErrorCode?: LlmErrorCode }>
): string {
  const lines = [
    "Session analysis did not produce any library records, so no HTML was exported.",
    "The fixture HTML script needs a successful session-analysis LLM run (and code-ref LLM when tools edited files).",
  ];
  for (const f of failures) {
    lines.push(`  - ${f.sessionId}: ${f.llmErrorCode ?? "failed"}`);
  }
  lines.push("");
  lines.push(formatLlmCliMissingHint("cursor-cli"));
  return lines.join("\n");
}

function assertRecordsForExport(records: SessionRecord[], projectSlug: string): void {
  if (records.length) {
    return;
  }
  throw new Error(
    `No analyzed sessions to export for ${projectSlug}. ` +
      "See errors above (usually missing headless LLM CLI)."
  );
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    projects: [],
    sessionIds: [],
    outDir: DEFAULT_OUT,
    storeDir: "",
    forceRefresh: false,
    skipMerge: false,
    withMerge: false,
    exportOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--all":
        break;
      case "--project":
        opts.projects.push(argv[++i] ?? "");
        break;
      case "--session":
        opts.sessionIds.push(argv[++i] ?? "");
        break;
      case "--out-dir":
        opts.outDir = path.resolve(argv[++i] ?? DEFAULT_OUT);
        break;
      case "--store-dir":
        opts.storeDir = path.resolve(argv[++i] ?? "");
        break;
      case "--force-refresh":
        opts.forceRefresh = true;
        break;
      case "--skip-merge":
        opts.skipMerge = true;
        break;
      case "--with-merge":
        opts.withMerge = true;
        break;
      case "--export-only":
        opts.exportOnly = true;
        break;
      case "--provider": {
        const value = argv[++i] ?? "";
        if (value !== "cursor-cli" && value !== "claude-cli") {
          throw new Error(`Invalid --provider: ${value} (use cursor-cli or claude-cli)`);
        }
        opts.provider = value;
        break;
      }
      case "--cli-path":
        opts.cliPath = path.resolve(argv[++i] ?? "");
        break;
      case "--model":
        opts.model = argv[++i] ?? "";
        break;
      case "-h":
      case "--help":
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    }
  }

  if (!opts.storeDir) {
    opts.storeDir = path.join(opts.outDir, ".store");
  }
  if (opts.sessionIds.length > 0 && !opts.withMerge) {
    opts.skipMerge = true;
  }
  if (!opts.projects.length) {
    if (opts.sessionIds.length) {
      const derived = [...new Set(opts.sessionIds.map((id) => id.replace(/-\d{3}$/, "")))];
      opts.projects = derived.filter((slug) =>
        ALL_PROJECTS.includes(slug as (typeof ALL_PROJECTS)[number])
      );
      if (!opts.projects.length) {
        throw new Error(
          `Could not derive project slug from session id(s): ${opts.sessionIds.join(", ")}`
        );
      }
    } else {
      opts.projects = [...ALL_PROJECTS];
    }
  }
  for (const slug of opts.projects) {
    if (!ALL_PROJECTS.includes(slug as (typeof ALL_PROJECTS)[number])) {
      throw new Error(`Unknown project slug: ${slug}`);
    }
  }
  for (const sessionId of opts.sessionIds) {
    const projectSlug = sessionId.replace(/-\d{3}$/, "");
    if (!opts.projects.includes(projectSlug)) {
      throw new Error(
        `Session ${sessionId} belongs to ${projectSlug}, which is not in the selected project list`
      );
    }
  }

  return opts;
}

function fixtureProjectPath(_projectSlug: string): string {
  return path.join(WORKSPACES_ROOT, "demo-app");
}

function createContext(extensionPath: string): vscode.ExtensionContext {
  const stub = vscode as unknown as {
    __createContext: (extensionPath: string) => vscode.ExtensionContext;
  };
  return stub.__createContext(extensionPath);
}

async function ensureExportAssets(extensionPath: string): Promise<void> {
  const mediaDir = path.join(extensionPath, "media");
  for (const file of ["webview.js", "webview.css", "transcript-markdown.js"]) {
    try {
      await fs.access(path.join(mediaDir, file));
    } catch {
      throw new Error(
        `Missing ${path.join(mediaDir, file)}. Run "npm run build" first.`
      );
    }
  }
}

function consoleProgress(message: string): void {
  console.log(message);
}

async function exportMindMapHtml(
  outDir: string,
  mindMap: MindMapRoot,
  extensionUri: vscode.Uri,
  title?: string
): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  const result = await exportMindMapPackage({
    outDir,
    mindMap,
    extensionUri,
    title,
  });
  console.log(`  exported HTML -> ${result.outDir} (${result.transcriptCount} transcript page(s))`);
}

function sessionMetaFromRecord(record: SessionRecord): SessionMeta {
  return {
    sessionId: record.meta.sessionId,
    projectSlug: record.meta.projectSlug,
    projectPath: record.meta.projectPath,
    sessionLabel: record.meta.sessionLabel,
    transcriptPath: record.meta.transcriptPath,
  };
}

async function exportSessionRecords(
  records: SessionRecord[],
  outRoot: string,
  extensionUri: vscode.Uri
): Promise<void> {
  for (const record of records) {
    const sanitized = await sanitizeSessionRecord(record);
    const mindMap = buildOutlineMindMap(
      sanitized.outline,
      sanitized.meta.sessionLabel,
      sessionMetaFromRecord(sanitized),
      sanitized.sessionAnalysis?.codeReferences,
      sanitized.meta.projectPath,
      sanitized.meta.outputLanguage
    );
    const sessionOut = path.join(outRoot, "sessions", sanitized.meta.sessionId);
    await exportMindMapHtml(
      sessionOut,
      mindMap,
      extensionUri,
      sanitized.meta.sessionLabel
    );
  }
}

async function listFixtureSessions(
  projectSlug: string,
  sessionIds: string[] = []
): Promise<TranscriptSession[]> {
  const transcriptsDir = path.join(FIXTURES_ROOT, projectSlug);
  const projectPath = fixtureProjectPath(projectSlug);
  const sessions = await listCursorSessions(transcriptsDir, {
    projectSlug,
    projectPath,
    hostId: "cursor",
  });
  if (!sessionIds.length) {
    return sessions;
  }
  const allowed = new Set(sessionIds);
  const picked = sessions.filter((s) => allowed.has(s.id));
  const missing = sessionIds.filter((id) => !picked.some((s) => s.id === id));
  if (missing.length) {
    throw new Error(`Unknown session id(s) for ${projectSlug}: ${missing.join(", ")}`);
  }
  return picked;
}

async function reloadProjectRecords(
  storeDir: string,
  projectSlug: string,
  sessionIds: string[]
): Promise<SessionRecord[]> {
  let records = (await listRecords(storeDir)).filter((r) => r.meta.projectSlug === projectSlug);
  if (sessionIds.length) {
    const allowed = new Set(sessionIds);
    records = records.filter((r) => allowed.has(r.meta.sessionId));
  }
  return Promise.all(records.map((r) => sanitizeSessionRecord(r)));
}

async function analyzeSelectedSessions(
  projectSlug: string,
  sessions: TranscriptSession[],
  opts: CliOptions,
  context: vscode.ExtensionContext
): Promise<SessionRecord[]> {
  const host = cursorHost;
  await ensureStore(opts.storeDir);
  if (opts.forceRefresh) {
    await deleteSnapshotHierarchy(opts.storeDir, projectSlug);
  }

  const signal = new AbortController().signal;
  const deps: LoadDeps = {
    context,
    signal,
    progress: { report: (msg) => consoleProgress(typeof msg === "string" ? msg : (msg.message ?? "")) },
  };
  const failures: Array<{ sessionId: string; llmErrorCode?: LlmErrorCode }> = [];

  for (const session of sessions) {
    console.log(`  analyzing session ${session.id}…`);
    const loaded = await loadSession(
      session,
      deps,
      { forceRefresh: opts.forceRefresh, skipAutoMerge: true, quietLlmErrors: false },
      host
    );
    if (loaded.source === "turn") {
      failures.push({
        sessionId: session.id,
        llmErrorCode: loaded.llmErrorCode,
      });
      console.warn(
        `  session ${session.id} fell back to turn view (${loaded.llmErrorCode ?? "llm-failed"}) — no outline HTML/code-ref pipeline`
      );
    } else {
      console.log(`  waiting for code-ref LLM (${session.id})…`);
      await drainCodeRefQueue();
    }
  }

  const records = await reloadProjectRecords(
    opts.storeDir,
    projectSlug,
    sessions.map((s) => s.id)
  );
  if (!records.length && failures.length) {
    throw new Error(formatAnalyzeFailure(failures));
  }
  if (!records.length) {
    throw new Error(`No SessionRecords written for ${projectSlug} after analysis.`);
  }
  return records;
}

async function analyzeProject(
  projectSlug: string,
  opts: CliOptions,
  context: vscode.ExtensionContext,
  extensionUri: vscode.Uri
): Promise<{ records: SessionRecord[]; mergeMindMap?: MindMapRoot }> {
  const host = cursorHost;
  const sessions = await listFixtureSessions(projectSlug, opts.sessionIds);
  if (!sessions.length) {
    throw new Error(`No fixture sessions found for ${projectSlug}`);
  }

  console.log(`==> ${projectSlug}: ${sessions.length} session(s)`);

  if (opts.exportOnly) {
    const records = await reloadProjectRecords(opts.storeDir, projectSlug, opts.sessionIds);
    if (!records.length) {
      throw new Error(
        `No store records for ${projectSlug} under ${opts.storeDir} (run without --export-only first)`
      );
    }
    const merge = opts.skipMerge
      ? undefined
      : await readMergeRecord(conceptTrieMergePath(opts.storeDir));
    return {
      records,
      mergeMindMap: merge?.mindMap,
    };
  }

  if (opts.sessionIds.length > 0) {
    const records = await analyzeSelectedSessions(projectSlug, sessions, opts, context);
    if (opts.skipMerge) {
      return { records };
    }

    const llmOpts = await readLlmOptions(context);
    const provider = getProvider(llmOpts);
    const conceptLlm = toConceptMergeLlmOpts(llmOpts, provider.id);
    const signal = new AbortController().signal;
    const mergeMode =
      (vscode.workspace
        .getConfiguration("agentMindmap")
        .get<string>("library.mergeMode", "delta") as ProjectMergeMode) || "delta";
    const mergeFullReconcileEvery =
      vscode.workspace
        .getConfiguration("agentMindmap")
        .get<number>("library.mergeFullReconcileEvery", 4) ?? 4;
    const conceptMerge = await buildProjectConceptMergeForBatch(
      opts.storeDir,
      records,
      records,
      {
        projectSlug,
        conceptLlm,
        provider,
        signal,
        progress: {
          report: (msg) =>
            consoleProgress(typeof msg === "string" ? msg : (msg.message ?? "")),
        },
        batchRefineOntology: true,
        batchNo: 1,
        processed: records.length,
        total: records.length,
        forceReattach: true,
        mergeMode,
        mergeFullReconcileEvery,
        forceRefresh: opts.forceRefresh,
      }
    );
    return { records, mergeMindMap: conceptMerge.mindMap };
  }

  await ensureStore(opts.storeDir);
  if (opts.forceRefresh) {
    await deleteSnapshotHierarchy(opts.storeDir, projectSlug);
  }

  const llmOpts = await readLlmOptions(context);
  const provider = getProvider(llmOpts);
  const conceptLlm = toConceptMergeLlmOpts(llmOpts, provider.id);
  const signal = new AbortController().signal;
  const deps: LoadDeps = {
    context,
    signal,
    progress: { report: (msg) => consoleProgress(typeof msg === "string" ? msg : (msg.message ?? "")) },
  };

  const projectRecordsById = new Map<string, SessionRecord>();
  let latestMergeMindMap: MindMapRoot | undefined;

  const batchResult = await runProjectSessionBatches(sessions, projectSlug, host, deps, {
    forceRefresh: opts.forceRefresh,
    skipAutoMerge: true,
    batchSize: 5,
    onBatchDone: async (info: AnalyzeProjectBatchInfo) => {
      for (const sessionId of info.batchSessionIds) {
        const rec = await readRecord(opts.storeDir, projectSlug, sessionId);
        if (rec) {
          projectRecordsById.set(sessionId, await sanitizeSessionRecord(rec));
        }
      }

      if (opts.skipMerge) {
        return;
      }

      const batchRecords = info.batchSessionIds
        .map((id) => projectRecordsById.get(id))
        .filter((r): r is SessionRecord => Boolean(r));

      const mergeMode =
        (vscode.workspace
          .getConfiguration("agentMindmap")
          .get<string>("library.mergeMode", "delta") as ProjectMergeMode) || "delta";
      const mergeFullReconcileEvery =
        vscode.workspace
          .getConfiguration("agentMindmap")
          .get<number>("library.mergeFullReconcileEvery", 4) ?? 4;

      const conceptMerge = await buildProjectConceptMergeForBatch(
        opts.storeDir,
        [...projectRecordsById.values()],
        batchRecords,
        {
          projectSlug,
          conceptLlm,
          provider,
          signal,
          progress: deps.progress,
          batchRefineOntology: true,
          batchNo: info.batchNo,
          processed: info.processed,
          total: info.total,
          forceReattach: true,
          mergeMode,
          mergeFullReconcileEvery,
          forceRefresh: opts.forceRefresh,
        }
      );
      latestMergeMindMap = conceptMerge.mindMap;
      console.log(
        `  merge batch ${info.batchNo}: ${info.processed}/${info.total} sessions processed`
      );
    },
  });

  console.log("  waiting for code-ref LLM queue…");
  await drainCodeRefQueue();

  const records = await reloadProjectRecords(opts.storeDir, projectSlug, opts.sessionIds);
  if (!records.length) {
    const batchFailures = batchResult.failures.map((f) => ({
      sessionId: f.sessionId,
      llmErrorCode: f.message.includes("cli-missing")
        ? ("cli-missing" as const)
        : undefined,
    }));
    throw new Error(
      batchFailures.length
        ? formatAnalyzeFailure(batchFailures)
        : `No SessionRecords written for ${projectSlug} after batch analysis.`
    );
  }

  if (!opts.skipMerge && !latestMergeMindMap) {
    const merge = await readMergeRecord(conceptTrieMergePath(opts.storeDir));
    latestMergeMindMap = merge?.mindMap;
  }

  return { records, mergeMindMap: latestMergeMindMap };
}

async function writeProjectSummary(
  projectOut: string,
  projectSlug: string,
  records: SessionRecord[],
  mergedPath?: string
): Promise<void> {
  const summary = {
    projectSlug,
    outputLanguageVotes: records.reduce<Record<string, number>>((acc, rec) => {
      const lang = rec.meta.outputLanguage ?? "English";
      acc[lang] = (acc[lang] ?? 0) + 1;
      return acc;
    }, {}),
    sessions: records.map((rec) => ({
      sessionId: rec.meta.sessionId,
      outputLanguage: rec.meta.outputLanguage ?? "English",
      sessionHtml: `sessions/${rec.meta.sessionId}/index.html`,
      label: rec.meta.sessionLabel,
    })),
    mergedHtml: mergedPath ? "merged/index.html" : undefined,
  };
  await fs.writeFile(
    path.join(projectOut, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );
}

export async function runMultilingualHtmlExport(
  argv = process.argv.slice(2)
): Promise<number> {
  const opts = parseArgs(argv);
  const extensionPath = path.join(REPO_ROOT, "extension");
  await ensureExportAssets(extensionPath);

  process.env.AGENT_MINDMAP_STORE_DIR = opts.storeDir;
  process.env.AGENT_MINDMAP_HTML_OUT_DIR = opts.outDir;
  process.env.AGENT_MINDMAP_DUMP_IO = "1";

  applyLlmEnvFromOpts(opts);
  await autoDetectLlmEnv(opts);

  await fs.mkdir(opts.outDir, { recursive: true });
  await fs.mkdir(opts.storeDir, { recursive: true });

  const context = createContext(extensionPath);
  const extensionUri = vscode.Uri.file(extensionPath);

  if (!opts.exportOnly) {
    await preflightLlmCli(context);
  }

  const manifest: {
    generatedAt: string;
    outDir: string;
    storeDir: string;
    projects: Record<string, { sessionsDir: string; mergedDir?: string }>;
  } = {
    generatedAt: new Date().toISOString(),
    outDir: opts.outDir,
    storeDir: opts.storeDir,
    projects: {},
  };

  for (const projectSlug of opts.projects) {
    const projectOut = path.join(opts.outDir, projectSlug);
    await fs.mkdir(projectOut, { recursive: true });

    const { records, mergeMindMap } = await analyzeProject(
      projectSlug,
      opts,
      context,
      extensionUri
    );

    assertRecordsForExport(records, projectSlug);
    await exportSessionRecords(records, projectOut, extensionUri);

    let mergedDir: string | undefined;
    if (!opts.skipMerge && mergeMindMap) {
      mergedDir = path.join(projectOut, "merged");
      await exportMindMapHtml(
        mergedDir,
        mergeMindMap,
        extensionUri,
        `Concept Mind Map · ${projectSlug}`
      );
    }

    await writeProjectSummary(projectOut, projectSlug, records, mergedDir);
    manifest.projects[projectSlug] = {
      sessionsDir: path.relative(opts.outDir, path.join(projectOut, "sessions")),
      mergedDir: mergedDir ? path.relative(opts.outDir, mergedDir) : undefined,
    };
  }

  await fs.writeFile(
    path.join(opts.outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  console.log(`\nDone. Open HTML under:\n  ${opts.outDir}`);
  console.log(`Library store:\n  ${opts.storeDir}`);
  console.log(`LLM dumps:\n  ${path.join(opts.outDir, "llm-dumps")}`);
  return 0;
}

async function main(): Promise<void> {
  try {
    const code = await runMultilingualHtmlExport();
    process.exit(code);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

void main();
