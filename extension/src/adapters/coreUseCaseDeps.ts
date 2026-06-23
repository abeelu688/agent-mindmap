/**
 * Extension adapter — builds core use-case deps from VS Code primitives.
 *
 * Each function constructs the port implementations that the core use cases
 * need, wiring them to the extension's VS Code-backed modules.
 */
import * as vscode from "vscode";
import { ensureStore } from "@agent-mindmap/core";
import { getActiveHost, getWorkspacePath, getWorkspaceSlug } from "../host";
import { getStore, getStoreForDir } from "../store/storeClient";
import { getStoreDir } from "../paths";
import { getProvider } from "../llm";
import { agentLog } from "../log";
import { mindMapLog } from "../webview/MindMapLog";
import type {
  Logger,
  Prompter,
  QuickPickItem,
  StoreAccess,
  HostAccess,
  AnalyzeSessionDeps,
  AnalyzeProjectDeps,
  RunSessionPipelineFn,
  RunBackgroundMergeFn,
  SanitizeSessionRecordFn,
  RunBatchMergeFn,
  RunFinalRootRefreshFn,
  ClearProjectCacheFn,
  ResolveProjectRecordsFn,
  ReadSnapshotManifestFn,
  RefreshMcpIndexFn,
  AgentHostId,
} from "@agent-mindmap/core";
import type { MindMapPanel } from "../webview/MindMapPanel";
import type { SessionRecord } from "../store/storeTypes";
import type {
  MindMapRoot,
  ProgressReporter,
  CodeRefQueueDeps,
  LlmDumpDeps,
} from "@agent-mindmap/core";

// ────────────────────────────────────────────────────────────────────────────
// Logger
// ────────────────────────────────────────────────────────────────────────────

