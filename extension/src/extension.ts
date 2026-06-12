import * as vscode from "vscode";
import {
  drainPendingJump,
  handleNodeClicked,
  consumeTranscriptDocUriIfAutoReveal,
} from "./jumpToOrigin";
import { loadGlassResumableIds, clearComposerTitleCache } from "./transcript/composerTitles";
import { closeStateDb } from "./transcript/cursorStateDb";
import { mindMapLog } from "./webview/MindMapLog";
import { agentLog, initLog } from "./log";
import { notify, notifyInfo, notifyWarning, notifyError } from "./notify";
import { isCancellationError } from "./errors";
import { MindMapPanel } from "./webview/MindMapPanel";
import { MindMapHost } from "./webview/MindMapHost";
import type { BatchStatus } from "./webview/MindMapHost";
import {
  loadLatestSession,
  loadSession,
  pickSession,
  runProjectSessionBatches,
  type AnalyzeProjectBatchInfo,
  type AnalyzeProjectResult,
  type LoadDeps,
  type LoadedSession,
} from "./sessionLoader";
import {
  getActiveHost,
  getWorkspacePath,
  getWorkspaceSlug,
  resetHostCache,
  resolveHostId,
  WORKSPACE_HOST_KEY,
  getHostById,
} from "./host";
import { getStoreDir } from "./paths";
import { showCliInstallGuide } from "./llm/cliInstallGuide";
import { uiTranslate, format, t } from "./l10n/uiTranslate";
import type { LlmProviderId } from "./llm/types";
import {
  ensureStore,
  listRecords,
  readRecord,
} from "./store/sessionStore";
import {
  buildConceptMergeForRecords,
  type ConceptMergeLlmOpts,
} from "./store/conceptMergeContext";
import type { ProjectMergeMode } from "./pipeline/deltaMergePipeline";
import {
  runBatchSnapshotPipeline,
  runFinalRootRefresh,
} from "./pipeline/snapshotHierarchy";
import {
  deleteSnapshotHierarchy,
  filterRealSessionRecords,
} from "./store/mergeSnapshot";
import { sanitizeSessionRecord } from "./store/sanitizeRecords";
import { getProvider } from "./llm";
import { fetchModelList, clearModelCache } from "./llm/modelList";
import { logLlmDumpLocationsOnce } from "./llm/llmIoDump";
import { agentDebugLog } from "./debugLog";
import {
  LlmProviderError,
  type LlmProvider,
  type LlmProviderOptions,
} from "./llm/types";
import type { SessionRecord } from "./store/storeTypes";
import { exportMindMapPackage } from "./export/exportPackage";
import { openMindMapPackage } from "./export/openMindMapPackage";
import {
  createProgressReporter,
  type MindMapProgress,
  type MindMapProgressUpdate,
} from "./progress";
import { shouldAutoApplyBatchUpdates } from "./batchMergeApplyMode";
function progressMessage(update: MindMapProgressUpdate): string {
  return typeof update === "string" ? update : (update.message ?? "");
}

let activeSession: LoadedSession | undefined;
let extensionContext: vscode.ExtensionContext;

let pendingMergeMindMap: import("./transcript/types").MindMapRoot | undefined;
let pendingMergeBatchNo: number | undefined;
let lastBatchStatus: BatchStatus | undefined;

function applyPendingMergeToPanel(panel: MindMapPanel): boolean {
  if (!pendingMergeMindMap) {
    return false;
  }
  panel.setMindMapData(pendingMergeMindMap);
  pendingMergeMindMap = undefined;
  pendingMergeBatchNo = undefined;
  if (lastBatchStatus) {
    lastBatchStatus = { ...lastBatchStatus, pendingUpdateBatchNo: undefined };
    panel.setBatchStatus(lastBatchStatus);
  }
  return true;
}

function progressTitle(): string {
  return t(
    "ui.progress.analyzingSession.title",
    "Agent Mind Map: Analyzing session…"
  );
}

