/**
 * CLI adapter — builds core AnalyzeSessionDeps and AnalyzeProjectDeps.
 *
 * All business logic is imported from @agent-mindmap/core.
 */
import * as path from "path";
import * as os from "os";
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
  type ProgressReporter,
  type ConfigStore,
  type MindMapSink,
  type CodeRefQueueDeps,
  type LlmDumpDeps,
  type TranscriptParser,
  type ConceptMergeDeps,
  sanitizeSessionRecord as coreSanitize,
} from "@agent-mindmap/core";
import { buildCliLogger } from "../ui/logger";
import { buildCliStoreAccess } from "./cliStore";
import { buildCliHost, detectHost } from "./cliHostAccess";

// ────────────────────────────────────────────────────────────────────────────
// HostAccess
// ────────────────────────────────────────────────────────────────────────────

export function buildCliHostAccess(cwd: string): HostAccess {
  return {
    async getActiveHost() {
      return detectHost(cwd, await buildConfigStore(cwd));
    },
    getWorkspacePath() {
      return cwd;
    },
    getWorkspaceSlug(host) {
      return host.encodeWorkspacePath(cwd);
    },
  };
}

async function buildConfigStore(cwd: string, storeDir?: string) {
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

function buildCliRunBackgroundMerge(storeDir: string): RunBackgroundMergeFn {
  return async (opts) => {
    try {
      const {
        buildDeterministicMergeRecordAsync,
        readSnapshotManifest,
        refreshSnapshotForSession,
      } = await import("@agent-mindmap/core");

      const storeAccess = buildCliStoreAccess(storeDir);
      const store = await storeAccess.getStore();
      const all = await store.listAllRecords();

      const merge = await buildDeterministicMergeRecordAsync(all);
      await store.writeDeterministicMerge(merge);

      void opts.settings.llm;
      const projectSlug = opts.projectSlug;
      const projectRecords = all.filter(
        (r: { meta: { projectSlug: string } }) => r.meta.projectSlug === projectSlug
      );
      const records = projectRecords.length ? projectRecords : all;

      const manifest = await readSnapshotManifest(storeDir, projectSlug);
      if (manifest?.sessionToLeafId[opts.record.meta.sessionId]) {
        await refreshSnapshotForSession({
          storeDir,
          store,
          projectSlug,
          allRecords: records,
          provider: await getLlmProvider(opts.settings.llm),
          providerId: opts.settings.llm.provider,
          model: opts.settings.llm.model,
          hostId: opts.host.id,
          outputLanguage: undefined,
          signal: opts.signal,
          sessionId: opts.record.meta.sessionId,
          sanitizeRecord: buildCliSanitizeSessionRecord(),
          dumpDeps: buildCliLlmDumpDeps(),
        });
      }
    } catch (err) {
      buildCliLogger().error("Background merge rebuild failed", err);
    }
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Batch merge
// ────────────────────────────────────────────────────────────────────────────

function buildCliRunBatchMerge(storeDir: string): RunBatchMergeFn {
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
          dumpDeps: buildCliLlmDumpDeps(),
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

function buildCliRunFinalRootRefresh(): RunFinalRootRefreshFn {
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
        dumpDeps: buildCliLlmDumpDeps(),
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
  return async (projectSlug, overlayById) => {
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

function buildCliCodeRefQueueDeps(_storeDir: string): CodeRefQueueDeps {
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
          buildCliLogger().info(typeof msg === "string" ? msg : (msg.message ?? initialMessage));
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

    async rebuildProjectMerge(_storeDir: string, _projectSlug: string) {
      return undefined;
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// LLM dump deps
// ────────────────────────────────────────────────────────────────────────────

function buildCliLlmDumpDeps(): LlmDumpDeps {
  return {
    isDumpEnabled: () => false,
    resolveDumpRoots: () => [],
    logInfo: () => {},
    logWarn: () => {},
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
  progress?: ProgressReporter
): Promise<AnalyzeSessionDeps> {
  const storeDir =
    (configStore as { storeDir?: string }).storeDir ??
    path.join(os.homedir(), ".agent-mindmap-store");

  return {
    logger: buildCliLogger(),
    progress: progress ?? { report() {} },
    configStore,
    storeAccess: buildCliStoreAccess(storeDir),
    hostAccess: buildCliHostAccess(cwd),
    mindMapSink: buildCliMindMapSink(),
    codeRefDeps: buildCliCodeRefQueueDeps(storeDir),
    llmDumpDeps: buildCliLlmDumpDeps(),
    runSessionPipeline: buildCliRunSessionPipeline(),
    runBackgroundMerge: buildCliRunBackgroundMerge(storeDir),
    sanitizeSessionRecord: buildCliSanitizeSessionRecord(),

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
  progress?: ProgressReporter
): Promise<AnalyzeSessionDeps> {
  const deps = await buildCliAnalyzeSessionDeps(cwd, configStore, signal, progress);
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
  progress?: ProgressReporter
): Promise<AnalyzeProjectDeps> {
  const sessionDeps = await buildCliAnalyzeSessionDepsAsync(cwd, configStore, signal, progress);
  const storeDir =
    (configStore as { storeDir?: string }).storeDir ??
    path.join(os.homedir(), ".agent-mindmap-store");

  return {
    ...sessionDeps,
    prompter: (await import("../ui/prompter")).buildCliPrompter(),
    runBatchMerge: buildCliRunBatchMerge(storeDir),
    runFinalRootRefresh: buildCliRunFinalRootRefresh(),
    clearProjectCache: buildCliClearProjectCache(),
    resolveProjectRecords: buildCliResolveProjectRecords(storeDir),
    sanitizeSessionRecord: buildCliSanitizeSessionRecord(),
    readSnapshotManifest: buildCliReadSnapshotManifest(),
  };
}
