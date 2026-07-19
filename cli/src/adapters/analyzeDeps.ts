/**
 * CLI adapter — builds core AnalyzeSessionDeps and AnalyzeProjectDeps.
 *
 * All business logic is imported from @agent-mindmap/core.
 */
import * as os from "os";
import * as path from "path";
import {
  type AnalyzeSessionDeps,
  type AnalyzeProjectDeps,
  type RunSessionPipelineFn,
  type RunBackgroundMergeFn,
  type RunBatchMergeFn,
  type RunFinalRootRefreshFn,
  type ClearProjectCacheFn,
  type ResolveProjectRecordsFn,
  type ReadSnapshotManifestFn,
  type SanitizeSessionRecordFn,
  type RefreshMcpIndexFn,
  type ProgressReporter,
  type ConfigStore,
  type MindMapSink,
  type CodeRefQueueDeps,
  type LlmDumpDeps,
  type TranscriptParser,
  type ConceptMergeDeps,
  type HostAccess,
  LLM_DUMP_FOLDER,
  dumpDirForWorkspace,
  sanitizeSessionRecord as coreSanitize,
} from "@agent-mindmap/core";
import { resolveStoreDir } from "@agent-mindmap/shared";
import { buildCliLogger } from "../ui/logger";
import { buildCliStoreAccess } from "./cliStore";
import { buildCliHost, detectHost } from "./cliHostAccess";
import { resolveWorkspaceSlug, getCachedSlug } from "./cliSlugResolver";
import type { MergeRecord } from "@agent-mindmap/shared";
import type { CliConfigStore } from "../config/configStore";

// ────────────────────────────────────────────────────────────────────────────
// HostAccess
// ────────────────────────────────────────────────────────────────────────────

export async function buildCliHostAccess(
  cwd: string,
  configStore?: CliConfigStore
): Promise<HostAccess> {
  const config = configStore ?? (await buildConfigStore(cwd));
  const host = await detectHost(cwd, config);
  // Pre-warm the slug cache so getWorkspaceSlug (sync) can return it without
  // doing git calls inline.
  await resolveWorkspaceSlug(cwd, config, host);
  return {
    async getActiveHost() {
      return host;
    },
    getWorkspacePath() {
      return cwd;
    },
    getWorkspaceSlug(h) {
      return getCachedSlug(cwd, config) ?? h.encodeWorkspacePath(cwd);
    },
  };
}

async function buildConfigStore(cwd: string, storeDir?: string): Promise<CliConfigStore> {
  const { CliConfigStore } = await import("../config/configStore");
  const config = new CliConfigStore({ cwd, storeDir });
  await config.load();
  return config;
}

// ────────────────────────────────────────────────────────────────────────────
// Sanitize session record
// ────────────────────────────────────────────────────────────────────────────