async function withCancellableProgress<T>(
  run: (ctx: {
    signal: AbortSignal;
    progress: MindMapProgress;
  }) => Promise<T>,
  title: string = progressTitle(),
  panel?: MindMapPanel,
  options?: { forwardToWebviewLoading?: boolean }
): Promise<T | undefined> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (vscodeProgress, token) => {
      const controller = new AbortController();
      const sub = token.onCancellationRequested(() => controller.abort());
      const panelRef = panel ?? MindMapPanel.getCurrent();
      const baseReporter = createProgressReporter(vscodeProgress);
      const forwardToWebviewLoading = options?.forwardToWebviewLoading ?? true;
      const progress: MindMapProgress = {
        report(update: MindMapProgressUpdate) {
          baseReporter.report(update);
          const message = progressMessage(update);
          if (forwardToWebviewLoading && message) {
            panelRef?.setLoading(true, message);
          }
        },
      };
      try {
        return await run({ signal: controller.signal, progress });
      } catch (err) {
        if (controller.signal.aborted) {
          return undefined;
        }
        throw err;
      } finally {
        sub.dispose();
      }
    }
  );
}

function attachTranscriptWatch(
  panel: MindMapPanel,
  session: LoadedSession["session"]
): void {
  panel.watchTranscript(session.filePath, async () => {
    if (!activeSession) {
      return;
    }
    const currentPanel = MindMapPanel.getCurrent();
    currentPanel?.setLoading(
      true,
      t(
        "ui.loading.transcriptUpdatedReanalyzing",
        "Transcript updated, re-analyzing…"
      )
    );
    try {
      const refreshed = await withCancellableProgress(
        ({ signal, progress }) =>
          loadSession(
            activeSession!.session,
            { context: extensionContext, signal, progress },
            { forceRefresh: true }
          ),
        progressTitle(),
        currentPanel
      );
      if (refreshed) {
        activeSession = refreshed;
        MindMapPanel.getCurrent()?.setMindMapData(refreshed.mindMap);
      }
    } finally {
      MindMapPanel.getCurrent()?.setLoading(false);
    }
  });
}

async function loadAndShowSession(
  loadFn: (deps: LoadDeps) => Promise<LoadedSession | undefined>,
  title: string = progressTitle()
): Promise<void> {
  const panel = createOrShowMindMap();
  panel.setLoading(true, t("ui.loading.preparing", "Understanding conversation…"));
  try {
    const loaded = await withCancellableProgress(
      ({ signal, progress }) =>
        loadFn({ context: extensionContext, signal, progress }),
      title,
      panel
    );
    if (loaded) {
      activeSession = loaded;
      panel.setMindMapData(loaded.mindMap);
      attachTranscriptWatch(panel, loaded.session);
    }
  } finally {
    panel.setLoading(false);
  }
}

function createOrShowMindMap(): MindMapPanel {
  return MindMapPanel.createOrShow(extensionContext.extensionUri);
}

function resolveLlmProviderId(
  setting: string,
  hostDefault: LlmProviderId
): LlmProviderId {
  if (setting === "auto") {
    return hostDefault;
  }
  if (setting === "cursor-cli" || setting === "claude-cli") {
    return setting;
  }
  return hostDefault;
}

async function readLlmOptions(
  context: vscode.ExtensionContext
): Promise<LlmProviderOptions> {
  const host = await getActiveHost(context);
  const config = vscode.workspace.getConfiguration("agentMindmap");
  const providerSetting = config.get<string>("llm.provider", "auto");
  return {
    provider: resolveLlmProviderId(providerSetting, host.defaultLlmProvider),
    cliPath: config.get<string>("llm.cliPath", "").trim(),
    model: config.get<string>("llm.model", "").trim(),
    timeoutMs: Math.max(
      1000,
      config.get<number>("llm.timeoutMs", 300000) ?? 300000
    ),
    maxAttempts: Math.max(
      1,
      Math.min(10, config.get<number>("llm.maxAttempts", 3) ?? 3)
    ),
    retryBackoffMs: Math.max(
      0,
      Math.min(30000, config.get<number>("llm.retryBackoffMs", 1000) ?? 1000)
    ),
    maxTopics: Math.max(2, config.get<number>("merge.llm.maxTopics", 8) ?? 8),
    maxItemsPerTopic: Math.max(
      1,
      config.get<number>("merge.llm.maxItemsPerTopic", 6) ?? 6
    ),
    hostId: host.id,
  };
}

const MODEL_SELECTED_KEY = "agentMindmap.modelSelected";

async function ensureModelSelected(): Promise<boolean> {
  const selected = extensionContext.globalState.get<boolean>(MODEL_SELECTED_KEY);
  if (selected) {
    return true;
  }
  await vscode.commands.executeCommand("agent-mindmap.selectModel");
  const nowSelected = extensionContext.globalState.get<boolean>(MODEL_SELECTED_KEY);
  return !!nowSelected;
}