export function buildLogger(): Logger {
  return {
    info(message: string, data?: Record<string, unknown>) {
      mindMapLog(message);
      if (data) {
        agentLog.info(message, data);
      }
    },
    warn(message: string, data?: Record<string, unknown>) {
      agentLog.warn(message, data);
    },
    error(message: string, err?: unknown, data?: Record<string, unknown>) {
      agentLog.error(message, err, data);
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Prompter
// ────────────────────────────────────────────────────────────────────────────

export function buildPrompter(): Prompter {
  return {
    async showQuickPick<T extends QuickPickItem>(
      items: T[],
      options?: { placeHolder?: string; canPickMany?: boolean; title?: string }
    ) {
      const vscodeItems = items.map((item) => ({
        ...item, // label + extra properties like hostId, cli, etc.
        description: item.description,
        detail: item.detail,
        picked: item.picked,
      }));

      if (options?.canPickMany) {
        const picked = await vscode.window.showQuickPick(
          vscodeItems as (vscode.QuickPickItem & T)[],
          {
            placeHolder: options?.placeHolder,
            canPickMany: true,
            title: options?.title,
          }
        );
        return picked ?? undefined;
      }

      const picked = await vscode.window.showQuickPick(
        vscodeItems as (vscode.QuickPickItem & T)[],
        {
          placeHolder: options?.placeHolder,
          title: options?.title,
        }
      );
      return (picked as T | undefined) ?? undefined;
    },

    async showInputBox(opts: { prompt?: string; value?: string; password?: boolean }) {
      return vscode.window.showInputBox({
        prompt: opts.prompt,
        value: opts.value,
        password: opts.password,
      });
    },

    async showWarningMessage(message: string, ...actions: string[]) {
      return vscode.window.showWarningMessage(message, ...actions);
    },

    async showInformationMessage(message: string, ...actions: string[]) {
      return vscode.window.showInformationMessage(message, ...actions);
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// StoreAccess
// ────────────────────────────────────────────────────────────────────────────

export function buildStoreAccess(): StoreAccess {
  return {
    async getStore() {
      return getStore();
    },
    async getStoreForDir(storeDir: string) {
      return getStoreForDir(storeDir);
    },
    async ensureStore(storeDir: string) {
      await ensureStore(storeDir);
    },
    getStoreDir() {
      return getStoreDir();
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// HostAccess
// ────────────────────────────────────────────────────────────────────────────

export function buildHostAccess(context?: vscode.ExtensionContext): HostAccess {
  return {
    async getActiveHost() {
      return getActiveHost(context);
    },
    getWorkspacePath() {
      return getWorkspacePath();
    },
    getWorkspaceSlug(host) {
      return getWorkspaceSlug(host);
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// AnalyzeSessionDeps builder
// ────────────────────────────────────────────────────────────────────────────

export function buildAnalyzeSessionDeps(
  context: vscode.ExtensionContext,
  panel: MindMapPanel,
  signal?: AbortSignal,
  progress?: ProgressReporter
): AnalyzeSessionDeps {
  return {
    logger: buildLogger(),
    progress: progress ?? { report() {} },
    configStore: buildConfigStore(),
    storeAccess: buildStoreAccess(),
    hostAccess: buildHostAccess(context),
    mindMapSink: buildMindMapSink(panel),
    codeRefDeps: buildCodeRefQueueDeps(panel),
    llmDumpDeps: buildLlmDumpDeps(),
    runSessionPipeline: buildRunSessionPipeline(),
    runBackgroundMerge: buildRunBackgroundMerge(),
    sanitizeSessionRecord: buildSanitizeSessionRecord(),
    getProvider: (opts) => getProvider(opts),
    showCliInstallGuide: async (hostId, opts) => {
      const { showCliInstallGuide } = await import("../llm/cliInstallGuideUi");
      await showCliInstallGuide(hostId as AgentHostId, opts);
    },
    clearPendingMindMapIfForSession: (projectSlug, sessionId) => {
      void import("../batch/batchStatus").then(({ clearPendingMindMapIfForSession }) => {
        clearPendingMindMapIfForSession(projectSlug, sessionId);
      });
    },
    signal,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// AnalyzeProjectDeps builder
// ────────────────────────────────────────────────────────────────────────────

export function buildAnalyzeProjectDeps(
  context: vscode.ExtensionContext,
  panel: MindMapPanel,
  signal?: AbortSignal,
  progress?: ProgressReporter
): AnalyzeProjectDeps {
  const sessionDeps = buildAnalyzeSessionDeps(context, panel, signal, progress);
  return {
    ...sessionDeps,
    prompter: buildPrompter(),
    runBatchMerge: buildRunBatchMerge(),
    runFinalRootRefresh: buildRunFinalRootRefresh(),
    clearProjectCache: buildClearProjectCache(),
    resolveProjectRecords: buildResolveProjectRecords(),
    sanitizeSessionRecord: buildSanitizeSessionRecord(),
    readSnapshotManifest: buildReadSnapshotManifest(),
    refreshMcpIndex: buildRefreshMcpIndex(),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helper builders
// ────────────────────────────────────────────────────────────────────────────

function buildConfigStore() {
  return {
    get<T>(key: string): T | undefined {
      const config = vscode.workspace.getConfiguration("agentMindmap");
      // Support dot-notation keys like "llm.provider" → config.get("llm", {}).provider
      const parts = key.split(".");
      if (parts.length === 1) {
        return config.get<T>(key);
      }
      // For nested keys, use the full key as VS Code supports dot notation
      return config.get<T>(key);
    },
    set(key: string, value: unknown): void {
      const config = vscode.workspace.getConfiguration("agentMindmap");
      config.update(key, value, vscode.ConfigurationTarget.Global);
    },
  };
}

function buildMindMapSink(panel: MindMapPanel) {
  return {
    refreshMindMap(_storeDir: string, _sessionId: string, mindMap: MindMapRoot) {
      panel.setMindMapData(mindMap);
    },
    showInfo(message: string) {
      void import("../notify").then(({ notifyInfo }) => {
        notifyInfo(message);
      });
    },
  };
}

function buildCodeRefQueueDeps(panel: MindMapPanel): CodeRefQueueDeps {
  // Re-use the existing adapter
  return extensionCodeRefQueueDeps(panel);
}

function buildLlmDumpDeps(): LlmDumpDeps {
  return extensionLlmDumpDeps();
}

function buildRunSessionPipeline(): RunSessionPipelineFn {
  return async (opts, provider, signal, progress) => {
    const { runSessionPipeline } = await import("../pipeline/sessionPipeline");
    // Adapt ProgressReporter → MindMapProgress if needed
    const mindMapProgress = progress
      ? {
          report(update: string | { message?: string; increment?: number }) {
            progress.report(update);
          },
        }
      : undefined;
    return runSessionPipeline(opts, provider, signal, mindMapProgress);
  };
}

function buildRunBackgroundMerge(): RunBackgroundMergeFn {
  return async (opts) => {
    try {
      const { buildDeterministicMergeRecordAsync } = await import("../store/mergeDeterministic");
      const { resolveAndBuildConceptMergeAsync } = await import("../store/conceptMergeContext");
      const { runBatchSnapshotPipeline, refreshSnapshotForSession } =
        await import("../pipeline/snapshotHierarchy");
      const { readSnapshotManifest } = await import("@agent-mindmap/core");
      const config = vscode.workspace.getConfiguration("agentMindmap");

      const storeDir = opts.storeDir;
      const store = await getStoreForDir(storeDir);
      const all = await store.listAllRecords();

      const merge = await buildDeterministicMergeRecordAsync(all);
      await store.writeDeterministicMerge(merge);

      const provider = getProvider(opts.settings.llm);
      const incrementalOntology =
        (config.get<boolean>("library.batchRefineOntology", true) ?? true) &&
        (config.get<boolean>("library.incrementalOntologyOnSessionAdd", true) ?? true);

      const conceptLlm = {
        providerId: provider.id,
        model: opts.settings.llm.model,
        hostId: opts.host.id,
        outputLanguage: undefined,
      };

      const projectSlug = opts.projectSlug;
      const projectRecords = all.filter((r: SessionRecord) => r.meta.projectSlug === projectSlug);
      const records = projectRecords.length ? projectRecords : all;

      const concept = incrementalOntology
        ? await (async () => {
            const manifest = await readSnapshotManifest(storeDir, projectSlug);
            if (manifest?.sessionToLeafId[opts.record.meta.sessionId]) {
              return await refreshSnapshotForSession({
                storeDir,
                projectSlug,
                allRecords: records,
                provider,
                providerId: provider.id,
                model: opts.settings.llm.model,
                hostId: opts.host.id,
                outputLanguage: undefined,
                signal: opts.signal,
                sessionId: opts.record.meta.sessionId,
              });
            }
            const batchNo = (manifest?.nodes.filter((n: any) => n.level === 1).length ?? 0) + 1; // eslint-disable-line @typescript-eslint/no-explicit-any
            return await runBatchSnapshotPipeline({
              storeDir,
              projectSlug,
              allRecords: records,
              batchRecords: [opts.record],
              batchNo,
              provider,
              providerId: provider.id,
              model: opts.settings.llm.model,
              hostId: opts.host.id,
              outputLanguage: undefined,
              signal: opts.signal,
            });
          })()
        : await resolveAndBuildConceptMergeAsync(storeDir, all, {}, conceptLlm);

      await store.writeConceptTrieMerge(concept);
    } catch (err) {
      agentLog.error("Background merge rebuild failed", err);
    }
  };
}

function buildSanitizeSessionRecord(): SanitizeSessionRecordFn {
  return async (record) => {
    const { sanitizeSessionRecord } = await import("../store/sanitizeRecords");
    return sanitizeSessionRecord(record);
  };
}

function buildRunBatchMerge(): RunBatchMergeFn {
  return async (opts) => {
    const { buildProjectConceptMergeForBatch } = await import("../batch/conceptMerge");
    const { refreshSnapshotsForFreshSessions } = await import("../batch/conceptMerge");
    const { runBatchSnapshotPipeline } = await import("../pipeline/snapshotHierarchy");
    const { refreshSnapshotForSession } = await import("../pipeline/snapshotHierarchy");
    const { getStore } = await import("../store/storeClient");

    if (opts.forceRefresh) {
      return buildProjectConceptMergeForBatch(opts.storeDir, opts.allRecords, opts.batchRecords, {
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
      });
    }

    if (opts.leafAction === "reuse") {
      const store = await getStore();
      const existingMerge = await store.readConceptTrieMerge();
      return existingMerge ?? undefined;
    }

    if (opts.leafAction === "rebuild") {
      if (opts.freshlyAnalyzedSessionIds.length > 0) {
        return refreshSnapshotsForFreshSessions(
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
      const representativeSid = opts.batchRecords[0]?.meta.sessionId;
      if (representativeSid) {
        return refreshSnapshotForSession(
          {
            storeDir: opts.storeDir,
            projectSlug: opts.projectSlug,
            allRecords: opts.allRecords,
            provider: opts.provider,
            providerId: opts.conceptLlm.providerId,
            model: opts.conceptLlm.model,
            hostId: opts.conceptLlm.hostId,
            outputLanguage: opts.conceptLlm.outputLanguage,
            llmTimeoutMs: opts.conceptLlm.timeoutMs,
            signal: opts.signal,
            forceReattach: true,
            sessionId: representativeSid,
          },
          opts.progress
        );
      }
      return undefined;
    }

    if (opts.leafAction === "new") {
      return runBatchSnapshotPipeline(
        {
          storeDir: opts.storeDir,
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
        },
        opts.progress
      );
    }

    // Legacy mode
    if (opts.freshlyAnalyzedSessionIds.length === 0) {
      const store = await getStore();
      const existingMerge = await store.readConceptTrieMerge();
      return existingMerge ?? undefined;
    }

    return refreshSnapshotsForFreshSessions(
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

function buildRunFinalRootRefresh(): RunFinalRootRefreshFn {
  return async (opts) => {
    const { runFinalRootRefresh } = await import("../pipeline/snapshotHierarchy");
    return runFinalRootRefresh(
      {
        storeDir: opts.storeDir,
        projectSlug: opts.projectSlug,
        allRecords: opts.allRecords,
        provider: opts.provider,
        providerId: opts.conceptLlm.providerId,
        model: opts.conceptLlm.model,
        hostId: opts.conceptLlm.hostId,
        signal: opts.signal,
      },
      opts.progress
    );
  };
}

function buildClearProjectCache(): ClearProjectCacheFn {
  return async (storeDir, projectSlug) => {
    const { clearProjectAnalysisCache } = await import("../store/clearProjectAnalysisCache");
    await clearProjectAnalysisCache(storeDir, projectSlug);
  };
}

function buildResolveProjectRecords(): ResolveProjectRecordsFn {
  return async (storeDir, projectSlug, overlayById) => {
    const { resolveProjectRecordsForMerge } = await import("../batch/conceptMerge");
    return resolveProjectRecordsForMerge(storeDir, projectSlug, overlayById);
  };
}

function buildReadSnapshotManifest(): ReadSnapshotManifestFn {
  return async (storeDir, projectSlug) => {
    const { readSnapshotManifest } = await import("@agent-mindmap/core");
    return readSnapshotManifest(storeDir, projectSlug);
  };
}

function buildRefreshMcpIndex(): RefreshMcpIndexFn {
  return async (projectSlug) => {
    const { refreshMcpIndexForProject } = await import("../mcp/mcpConfig");
    await refreshMcpIndexForProject(projectSlug);
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Inline adapters (imported by reference from other adapter modules)
// ────────────────────────────────────────────────────────────────────────────

function extensionCodeRefQueueDeps(panel: MindMapPanel): CodeRefQueueDeps {
  const { extensionCodeRefQueueDeps } = require("../codeRefQueueAdapter") as {
    extensionCodeRefQueueDeps: (panel: MindMapPanel) => CodeRefQueueDeps;
  }; // eslint-disable-line @typescript-eslint/no-require-imports
  return extensionCodeRefQueueDeps(panel);
}

function extensionLlmDumpDeps(): LlmDumpDeps {
  const { extensionLlmDumpDeps } = require("../llm/llmIoDumpAdapter") as {
    extensionLlmDumpDeps: () => LlmDumpDeps;
  }; // eslint-disable-line @typescript-eslint/no-require-imports
  return extensionLlmDumpDeps();
}