function buildCliSanitizeSessionRecord(): SanitizeSessionRecordFn {
  return async (record) => {
    const host = buildCliHost(process.cwd(), record.meta.hostId ?? undefined);
    const parser: TranscriptParser = (content: string) => host.parseTranscript(content);
    return coreSanitize(record, parser);
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Run session pipeline
// ────────────────────────────────────────────────────────────────────────────

function buildCliRunSessionPipeline(): RunSessionPipelineFn {
  return async (opts, provider, signal, progress) => {
    const { runSessionPipeline } = await import("@agent-mindmap/core");
    return runSessionPipeline(opts, provider, signal, progress);
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Background merge
// ────────────────────────────────────────────────────────────────────────────

function buildCliRunBackgroundMerge(
  storeDir: string,
  configStore: ConfigStore,
  cwd: string
): RunBackgroundMergeFn {
  return async (opts) => {
    try {
      const {
        buildDeterministicMergeRecordAsync,
        readSnapshotManifest,
        refreshSnapshotForSession,
        runBatchSnapshotPipeline,
      } = await import("@agent-mindmap/core");

      const storeAccess = buildCliStoreAccess(storeDir);
      const store = await storeAccess.getStore();
      const all = await store.listAllRecords();

      const merge = await buildDeterministicMergeRecordAsync(all, buildCliSanitizeSessionRecord());
      await store.writeDeterministicMerge(merge);

      const projectSlug = opts.projectSlug;
      const projectRecords = all.filter(
        (r: { meta: { projectSlug: string } }) => r.meta.projectSlug === projectSlug
      );
      const records = projectRecords.length ? projectRecords : all;

      const provider = await getLlmProvider(opts.settings.llm);
      const manifest = await readSnapshotManifest(storeDir, projectSlug);
      const sessionId = opts.record.meta.sessionId;

      let concept: MergeRecord;
      if (manifest?.sessionToLeafId[sessionId]) {
        concept = await refreshSnapshotForSession({
          storeDir,
          store,
          projectSlug,
          allRecords: records,
          provider,
          providerId: opts.settings.llm.provider,
          model: opts.settings.llm.model,
          hostId: opts.host.id,
          outputLanguage: undefined,
          signal: opts.signal,
          sessionId,
          sanitizeRecord: buildCliSanitizeSessionRecord(),
          dumpDeps: buildCliLlmDumpDeps(configStore, cwd, storeDir),
        });
      } else {
        const batchNo =
          (manifest?.nodes.filter((n: { level: number }) => n.level === 1).length ?? 0) + 1;
        concept = await runBatchSnapshotPipeline({
          storeDir,
          store,
          projectSlug,
          allRecords: records,
          batchRecords: [opts.record],
          batchNo,
          provider,
          providerId: opts.settings.llm.provider,
          model: opts.settings.llm.model,
          hostId: opts.host.id,
          outputLanguage: undefined,
          signal: opts.signal,
          sanitizeRecord: buildCliSanitizeSessionRecord(),
          dumpDeps: buildCliLlmDumpDeps(configStore, cwd, storeDir),
        });
      }

      // runBatchSnapshotPipeline already writes conceptTrieMerge to the store,
      // but refreshSnapshotForSession does not - normalize by writing in both cases.
      await store.writeConceptTrieMerge(concept);
    } catch (err) {
      buildCliLogger().error("Background merge rebuild failed", err);
    }
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Batch merge
// ────────────────────────────────────────────────────────────────────────────

function buildCliRunBatchMerge(
  storeDir: string,
  configStore: ConfigStore,
  cwd: string
): RunBatchMergeFn {
  return async (opts) => {
    const {
      buildProjectConceptMergeForBatch,
      refreshSnapshotsForFreshSessions,
      runBatchSnapshotPipeline,
    } = await import("@agent-mindmap/core");
    const storeAccess = buildCliStoreAccess(opts.storeDir);
    const store = await storeAccess.getStore();
    const deps: ConceptMergeDeps = {
      store,
      sanitizeRecord: buildCliSanitizeSessionRecord(),
      localeResolver: undefined,
    };

    if (opts.forceRefresh) {
      return buildProjectConceptMergeForBatch(
        deps,
        opts.storeDir,
        opts.allRecords,
        opts.batchRecords,
        {
          projectSlug: opts.projectSlug,
          conceptLlm: opts.conceptLlm,
          provider: opts.provider,
          signal: opts.signal,
          progress: opts.progress,
          batchRefineOntology: opts.batchRefineOntology,
          batchNo: opts.batchNo,
          processed: 0,
          total: opts.allRecords.length,
          forceReattach: opts.forceReattach,
          mergeMode: opts.mergeMode,
          mergeFullReconcileEvery: opts.mergeFullReconcileEvery,
          forceRefresh: opts.forceRefresh,
        }
      );
    }

    if (opts.leafAction === "rebuild" && opts.freshlyAnalyzedSessionIds.length > 0) {
      return refreshSnapshotsForFreshSessions(
        deps,
        opts.storeDir,
        opts.allRecords,
        opts.freshlyAnalyzedSessionIds,
        {
          projectSlug: opts.projectSlug,
          conceptLlm: opts.conceptLlm,
          provider: opts.provider,
          signal: opts.signal,
          progress: opts.progress,
          llmTimeoutMs: opts.conceptLlm.timeoutMs,
        }
      );
    }

    if (opts.leafAction === "new") {
      return runBatchSnapshotPipeline(
        {
          storeDir: opts.storeDir,
          store,
          projectSlug: opts.projectSlug,
          allRecords: opts.allRecords,
          batchRecords: opts.batchRecords,
          batchNo: opts.batchNo,
          provider: opts.provider,
          providerId: opts.conceptLlm.providerId,
          model: opts.conceptLlm.model,
          hostId: opts.conceptLlm.hostId,
          outputLanguage: opts.conceptLlm.outputLanguage,
          llmTimeoutMs: opts.conceptLlm.timeoutMs,
          signal: opts.signal,
          forceReattach: true,
          sanitizeRecord: buildCliSanitizeSessionRecord(),
          dumpDeps: buildCliLlmDumpDeps(configStore, cwd, opts.storeDir),
        },
        opts.progress
      );
    }

    // Fallback: reuse or refresh
    if (opts.freshlyAnalyzedSessionIds.length === 0) {
      const existing = await store.readConceptTrieMerge();
      return existing ?? undefined;
    }

    return refreshSnapshotsForFreshSessions(
      deps,
      opts.storeDir,
      opts.allRecords,
      opts.freshlyAnalyzedSessionIds,
      {
        projectSlug: opts.projectSlug,
        conceptLlm: opts.conceptLlm,
        provider: opts.provider,
        signal: opts.signal,
        progress: opts.progress,
        llmTimeoutMs: opts.conceptLlm.timeoutMs,
      }
    );
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Final root refresh
// ────────────────────────────────────────────────────────────────────────────

function buildCliRunFinalRootRefresh(configStore: ConfigStore, cwd: string): RunFinalRootRefreshFn {
  return async (opts) => {
    const { runFinalRootRefresh } = await import("@agent-mindmap/core");
    const storeAccess = buildCliStoreAccess(opts.storeDir);
    const store = await storeAccess.getStore();
    return runFinalRootRefresh(
      {
        storeDir: opts.storeDir,
        store,
        projectSlug: opts.projectSlug,
        allRecords: opts.allRecords,
        provider: opts.provider,
        providerId: opts.conceptLlm.providerId,
        model: opts.conceptLlm.model,
        hostId: opts.conceptLlm.hostId,
        signal: opts.signal,
        sanitizeRecord: buildCliSanitizeSessionRecord(),
        dumpDeps: buildCliLlmDumpDeps(configStore, cwd, opts.storeDir),
      },
      opts.progress
    );
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Clear project cache
// ────────────────────────────────────────────────────────────────────────────

function buildCliClearProjectCache(storeDir: string): ClearProjectCacheFn {
  return async (storeDirArg, projectSlug) => {
    const { clearProjectAnalysisCache } = await import("@agent-mindmap/core");
    const storeAccess = buildCliStoreAccess(storeDirArg || storeDir);
    const store = await storeAccess.getStore();
    await clearProjectAnalysisCache(storeDirArg || storeDir, projectSlug, store);
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Resolve project records
// ────────────────────────────────────────────────────────────────────────────

function buildCliResolveProjectRecords(storeDir: string): ResolveProjectRecordsFn {
  return async (_storeDir, projectSlug, overlayById) => {
    const { resolveProjectRecordsForMerge } = await import("@agent-mindmap/core");
    const storeAccess = buildCliStoreAccess(storeDir);
    const store = await storeAccess.getStore();
    return resolveProjectRecordsForMerge(store, projectSlug, overlayById);
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Read snapshot manifest
// ────────────────────────────────────────────────────────────────────────────

function buildCliReadSnapshotManifest(): ReadSnapshotManifestFn {
  return async (storeDir, projectSlug) => {
    const { readSnapshotManifest } = await import("@agent-mindmap/core");
    return readSnapshotManifest(storeDir, projectSlug);
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Code ref queue deps
// ────────────────────────────────────────────────────────────────────────────

function buildCliCodeRefQueueDeps(
  _storeDir: string,
  codeRefProgress?: ProgressReporter
): CodeRefQueueDeps {
  return {
    logInfo: (msg) => {
      buildCliLogger().info(msg);
    },
    logWarn: (msg, data) => {
      buildCliLogger().warn(msg, data);
    },
    logError: (msg, err, data) => {
      buildCliLogger().error(msg, err, data);
    },
    async withCancellableProgress<T>(
      _title: string,
      initialMessage: string,
      run: (ctx: { progress: ProgressReporter; signal: AbortSignal }) => Promise<T>
    ): Promise<T | undefined> {
      const controller = new AbortController();
      const progress: ProgressReporter = {
        report(msg) {
          const text = typeof msg === "string" ? msg : (msg.message ?? initialMessage);
          if (codeRefProgress) {
            codeRefProgress.report(text);
          } else {
            buildCliLogger().info(text);
          }
        },
      };
      try {
        return await run({ progress, signal: controller.signal });
      } catch {
        return undefined;
      }
    },
    async getStore(dir: string) {
      return buildCliStoreAccess(dir).getStore();
    },

    async rebuildProjectMerge(storeDir: string, projectSlug: string) {
      const { buildConceptMergeRecordAsync } = await import("@agent-mindmap/core");
      const store = await buildCliStoreAccess(storeDir).getStore();
      const records = await store.listRecordsForProject(projectSlug);
      if (!records.length) {
        return undefined;
      }
      const merge = await buildConceptMergeRecordAsync(records, buildCliSanitizeSessionRecord(), {
        projectSlug,
      });
      await store.writeConceptTrieMerge(merge);
      return merge.mindMap;
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// LLM dump deps
// ────────────────────────────────────────────────────────────────────────────

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function buildCliLlmDumpDeps(configStore: ConfigStore, cwd: string, storeDir: string): LlmDumpDeps {
  return {
    isDumpEnabled() {
      return configStore.get<boolean>("llm.dumpIo") ?? false;
    },
    resolveDumpRoots() {
      const custom = (configStore.get<string>("llm.dumpDir") ?? "").trim();
      if (custom) {
        return [expandHome(custom)];
      }
      const roots: string[] = [path.join(storeDir, LLM_DUMP_FOLDER)];
      const wsRoot = dumpDirForWorkspace(cwd);
      if (!roots.includes(wsRoot)) {
        roots.push(wsRoot);
      }
      return roots;
    },
    logInfo(message: string) {
      buildCliLogger().info(message);
    },
    logWarn(message: string, data?: Record<string, unknown>) {
      buildCliLogger().warn(message, data);
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// MindMap sink
// ────────────────────────────────────────────────────────────────────────────

function buildCliMindMapSink(): MindMapSink {
  return {
    refreshMindMap() {
      /* CLI has no live panel */
    },
    showInfo(message: string) {
      buildCliLogger().info(message);
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// LLM provider
// ────────────────────────────────────────────────────────────────────────────

async function getLlmProvider(opts: import("@agent-mindmap/core").LlmProviderOptions) {
  const { getProvider } = await import("@agent-mindmap/core");
  return getProvider(opts);
}

// ────────────────────────────────────────────────────────────────────────────
// Top-level builders
// ────────────────────────────────────────────────────────────────────────────

export async function buildCliAnalyzeSessionDeps(
  cwd: string,
  configStore: ConfigStore,
  signal?: AbortSignal,
  progress?: ProgressReporter,
  codeRefProgress?: ProgressReporter
): Promise<AnalyzeSessionDeps> {
  const storeDir = (configStore as { storeDir?: string }).storeDir ?? resolveStoreDir();
  const hostAccess = await buildCliHostAccess(cwd, configStore as CliConfigStore);

  return {
    logger: buildCliLogger(),
    progress: progress ?? { report() {} },
    configStore,
    storeAccess: buildCliStoreAccess(storeDir),
    hostAccess,
    mindMapSink: buildCliMindMapSink(),
    codeRefDeps: buildCliCodeRefQueueDeps(storeDir, codeRefProgress),
    llmDumpDeps: buildCliLlmDumpDeps(configStore, cwd, storeDir),
    runSessionPipeline: buildCliRunSessionPipeline(),
    runBackgroundMerge: buildCliRunBackgroundMerge(storeDir, configStore, cwd),
    sanitizeSessionRecord: buildCliSanitizeSessionRecord(),
    refreshMcpIndex: buildCliRefreshMcpIndex(storeDir),

    getProvider: (_opts) => {
      // This is sync in the extension but we need async in CLI;
      // the use case calls it synchronously, so we throw and catch.
      // The extension adapter's getProvider is also sync.
      throw new Error("Use buildCliAnalyzeSessionDepsAsync instead");
    },
    signal,
  };
}

export async function buildCliAnalyzeSessionDepsAsync(
  cwd: string,
  configStore: ConfigStore,
  signal?: AbortSignal,
  progress?: ProgressReporter,
  codeRefProgress?: ProgressReporter
): Promise<AnalyzeSessionDeps> {
  const deps = await buildCliAnalyzeSessionDeps(
    cwd,
    configStore,
    signal,
    progress,
    codeRefProgress
  );
  deps.getProvider = () => {
    // Synchronous getProvider — overridden below after pre-loading module
    throw new Error("CLI getProvider requires async initialization.");
  };

  // Pre-load the provider module and set up sync getProvider
  const { getProvider, initCodeRefQueue } = await import("@agent-mindmap/core");
  deps.getProvider = (opts) => getProvider(opts);

  // Initialize the code-ref queue so background code-ref processing works
  if (deps.codeRefDeps) {
    initCodeRefQueue(deps.codeRefDeps);
  }

  return deps;
}

export async function buildCliAnalyzeProjectDeps(
  cwd: string,
  configStore: ConfigStore,
  signal?: AbortSignal,
  progress?: ProgressReporter,
  codeRefProgress?: ProgressReporter
): Promise<AnalyzeProjectDeps> {
  const sessionDeps = await buildCliAnalyzeSessionDepsAsync(
    cwd,
    configStore,
    signal,
    progress,
    codeRefProgress
  );
  const storeDir = (configStore as { storeDir?: string }).storeDir ?? resolveStoreDir();

  return {
    ...sessionDeps,
    prompter: (await import("../ui/prompter")).buildCliPrompter(),
    runBatchMerge: buildCliRunBatchMerge(storeDir, configStore, cwd),
    runFinalRootRefresh: buildCliRunFinalRootRefresh(configStore, cwd),
    clearProjectCache: buildCliClearProjectCache(storeDir),
    resolveProjectRecords: buildCliResolveProjectRecords(storeDir),
    sanitizeSessionRecord: buildCliSanitizeSessionRecord(),
    readSnapshotManifest: buildCliReadSnapshotManifest(),
    refreshMcpIndex: buildCliRefreshMcpIndex(storeDir),
  };
}

/**
 * Build the `refreshMcpIndex` callback for `analyzeProject`. After analysis
 * completes, this bumps the project's revision in the SQLite store so the
 * MCP server (which reads from the same SQLite db) invalidates its index
 * cache on the next request.
 */
function buildCliRefreshMcpIndex(storeDir: string): RefreshMcpIndexFn {
  return async (projectSlug) => {
    const storeAccess = buildCliStoreAccess(storeDir);
    const store = await storeAccess.getStore();
    const records = await store.listRecordsForProject(projectSlug);
    if (records.length === 0) return;
    const lastAnalyzedAt = Math.max(...records.map((r) => r.meta.analyzedAt));
    const projectPath = records.find((r) => r.meta.projectPath)?.meta.projectPath;
    await store.bumpProjectRevision(projectSlug, records.length, {
      lastAnalyzedAt,
      projectPath,
    });
  };
}