async function markModelSelected(): Promise<void> {
  await extensionContext.globalState.update(MODEL_SELECTED_KEY, true);
}

async function commandOpenLatest(): Promise<void> {
  if (!(await ensureModelSelected())) {
    return;
  }
  await loadAndShowSession((deps) => loadLatestSession(deps));
}

async function commandPickSession(): Promise<void> {
  if (!(await ensureModelSelected())) {
    return;
  }
  const panel = createOrShowMindMap();
  panel.setLoading(true, t("ui.loading.preparing", "Understanding conversation…"));
  try {
    const loaded = await withCancellableProgress(
      ({ signal, progress }) =>
        pickSession({ context: extensionContext, signal, progress }),
      progressTitle(),
      panel
    );
    if (loaded) {
      activeSession = loaded;
      panel.setMindMapData(loaded.mindMap);
      attachTranscriptWatch(panel, loaded.session);
    }
  } finally {
    panel.setLoading(false);
  }
}

async function commandDownloadPackage(): Promise<void> {
  const panel = MindMapPanel.getCurrent();
  const mindMap = panel?.getMindMapData();
  if (!mindMap) {
    notifyWarning(
      t("ui.warning.openMindMapFirst", "Agent Mind Map: Open a mind map first.")
    );
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: t("ui.download.pickFolderLabel", "Select download folder"),
  });
  if (!picked?.length) {
    return;
  }

  const outDir = picked[0]!.fsPath;

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t("ui.download.exporting.title", "Agent Mind Map: Exporting…"),
        cancellable: false,
      },
      async () =>
        exportMindMapPackage({
          outDir,
          mindMap,
          extensionUri: extensionContext.extensionUri,
        })
    );

    const openBrowser = t(
      "ui.download.choice.openInBrowser",
      "Open in browser"
    );
    const showFolder = t(
      "ui.download.choice.showInExplorer",
      "Show in file manager"
    );
    const choice = await vscode.window.showInformationMessage(
      t(
        "ui.download.exported.summary",
        "Exported mind map and {0} transcript(s) to the selected folder.",
        result.transcriptCount
      ),
      openBrowser,
      showFolder
    );
    if (choice === openBrowser) {
      await openMindMapPackage(result.outDir);
    } else if (choice === showFolder) {
      await vscode.env.openExternal(vscode.Uri.file(result.outDir));
    }
  } catch (err) {
    notifyError(
      t(
        "ui.download.exportFailed",
        "Agent Mind Map: Export failed: {0}",
        err instanceof Error ? err.message : String(err)
      ),
      err
    );
  }
}

function toConceptMergeLlmOpts(
  llmOpts: LlmProviderOptions,
  providerId: string
): ConceptMergeLlmOpts {
  return {
    model: llmOpts.model,
    hostId: llmOpts.hostId,
    providerId,
    timeoutMs: llmOpts.timeoutMs,
  };
}

async function buildProjectConceptMergeFromCache(
  storeDir: string,
  records: SessionRecord[],
  llmOpts: ConceptMergeLlmOpts,
  projectSlug: string | undefined,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress,
  forceReattach = false
): Promise<import("./store/storeTypes").MergeRecord> {
  const sanitized = await Promise.all(
    records.map((r) => sanitizeSessionRecord(r))
  );
  const { merge } = await buildConceptMergeForRecords(sanitized, {
    storeDir,
    projectSlug,
    llm: llmOpts,
    provider,
    signal,
    progress,
    forceReattach,
    ontologyFlags: forceReattach ? { forceRefine: true } : undefined,
  });
  return merge;
}

async function buildProjectConceptMergeForBatch(
  storeDir: string,
  allRecords: SessionRecord[],
  batchRecords: SessionRecord[],
  opts: {
    projectSlug: string;
    conceptLlm: ConceptMergeLlmOpts;
    provider: LlmProvider;
    signal: AbortSignal;
    progress?: MindMapProgress;
    batchRefineOntology: boolean;
    batchNo: number;
    processed?: number;
    total?: number;
    forceReattach?: boolean;
    mergeMode: ProjectMergeMode;
    mergeFullReconcileEvery: number;
    forceRefresh?: boolean;
  }
): Promise<import("./store/storeTypes").MergeRecord> {
  const sanitizedAll = await Promise.all(
    filterRealSessionRecords(allRecords).map((r) => sanitizeSessionRecord(r))
  );
  const sanitizedBatch = await Promise.all(
    filterRealSessionRecords(batchRecords).map((r) => sanitizeSessionRecord(r))
  );
  if (!opts.batchRefineOntology) {
    return buildProjectConceptMergeFromCache(
      storeDir,
      sanitizedAll,
      opts.conceptLlm,
      opts.projectSlug,
      opts.provider,
      opts.signal,
      opts.progress,
      false
    );
  }
  if (opts.processed !== undefined && opts.total !== undefined) {
    opts.progress?.report(
      t(
        "ui.batch.progress.refineOntology",
        "Refining concept synonyms (batch {0}, {1}/{2} sessions)…",
        opts.batchNo,
        opts.processed,
        opts.total
      )
    );
  } else {
    opts.progress?.report(
      t(
        "ui.ontology.refine.heartbeat",
        "Refining concept segment equivalences…"
      )
    );
  }
  return runBatchSnapshotPipeline(
    {
      storeDir,
      projectSlug: opts.projectSlug,
      allRecords: sanitizedAll,
      batchRecords: sanitizedBatch,
      batchNo: opts.batchNo,
      provider: opts.provider,
      providerId: opts.conceptLlm.providerId,
      model: opts.conceptLlm.model,
      hostId: opts.conceptLlm.hostId,
      promptLanguage: opts.conceptLlm.promptLanguage,
      llmTimeoutMs: opts.conceptLlm.timeoutMs,
      signal: opts.signal,
      forceReattach: opts.forceReattach ?? true,
    },
    opts.progress
  );
}

function formatAnalyzeProjectSummary(result: AnalyzeProjectResult): string {
  const newlyAnalyzed = result.analyzed - result.skippedFresh;
  let msg = t(
    "ui.batch.summary",
    "Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached.",
    result.total,
    newlyAnalyzed,
    result.skippedFresh
  );
  if (result.failed > 0) {
    const labels = result.failures
      .slice(0, 3)
      .map((f) => f.label)
      .join("、");
    const more =
      result.failures.length > 3
        ? ` 等 ${result.failures.length} 条`
        : "";
    msg = t(
      "ui.batch.summary.withFailures",
      "Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached, {3} failed ({4}{5}).",
      result.total,
      newlyAnalyzed,
      result.skippedFresh,
      result.failed,
      labels,
      more
    );
  }
  return msg;
}

async function commandAnalyzeAndMergeCurrentProject(): Promise<void> {
  if (!(await ensureModelSelected())) {
    return;
  }
  const mode = await vscode.window.showQuickPick(
    [
      {
        label: t(
          "ui.batch.mode.skipCached.label",
          "Skip cached sessions"
        ),
        description: t(
          "ui.batch.mode.skipCached.desc",
          "Only analyze transcripts missing or stale in the library"
        ),
        forceRefresh: false,
      },
      {
        label: t("ui.batch.mode.force.label", "Force re-analyze all"),
        description: t(
          "ui.batch.mode.force.desc",
          "Ignore library cache and call the LLM for every session"
        ),
        forceRefresh: true,
      },
    ],
    { placeHolder: t("ui.batch.pickMode.placeholder", "Batch analyze agent sessions in current project") }
  );
  if (!mode) {
    return;
  }

  const host = await getActiveHost(extensionContext);
  const slug = getWorkspaceSlug(host);
  if (!slug) {
    notifyWarning(
      t(
        "ui.warning.openWorkspaceFolderFirst",
        "Agent Mind Map: Open a workspace folder first."
      )
    );
    return;
  }

  const panel = createOrShowMindMap();
  panel.setLoading(true, t("ui.loading.preparing", "Understanding conversation…"));
  try {
    const completed = await withCancellableProgress(
      async ({ signal, progress }) => {
        progress.report(
          t("ui.batch.progress.scanSessions", "Scanning agent sessions for current project…")
        );
        const workspacePath = getWorkspacePath();
        if (!workspacePath) {
          notifyWarning(
            t(
              "ui.warning.openWorkspaceFolderFirst",
              "Agent Mind Map: Open a workspace folder first."
            )
          );
          return undefined;
        }
        const scanDir = host.getSessionsScanDir(workspacePath);
        if (!scanDir) {
          notifyWarning(
            t(
              "ui.warning.openWorkspaceFolderFirst",
              "Agent Mind Map: Open a workspace folder first."
            )
          );
          return undefined;
        }
        const sessions = await host.listSessions(scanDir, {
          projectSlug: slug,
          projectPath: workspacePath,
        });

        if (sessions.length === 0) {
          notifyInfo(
            t(
              "ui.batch.emptyOnDisk",
              "Agent Mind Map: No agent transcripts found on disk for current project ({0}).",
              slug
            )
          );
          return undefined;
        }

        const storeDir = getStoreDir();
        await ensureStore(storeDir);
        if (mode.forceRefresh) {
          await deleteSnapshotHierarchy(storeDir, slug);
        }
        const projectRecordsById = new Map<string, SessionRecord>();

        pendingMergeMindMap = undefined;
        pendingMergeBatchNo = undefined;
        lastBatchStatus = {
          total: sessions.length,
          processed: 0,
          analyzed: 0,
          cached: 0,
          failed: 0,
          batchNo: 0,
          running: true,
        };
        panel.setBatchStatus(lastBatchStatus);

        for (const session of sessions) {
          const rec = await readRecord(storeDir, slug, session.id);
          if (!rec) {
            continue;
          }
          const sanitized = await sanitizeSessionRecord(rec);
          projectRecordsById.set(session.id, sanitized);
        }

        const autoApplyUpdates = shouldAutoApplyBatchUpdates({
          sessionCount: sessions.length,
          libraryRecordCount: projectRecordsById.size,
          panelHasMindMap: Boolean(panel.getMindMapData()),
        });

        const llmOpts = await readLlmOptions(extensionContext);
        const provider = getProvider(llmOpts);
        const conceptLlm = toConceptMergeLlmOpts(llmOpts, provider.id);
        const batchRefineOntology =
          vscode.workspace
            .getConfiguration("agentMindmap")
            .get<boolean>("library.batchRefineOntology", true) ?? true;
        const batchFinalRefine =
          vscode.workspace
            .getConfiguration("agentMindmap")
            .get<boolean>("library.batchFinalRefine", true) ?? true;
        const mergeMode =
          (vscode.workspace
            .getConfiguration("agentMindmap")
            .get<string>("library.mergeMode", "delta") as ProjectMergeMode) ||
          "delta";
        const mergeFullReconcileEvery =
          vscode.workspace
            .getConfiguration("agentMindmap")
            .get<number>("library.mergeFullReconcileEvery", 4) ?? 4;
        let batchOntologyFailed = false;

        const deps: LoadDeps = { context: extensionContext, signal, progress };
        const result = await runProjectSessionBatches(
          sessions,
          slug,
          host,
          deps,
          {
            forceRefresh: mode.forceRefresh,
            skipAutoMerge: true,
            batchSize: 5,
            onBatchDone: async (info: AnalyzeProjectBatchInfo) => {
              if (signal.aborted) {
                return;
              }

              const cached = info.skippedFresh;
              mindMapLog(`[onBatchDone] batchNo=${info.batchNo} processed=${info.processed}/${info.total} analyzed=${info.analyzed} skippedFresh=${info.skippedFresh} failed=${info.failed} batchSessionIds=${info.batchSessionIds.join(",")}`) // TODO: migrate to agentLog.info

              progress.report(
                t(
                  "ui.batch.progress.mergingConceptMap",
                  "Merging concept mind map ({0}/{1} sessions): synonyms + root reparent…",
                  info.processed,
                  info.total
                )
              );
              for (const sessionId of info.batchSessionIds) {
                if (signal.aborted) {
                  return;
                }
                const rec = await readRecord(storeDir, slug, sessionId);
                if (!rec) {
                  continue;
                }
                const sanitized = await sanitizeSessionRecord(rec);
                projectRecordsById.set(sessionId, sanitized);
              }
              if (signal.aborted) {
                return;
              }
              const batchRecords: SessionRecord[] = [];
              for (const sessionId of info.batchSessionIds) {
                const rec = projectRecordsById.get(sessionId);
                if (rec) {
                  batchRecords.push(rec);
                }
              }
              let conceptMerge;
              try {
                conceptMerge = await buildProjectConceptMergeForBatch(
                  storeDir,
                  [...projectRecordsById.values()],
                  batchRecords,
                  {
                    projectSlug: slug,
                    conceptLlm,
                    provider,
                    signal,
                    progress,
                    batchRefineOntology,
                    batchNo: info.batchNo,
                    processed: info.processed,
                    total: info.total,
                    forceReattach: true,
                    mergeMode,
                    mergeFullReconcileEvery,
                    forceRefresh: mode.forceRefresh,
                  }
                );
              } catch (err) {
                if (signal.aborted) {
                  return;
                }
                batchOntologyFailed = true;
                const detail =
                  err instanceof Error ? err.message : String(err);
                agentLog.error(
                  `Batch ${info.batchNo} concept merge failed`,
                  err
                );
                notifyError(
                  t(
                    "ui.batch.mergeFailed",
                    "Agent Mind Map: Batch {0} concept merge failed: {1}",
                    info.batchNo,
                    detail
                  ),
                  err
                );
                return;
              }

              if (autoApplyUpdates) {
                pendingMergeMindMap = undefined;
                pendingMergeBatchNo = undefined;
                panel.setMindMapData(conceptMerge.mindMap);
                lastBatchStatus = {
                  total: info.total,
                  processed: info.processed,
                  analyzed: info.analyzed,
                  cached,
                  failed: info.failed,
                  batchNo: info.batchNo,
                  running: true,
                };
              } else {
                pendingMergeMindMap = conceptMerge.mindMap;
                pendingMergeBatchNo = info.batchNo;
                lastBatchStatus = {
                  total: info.total,
                  processed: info.processed,
                  analyzed: info.analyzed,
                  cached,
                  failed: info.failed,
                  batchNo: info.batchNo,
                  running: true,
                  pendingUpdateBatchNo: pendingMergeBatchNo,
                };
              }
              panel.setBatchStatus(lastBatchStatus);

              if (!autoApplyUpdates) {
                if (!panel.getMindMapData()) {
                  applyPendingMergeToPanel(panel);
                } else {
                  notifyInfo(
                    t(
                      "ui.batch.pendingRefresh",
                      "Agent Mind Map: Batch {0} merge is ready ({1}/{2} sessions). Click Refresh in the mind map to update.",
                      info.batchNo,
                      info.processed,
                      info.total
                    )
                  );
                }
              }
            },
          }
        );

        if (projectRecordsById.size === 0) {
          const allNewTurnFallbacks =
            result.turnFallbacks > 0 &&
            result.turnFallbacks >= result.analyzed - result.skippedFresh;
          const allCliMissing =
            result.cliMissingCount > 0 &&
            result.cliMissingCount >= result.turnFallbacks;
          const allBadJson =
            result.jsonParseFailures > 0 &&
            result.jsonParseFailures >= result.turnFallbacks;
          if (allNewTurnFallbacks && allCliMissing) {
            await showCliInstallGuide(host.id, { modal: true });
          } else if (allNewTurnFallbacks && allBadJson) {
            notifyWarning(
              uiTranslate(
                "ui.library.empty.llmBadJson",
                "Agent Mind Map: cursor-agent returned invalid JSON for every session (not saved to the library). Check Output → Agent Mind Map logs, retry batch analyze, or increase agentMindmap.llm.maxAttempts."
              )
            );
          } else if (allNewTurnFallbacks) {
            notifyWarning(
              uiTranslate(
                "ui.library.empty.llmTurnFallbackGeneric",
                "Agent Mind Map: LLM summarization failed for every session. Turn-only views are not saved to the library, so Concept Mind Map stays empty."
              )
            );
          } else {
            notifyInfo(
              t(
                "ui.library.empty.noRecordsAfterAnalyze",
                "Agent Mind Map: After analysis, the library still has no usable records for current project ({0}).",
                slug
              ) +
                (result.failed > 0
                  ? " " +
                    t(
                      "ui.batch.failedSuffix",
                      "{0} session(s) failed.",
                      result.failed
                    )
                  : "")
            );
          }
          return undefined;
        }

        if (
          projectRecordsById.size > 0 &&
          !signal.aborted &&
          batchRefineOntology &&
          batchFinalRefine
        ) {
          const batchRecords = [...projectRecordsById.values()];
          progress.report(
            t(
              "ui.batch.progress.finalRefine",
              "Final concept synonym refine…"
            )
          );
          try {
            const finalMerge = await runFinalRootRefresh(
              {
                storeDir,
                projectSlug: slug,
                allRecords: batchRecords,
                provider,
                providerId: conceptLlm.providerId,
                model: conceptLlm.model,
                hostId: conceptLlm.hostId,
                signal,
              },
              progress
            );
            if (autoApplyUpdates) {
              panel.setMindMapData(finalMerge.mindMap);
            } else {
              pendingMergeMindMap = finalMerge.mindMap;
              pendingMergeBatchNo = Math.max(1, Math.ceil(result.total / 5));
            }
          } catch (err) {
            batchOntologyFailed = true;
            const detail = err instanceof Error ? err.message : String(err);
            agentLog.error("Final root refresh failed", err);
            notifyError(
              t(
                "ui.batch.finalRefineFailed",
                "Agent Mind Map: Final concept map refresh failed: {0}",
                detail
              ),
              err
            );
          }
        }

        notifyInfo(formatAnalyzeProjectSummary(result));
        if (projectRecordsById.size > 0 && batchOntologyFailed && batchRefineOntology) {
          notifyInfo(
            t(
              "ui.batch.noOntologyEquivalences",
              "Agent Mind Map: Concept synonym rules were not generated. Run Analyze All Sessions (Current Project) again for full merge."
            )
          );
        } else if (projectRecordsById.size > 0 && !batchRefineOntology) {
          notifyInfo(
            t(
              "ui.batch.noOntologyEquivalencesDisabled",
              "Agent Mind Map: Batch merge used mechanical path rules only. Enable agentMindmap.library.batchRefineOntology and run Analyze All Sessions again to refine synonyms."
            )
          );
        }

        lastBatchStatus = {
          total: result.total,
          processed: result.total,
          analyzed: result.analyzed,
          cached: result.skippedFresh,
          failed: result.failed,
          batchNo: Math.max(1, Math.ceil(result.total / 5)),
          running: false,
          ...(autoApplyUpdates
            ? {}
            : { pendingUpdateBatchNo: pendingMergeBatchNo }),
        };
        panel.setBatchStatus(lastBatchStatus);

        return undefined;
      },
      t("ui.batch.progress.title", "Agent Mind Map: Batch analyze & merge…"),
      panel,
      { forwardToWebviewLoading: false }
    );
    if (!completed && lastBatchStatus?.running) {
      lastBatchStatus = { ...lastBatchStatus, running: false };
      panel.setBatchStatus(lastBatchStatus);
    }
    panel.setTitle(`Concept Mind Map · ${slug}`);
  } finally {
    panel.setLoading(false);
  }
}

async function maybeWarnEmptyClaudeTranscripts(
  context: vscode.ExtensionContext
): Promise<void> {
  const host = await getActiveHost(context);
  if (host.id !== "claude-code") {
    return;
  }
  const key = "agentMindmap.claudeEmptyWarned";
  if (context.globalState.get<boolean>(key)) {
    return;
  }
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) {
    return;
  }
  const scanDir = host.getSessionsScanDir(workspacePath);
  if (!scanDir) {
    return;
  }
  const slug = getWorkspaceSlug(host);
  const sessions = await host.listSessions(scanDir, {
    projectSlug: slug,
    projectPath: workspacePath,
  });
  if (sessions.length) {
    return;
  }
  await context.globalState.update(key, true);
  notifyInfo(
    "Agent Mind Map: No Claude Code transcripts on disk for this workspace. " +
      "The VS Code extension may not persist main chats — CLI sessions are more reliable."
  );
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  initLog(context);
  agentDebugLog(
    "extension.ts:activate",
    "extension activated",
    {
      extensionPath: context.extensionPath,
      workspaceFolder:
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
      dumpFolder: "agent-mindmap-llm-dumps",
    },
    "E"
  );
  logLlmDumpLocationsOnce();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (
        e.affectsConfiguration("agentMindmap.host") ||
        e.affectsConfiguration("agentMindmap.projectsDir") ||
        e.affectsConfiguration("agentMindmap.claudeProjectsDir")
      ) {
        resetHostCache();
      }
      if (
        e.affectsConfiguration("agentMindmap.llm.provider") ||
        e.affectsConfiguration("agentMindmap.host")
      ) {
        const host = await getActiveHost(context);
        const config = vscode.workspace.getConfiguration("agentMindmap");
        const providerSetting = config.get<string>("llm.provider", "auto");
        const providerId = resolveLlmProviderId(providerSetting, host.defaultLlmProvider);
        MindMapHost.setProviderId(providerId);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      resetHostCache();
    })
  );

  void maybeWarnEmptyClaudeTranscripts(context);

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (!consumeTranscriptDocUriIfAutoReveal(doc)) {
        return;
      }
      MindMapPanel.getCurrent()?.reveal();
    })
  );

  MindMapPanel.onNodeClicked((payload) =>
    void handleNodeClicked(payload, {
      context: extensionContext,
      listSessionRecords: async () => {
        const storeDir = getStoreDir();
        await ensureStore(storeDir);
        return listRecords(storeDir);
      },
    })
  );

  MindMapPanel.onDownloadRequested(() => {
    void commandDownloadPackage();
  });

  MindMapPanel.onApplyPendingUpdateRequested(() => {
    const panel = MindMapPanel.getCurrent();
    if (!panel) {
      return;
    }
    applyPendingMergeToPanel(panel);
  });

  MindMapPanel.onSelectModelRequested(() => {
    void vscode.commands.executeCommand("agent-mindmap.selectModel");
  });

  MindMapPanel.onModelUpdated(() => {
    void markModelSelected();
  });

  void resolveHostId(context).then(async (hostId) => {
    const host = await getActiveHost(context);
    const config = vscode.workspace.getConfiguration("agentMindmap");
    const providerSetting = config.get<string>("llm.provider", "auto");
    const providerId = resolveLlmProviderId(providerSetting, host.defaultLlmProvider);
    MindMapHost.setProviderId(providerId);
  });

  async function commandSelectHost(): Promise<void> {
    const items = [
      {
        label: "Cursor",
        description: "Read Cursor agent transcripts",
        id: "cursor" as const,
      },
      {
        label: "Claude Code",
        description: "Read Claude Code transcripts",
        id: "claude-code" as const,
      },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select agent host for current workspace",
    });
    if (!picked) {
      return;
    }
    await context.workspaceState.update(WORKSPACE_HOST_KEY, picked.id);
    resetHostCache();
    const host = getHostById(picked.id);
    notifyInfo(
      `Agent Mind Map: Host set to ${host.displayName} for this workspace`
    );
  }

  async function commandSelectModel(): Promise<void> {
    const llmOpts = await readLlmOptions(extensionContext);
    const models = await fetchModelList(llmOpts.provider, llmOpts.cliPath);
    const currentModel = llmOpts.model;
    const CUSTOM_KEY = "__custom__";

    const items: vscode.QuickPickItem[] = [
      {
        label: t("webview.menu.model.default", "Default"),
        description: currentModel === "" ? "✓ current" : "",
      },
      ...models.map((m) => ({
        label: m.label,
        description: currentModel === m.id ? "✓ current" : m.id,
        modelId: m.id,
      })),
      {
        label: t(
          "ui.selectModel.custom.label",
          "Custom model name…"
        ),
        description: "",
        modelId: CUSTOM_KEY,
      } as vscode.QuickPickItem & { modelId: string },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: t(
        "ui.selectModel.placeholder",
        "Select a model for LLM requests"
      ),
    });
    if (!picked) {
      return;
    }

    const pickedItem = picked as vscode.QuickPickItem & {
      modelId?: string;
    };
    let modelValue: string;

    if (pickedItem.modelId === CUSTOM_KEY) {
      const custom = await vscode.window.showInputBox({
        prompt: t(
          "ui.selectModel.custom.placeholder",
          "Model name (e.g. claude-sonnet-4-6)"
        ),
        value: currentModel,
      });
      if (custom === undefined) {
        return;
      }
      modelValue = custom.trim();
    } else if (pickedItem.modelId !== undefined) {
      modelValue = pickedItem.modelId;
    } else {
      modelValue = "";
    }

    await vscode.workspace
      .getConfiguration("agentMindmap")
      .update("llm.model", modelValue, vscode.ConfigurationTarget.Global);

    await markModelSelected();

    const displayName = modelValue
      ? modelValue
      : t("webview.menu.model.default", "Default");
    notifyInfo(
      t(
        "ui.selectModel.applied",
        "Agent Mind Map: Model set to {0}.",
        displayName
      )
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "agent-mindmap.openLatest",
      commandOpenLatest
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.pickSession",
      commandPickSession
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.analyzeAndMergeCurrentProject",
      commandAnalyzeAndMergeCurrentProject
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.selectHost",
      commandSelectHost
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.selectModel",
      commandSelectModel
    )
  );

  void LlmProviderError;

  // Drain any cross-window "pending jump" the previous window persisted
  // when the user picked "open in new/current window". Runs once per
  // activation; ignores expired or wrong-workspace records.
  void drainPendingJump({ context });

  void resolveHostId(context).then((hostId) => {
    if (hostId !== "cursor") {
      return;
    }
    void loadGlassResumableIds().then(
      (ids) =>
        mindMapLog(
          `[activate] pre-warmed glass registry: ${ids.size} resumable ids`
        ),
      (err) => mindMapLog(`[activate] glass registry preload failed: ${err}`)
    );
  });
}

export function deactivate(): void {
  activeSession = undefined;
  closeStateDb();
  clearComposerTitleCache();
}
