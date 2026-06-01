import * as vscode from "vscode";
import {
  diagnoseJumpCommands,
  drainPendingJump,
  handleNodeClicked,
  tryOpenAgentShapes,
  consumeTranscriptDocUriIfAutoReveal,
} from "./jumpToOrigin";
import {
  findKeysReferencingComposer,
  inspectComposerHeader,
  listAgentRelatedKeys,
  loadGlassResumableIds,
  readStateDbKey,
} from "./transcript/composerTitles";
import { mindMapLog } from "./webview/MindMapLog";
import { MindMapPanel } from "./webview/MindMapPanel";
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
  getHostById,
  getWorkspacePath,
  getWorkspaceSlug,
  resetHostCache,
  resolveHostId,
} from "./host";
import { getStoreDir } from "./paths";
import { showCliInstallGuide } from "./llm/cliInstallGuide";
import { uiTranslate } from "./l10n/uiTranslate";
import type { LlmProviderId } from "./llm/types";
import {
  conceptTrieMergePath,
  deterministicMergePath,
  ensureStore,
  listRecords,
  readRecord,
  readMergeRecord,
  rebuildIndex,
  writeMergeRecord,
} from "./store/sessionStore";
import { buildDeterministicMergeRecordAsync } from "./store/mergeDeterministic";
import { buildConceptTrieMindMap } from "./store/mergeConceptTrie";
import {
  buildConceptMergeForRecords,
  buildConceptMergeWithOntology,
  type ConceptMergeLlmOpts,
} from "./store/conceptMergeContext";
import { sanitizeSessionRecord } from "./store/sanitizeRecords";
import { mergeWithLlm } from "./store/mergeLlm";
import { buildOutlineMindMap } from "./mindmap/buildOutlineMindMap";
import { getProvider } from "./llm";
import { clearOntologyCache } from "./store/ontologyStore";
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

function format(message: string, args: Array<string | number | boolean>): string {
  return message.replace(/\{(\d+)\}/g, (_m, rawIdx) => {
    const idx = Number(rawIdx);
    const v = args[idx];
    return v === undefined ? "" : String(v);
  });
}

const t = (
  key: string,
  message: string,
  ...args: Array<string | number | boolean>
): string => {
  const l10n = (vscode as unknown as { l10n?: { t?: Function } }).l10n;
  const fn = l10n?.t as
    | undefined
    | ((opts: { key: string; message: string; args?: unknown[] }) => string);
  if (fn) {
    return fn({ key, message, args });
  }
  return format(message, args);
};

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

function showMindMapStandalone(
  title: string,
  data: import("./transcript/types").MindMapRoot
): void {
  const panel = createOrShowMindMap();
  panel.setMindMapData(data);
  panel.setTitle(title);
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
      config.get<number>("llm.timeoutMs", 90000) ?? 90000
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

function metaProjectPath(meta: SessionRecord["meta"]): string {
  if (meta.projectPath) {
    return meta.projectPath;
  }
  const host = getHostById(meta.hostId ?? "cursor");
  return host.slugToWorkspacePath(meta.projectSlug);
}

async function loadLibraryRecords(): Promise<SessionRecord[]> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  return listRecords(storeDir);
}

async function ensureDeterministicMerge(
  projectSlug?: string
): Promise<import("./store/storeTypes").MergeRecord> {
  const storeDir = getStoreDir();
  const records = await loadLibraryRecords();
  const merge = await buildDeterministicMergeRecordAsync(records, { projectSlug });
  if (!projectSlug) {
    // Persist the canonical "全部" merge for cheap subsequent opens.
    await writeMergeRecord(deterministicMergePath(storeDir), merge);
    await rebuildIndex(storeDir, records);
  }
  return merge;
}

async function commandOpenLatest(): Promise<void> {
  await loadAndShowSession((deps) => loadLatestSession(deps));
}

async function commandPickSession(): Promise<void> {
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

async function commandRefresh(): Promise<void> {
  if (!activeSession) {
    await loadAndShowSession((deps) => loadLatestSession(deps));
    return;
  }
  const panel = MindMapPanel.getCurrent() ?? createOrShowMindMap();
  panel.setLoading(
    true,
    t("ui.loading.forceReanalyzing", "Force re-analyzing…")
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
      panel
    );
    if (refreshed) {
      activeSession = refreshed;
      panel.setMindMapData(refreshed.mindMap);
      attachTranscriptWatch(panel, refreshed.session);
      vscode.window.showInformationMessage(
        t("ui.command.refresh.done", "Agent Mind Map refreshed.")
      );
    }
  } finally {
    panel.setLoading(false);
  }
}

async function commandDownloadPackage(): Promise<void> {
  const panel = MindMapPanel.getCurrent();
  const mindMap = panel?.getMindMapData();
  if (!mindMap) {
    vscode.window.showWarningMessage(
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
    vscode.window.showErrorMessage(
      t(
        "ui.download.exportFailed",
        "Agent Mind Map: Export failed: {0}",
        err instanceof Error ? err.message : String(err)
      )
    );
  }
}

async function commandOpenDownloadedPackage(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: t(
      "ui.download.pickPackageFolderLabel",
      "Select offline package folder"
    ),
  });
  if (!picked?.length) {
    return;
  }
  await openMindMapPackage(picked[0]!.fsPath);
}

async function commandExportJson(): Promise<void> {
  if (!activeSession) {
    vscode.window.showWarningMessage(
      t("ui.warning.openMindMapFirst", "Agent Mind Map: Open a mind map first.")
    );
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage(
      t(
        "ui.warning.openWorkspaceFolderFirst",
        "Agent Mind Map: Open a workspace folder first."
      )
    );
    return;
  }

  const outDir = vscode.Uri.joinPath(folder.uri, "docs", "agent-mindmaps");
  await vscode.workspace.fs.createDirectory(outDir);
  const fileName = `${activeSession.session.id}.json`;
  const fileUri = vscode.Uri.joinPath(outDir, fileName);
  const content = JSON.stringify(activeSession.mindMap, null, 2);
  await vscode.workspace.fs.writeFile(
    fileUri,
    Buffer.from(content, "utf8")
  );
  const doc = await vscode.workspace.openTextDocument(fileUri);
  await vscode.window.showTextDocument(doc, { preview: false });
  vscode.window.showInformationMessage(
    t(
      "ui.exportJson.exported",
      "Exported mind map to docs/agent-mindmaps/{0}",
      fileName
    )
  );
}

function hasAnyOrigin(
  node: import("./transcript/types").MindMapRoot
): boolean {
  if (node.data.origin?.refs?.length) {
    return true;
  }
  if (node.children) {
    for (const c of node.children) {
      if (hasAnyOrigin(c)) {
        return true;
      }
    }
  }
  return false;
}

async function commandOpenMerged(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const merge = await ensureDeterministicMerge();
  if (!merge.meta.sessionIds.length) {
    vscode.window.showInformationMessage(
      t(
        "ui.library.empty.hint",
        "Agent Mind Map: Library is empty. Analyze at least one session first (e.g. “Open Latest Session”)."
      )
    );
  }
  await showMindMapStandalone(`Agent Mind Map · 全部`, merge.mindMap);
}

function toConceptMergeLlmOpts(
  llmOpts: LlmProviderOptions,
  providerId: string
): ConceptMergeLlmOpts {
  return {
    model: llmOpts.model,
    hostId: llmOpts.hostId,
    providerId,
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
  records: SessionRecord[],
  opts: {
    projectSlug: string;
    conceptLlm: ConceptMergeLlmOpts;
    provider: LlmProvider;
    signal: AbortSignal;
    progress?: MindMapProgress;
    batchRefineOntology: boolean;
    refineOnly?: boolean;
    batchNo?: number;
    processed?: number;
    total?: number;
    /** After each batch milestone (e.g. 5/10): run M2.5 reattach before building final mind map. */
    forceReattach?: boolean;
  }
): Promise<import("./store/storeTypes").MergeRecord> {
  const sanitized = await Promise.all(
    records.map((r) => sanitizeSessionRecord(r))
  );
  if (!opts.batchRefineOntology) {
    return buildProjectConceptMergeFromCache(
      storeDir,
      sanitized,
      opts.conceptLlm,
      opts.projectSlug,
      opts.provider,
      opts.signal,
      opts.progress,
      false
    );
  }
  if (opts.batchNo !== undefined && opts.processed !== undefined && opts.total !== undefined) {
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
  const { merge } = await buildConceptMergeForRecords(sanitized, {
    storeDir,
    projectSlug: opts.projectSlug,
    llm: opts.conceptLlm,
    provider: opts.provider,
    signal: opts.signal,
    progress: opts.progress,
    forceReattach: opts.forceReattach ?? true,
    ontologyFlags: opts.refineOnly
      ? { refineOnly: true, forceRefine: true }
      : { incrementalFromIndex: true, forceRefine: true },
  });
  return merge;
}

async function ensureConceptMerge(
  projectSlug?: string,
  progress?: MindMapProgress,
  signal?: AbortSignal
): Promise<import("./store/storeTypes").MergeRecord> {
  const storeDir = getStoreDir();
  progress?.report(t("ui.progress.loadLibrary", "Loading analysis library…"));
  const records = await loadLibraryRecords();
  const filtered = projectSlug
    ? records.filter((r) => r.meta.projectSlug === projectSlug)
    : records;
  const llmOpts = await readLlmOptions(extensionContext);
  const provider = getProvider(llmOpts);
  progress?.report(
    t("ui.progress.applyConceptPaths", "Applying concept paths & reparent…")
  );
  const sanitized = await Promise.all(
    filtered.map((r) => sanitizeSessionRecord(r))
  );
  const { merge } = await buildConceptMergeForRecords(sanitized, {
    storeDir,
    projectSlug,
    llm: toConceptMergeLlmOpts(llmOpts, provider.id),
    provider,
    signal: signal ?? new AbortController().signal,
    progress,
    forceReattach: true,
    ontologyFlags: { forceRefine: true },
  });
  if (!projectSlug) {
    await writeMergeRecord(conceptTrieMergePath(storeDir), merge);
  }
  return merge;
}

async function commandRebuildOntologyCache(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const removed = await clearOntologyCache(storeDir);
  vscode.window.showInformationMessage(
    t(
      "ui.ontology.cacheCleared",
      "Agent Mind Map: Cleared {0} ontology cache file(s). Next open of Concept Mind Map will re-extract and refine segment equivalences.",
      removed
    )
  );
}

async function commandOpenConceptMerged(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const panel = createOrShowMindMap();
  panel.setLoading(
    true,
    t("ui.progress.preparingMindMap", "Preparing mind map…")
  );
  try {
    const merge = await withCancellableProgress(
      ({ signal, progress }) => ensureConceptMerge(undefined, progress, signal),
      t(
        "ui.progress.buildingMindMap.title",
        "Agent Mind Map: Building mind map…"
      ),
      panel
    );
    if (!merge) {
      return;
    }
    const records = await loadLibraryRecords();
    const { stats } = buildConceptTrieMindMap(records);
    if (stats.recordCount === 0) {
      vscode.window.showInformationMessage(
        t(
          "ui.library.empty.hint",
          "Agent Mind Map: Library is empty. Analyze at least one session first (e.g. “Open Latest Session”)."
        )
      );
    } else if (stats.topicsWithoutPath > 0 && stats.topicsWithPath === 0) {
      vscode.window.showInformationMessage(
        t(
          "ui.concept.noConceptPathAll",
          "Agent Mind Map: All topics in the library have no conceptPath (likely analyzed before upgrade). Run Refresh on each session to re-analyze and attach concept paths."
        )
      );
    } else if (stats.topicsWithoutPath > 0) {
      vscode.window.showInformationMessage(
        t(
          "ui.concept.someMissingConceptPath",
          "Agent Mind Map: {0} topic(s) missing conceptPath were placed under the “Uncategorized” branch.",
          stats.topicsWithoutPath
        )
      );
    }
    panel.setMindMapData(merge.mindMap);
    panel.setTitle("Concept Mind Map · 全部");
  } finally {
    panel.setLoading(false);
  }
}

async function commandOpenConceptMergedCurrentProject(): Promise<void> {
  const host = await getActiveHost(extensionContext);
  const slug = getWorkspaceSlug(host);
  if (!slug) {
    vscode.window.showWarningMessage(
      t(
        "ui.warning.openWorkspaceFolderFirst",
        "Agent Mind Map: Open a workspace folder first."
      )
    );
    return;
  }
  const panel = createOrShowMindMap();
  panel.setLoading(
    true,
    t("ui.progress.preparingMindMap", "Preparing mind map…")
  );
  try {
    const merge = await withCancellableProgress(
      ({ signal, progress }) => ensureConceptMerge(slug, progress, signal),
      t(
        "ui.progress.buildingMindMap.title",
        "Agent Mind Map: Building mind map…"
      ),
      panel
    );
    if (!merge) {
      return;
    }
    const records = await loadLibraryRecords();
    const projectRecords = records.filter((r) => r.meta.projectSlug === slug);
    if (projectRecords.length === 0) {
      vscode.window.showInformationMessage(
        t(
          "ui.library.empty.currentProject",
          "Agent Mind Map: No analyzed sessions in the library for current project ({0}).",
          slug
        )
      );
    } else {
      const { stats } = buildConceptTrieMindMap(records, { projectSlug: slug });
      if (stats.topicsWithoutPath > 0 && stats.topicsWithPath === 0) {
        vscode.window.showInformationMessage(
          t(
            "ui.concept.noConceptPathAll",
            "Agent Mind Map: All topics in the library have no conceptPath (likely analyzed before upgrade). Run Refresh on each session to re-analyze and attach concept paths."
          )
        );
      } else if (stats.topicsWithoutPath > 0) {
        vscode.window.showInformationMessage(
          t(
            "ui.concept.someMissingConceptPath",
            "Agent Mind Map: {0} topic(s) missing conceptPath were placed under the “Uncategorized” branch.",
            stats.topicsWithoutPath
          )
        );
      }
    }
    panel.setMindMapData(merge.mindMap);
    panel.setTitle(`Concept Mind Map · ${slug}`);
  } finally {
    panel.setLoading(false);
  }
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
    vscode.window.showWarningMessage(
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
          vscode.window.showWarningMessage(
            t(
              "ui.warning.openWorkspaceFolderFirst",
              "Agent Mind Map: Open a workspace folder first."
            )
          );
          return undefined;
        }
        const scanDir = host.getSessionsScanDir(workspacePath);
        if (!scanDir) {
          vscode.window.showWarningMessage(
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
          vscode.window.showInformationMessage(
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
              const conceptMerge = await buildProjectConceptMergeForBatch(
                storeDir,
                [...projectRecordsById.values()],
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
                }
              );

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
                  void vscode.window.showInformationMessage(
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
            vscode.window.showWarningMessage(
              uiTranslate(
                "ui.library.empty.llmBadJson",
                "Agent Mind Map: cursor-agent returned invalid JSON for every session (not saved to the library). Check Output → Agent Mind Map logs, retry batch analyze, or increase agentMindmap.llm.maxAttempts."
              )
            );
          } else if (allNewTurnFallbacks) {
            vscode.window.showWarningMessage(
              uiTranslate(
                "ui.library.empty.llmTurnFallbackGeneric",
                "Agent Mind Map: LLM summarization failed for every session. Turn-only views are not saved to the library, so Concept Mind Map stays empty."
              )
            );
          } else {
            vscode.window.showInformationMessage(
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
            const finalMerge = await buildProjectConceptMergeForBatch(
              storeDir,
              batchRecords,
              {
                projectSlug: slug,
                conceptLlm,
                provider,
                signal,
                progress,
                batchRefineOntology: true,
                refineOnly: true,
                forceReattach: true,
              }
            );
            if (autoApplyUpdates) {
              panel.setMindMapData(finalMerge.mindMap);
            } else {
              pendingMergeMindMap = finalMerge.mindMap;
              pendingMergeBatchNo = Math.max(1, Math.ceil(result.total / 5));
            }
          } catch {
            batchOntologyFailed = true;
          }
        }

        vscode.window.showInformationMessage(formatAnalyzeProjectSummary(result));
        if (projectRecordsById.size > 0 && batchOntologyFailed && batchRefineOntology) {
          void vscode.window.showInformationMessage(
            t(
              "ui.batch.noOntologyEquivalences",
              "Agent Mind Map: Concept synonym rules were not generated. Open Concept Mind Map (current project) or Rebuild Concept Ontology Cache for full merge."
            )
          );
        } else if (projectRecordsById.size > 0 && !batchRefineOntology) {
          void vscode.window.showInformationMessage(
            t(
              "ui.batch.noOntologyEquivalencesDisabled",
              "Agent Mind Map: Batch merge used mechanical path rules only. Enable agentMindmap.library.batchRefineOntology or open Concept Mind Map to refine synonyms."
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

async function commandOpenMergedCurrentProject(): Promise<void> {
  const host = await getActiveHost(extensionContext);
  const slug = getWorkspaceSlug(host);
  if (!slug) {
    vscode.window.showWarningMessage(
      t(
        "ui.warning.openWorkspaceFolderFirst",
        "Agent Mind Map: Open a workspace folder first."
      )
    );
    return;
  }
  const merge = await ensureDeterministicMerge(slug);
  if (!merge.meta.sessionIds.length) {
    vscode.window.showInformationMessage(
      t(
        "ui.library.empty.currentProject",
        "Agent Mind Map: No analyzed sessions in the library for current project ({0}).",
        slug
      )
    );
  }
  await showMindMapStandalone(`Agent Mind Map · ${slug}`, merge.mindMap);
}

type PickScope =
  | { kind: "all" }
  | { kind: "current"; slug: string }
  | { kind: "select" };

async function pickMergeScope(
  currentSlug: string | undefined
): Promise<PickScope | undefined> {
  const items: (vscode.QuickPickItem & { scope: PickScope })[] = [];
  if (currentSlug) {
    items.push({
      label: t(
        "ui.merge.scope.current.label",
        "Current project ({0})",
        currentSlug
      ),
      description: t(
        "ui.merge.scope.current.desc",
        "Merge all analyzed sessions from the current workspace"
      ),
      scope: { kind: "current", slug: currentSlug },
    });
  }
  items.push({
    label: t("ui.merge.scope.all.label", "All projects"),
    description: t("ui.merge.scope.all.desc", "Merge all sessions across all projects in the library"),
    scope: { kind: "all" },
  });
  items.push({
    label: t("ui.merge.scope.select.label", "Select sessions…"),
    description: t("ui.merge.scope.select.desc", "Choose sessions to include in the merge"),
    scope: { kind: "select" },
  });
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t("ui.merge.scope.placeholder", "Select LLM merge scope"),
  });
  return picked?.scope;
}

async function pickRecordsManually(
  records: SessionRecord[]
): Promise<SessionRecord[] | undefined> {
  if (!records.length) {
    return undefined;
  }
  const items = records.map((r) => ({
    label: r.meta.sessionLabel,
    description: r.meta.projectPath ?? r.meta.projectSlug,
    detail: r.outline.title
      ? `${r.outline.title} · ${r.outline.outline.length} 条大纲`
      : `${r.outline.outline.length} 条大纲`,
    record: r,
    picked: true,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: t("ui.merge.manualSelect.placeholder", "Select sessions to merge (all selected by default)"),
  });
  return picked?.map((p) => p.record);
}

async function commandLlmMergeRefine(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const all = await listRecords(storeDir);
  if (!all.length) {
    vscode.window.showWarningMessage(
      t(
        "ui.library.empty.hint",
        "Agent Mind Map: Library is empty. Analyze at least one session first (e.g. “Open Latest Session”)."
      )
    );
    return;
  }
  const mergeHost = await getActiveHost(extensionContext);
  const scope = await pickMergeScope(getWorkspaceSlug(mergeHost));
  if (!scope) {
    return;
  }
  let selected: SessionRecord[];
  switch (scope.kind) {
    case "all":
      selected = all;
      break;
    case "current":
      selected = all.filter((r) => r.meta.projectSlug === scope.slug);
      if (!selected.length) {
        vscode.window.showInformationMessage(
          t(
            "ui.library.empty.currentProject",
            "Agent Mind Map: No analyzed sessions in the library for current project ({0}).",
            scope.slug
          )
        );
        return;
      }
      break;
    case "select": {
      const picked = await pickRecordsManually(all);
      if (!picked || !picked.length) {
        return;
      }
      selected = picked;
      break;
    }
  }

  const llmOpts = await readLlmOptions(extensionContext);
  const config = vscode.workspace.getConfiguration("agentMindmap");
  const maxTopics = Math.max(
    2,
    config.get<number>("merge.llm.maxTopics", 8) ?? 8
  );
  const maxItemsPerTopic = Math.max(
    1,
    config.get<number>("merge.llm.maxItemsPerTopic", 6) ?? 6
  );

  const panel = createOrShowMindMap();
  panel.setLoading(true, t("ui.merge.progress.preparing", "Preparing LLM merge…"));
  try {
    const merge = await withCancellableProgress(
      async ({ signal, progress }) => {
        const provider = getProvider(llmOpts);
        return mergeWithLlm(
          selected,
          {
            maxTopics,
            maxItemsPerTopic,
            model: llmOpts.model || undefined,
            hostId: mergeHost.id,
          },
          provider,
          storeDir,
          signal,
          progress
        );
      },
      t("ui.merge.progress.title", "Agent Mind Map: Merging topics…"),
      panel
    );

    if (!merge) {
      return;
    }
    panel.setMindMapData(merge.mindMap);
    panel.setTitle("Agent Mind Map · LLM 合并");
  } finally {
    panel.setLoading(false);
  }
}

// ---------------------------------------------------------------------------
// Search library
// ---------------------------------------------------------------------------

type SearchHit = {
  record: SessionRecord;
  /** Highlighted match reason shown in the QuickPick detail line. */
  matchSnippet: string;
  score: number;
};

/**
 * Score a single record against a lower-cased query string.
 * Returns undefined when there is no match at all.
 */
function scoreRecord(record: SessionRecord, queryLc: string): SearchHit | undefined {
  let score = 0;
  const snippets: string[] = [];

  const check = (text: string | undefined, weight: number, label: string) => {
    if (!text) return;
    if (text.toLowerCase().includes(queryLc)) {
      score += weight;
      snippets.push(`${label}: ${text.slice(0, 80).trim()}`);
    }
  };

  check(record.meta.sessionLabel, 4, "会话");
  check(record.outline.title, 3, "标题");
  check(record.outline.summary, 2, "摘要");
  const walk = (nodes: typeof record.outline.outline) => {
    for (const node of nodes) {
      check(node.title, 2, "大纲");
      check(node.summary, 1, "摘要");
      for (const detail of node.details ?? []) {
        check(detail.text, 1, "细节");
      }
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(record.outline.outline);

  if (score === 0) return undefined;
  return { record, score, matchSnippet: snippets[0] ?? "" };
}

async function commandSearchLibrary(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const records = await listRecords(storeDir);
  if (!records.length) {
    vscode.window.showInformationMessage(
      t(
        "ui.library.empty.hint",
        "Agent Mind Map: Library is empty. Analyze at least one session first (e.g. “Open Latest Session”)."
      )
    );
    return;
  }

  type PickItem = vscode.QuickPickItem & { record: SessionRecord };

  const qp = vscode.window.createQuickPick<PickItem>();
  qp.placeholder = t(
    "ui.search.placeholder",
    "Search topics, titles, and keywords…"
  );
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;

  const buildItems = (query: string): PickItem[] => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // No query — show all, sorted by recency
      return records
        .slice()
        .sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt)
        .map((r) => ({
          label: r.meta.sessionLabel,
          description: metaProjectPath(r.meta),
          detail: r.outline.title
            ? `${r.outline.title} · ${r.outline.outline.length} 条大纲`
            : `${r.outline.outline.length} 条大纲`,
          record: r,
        }));
    }
    const hits: SearchHit[] = [];
    for (const r of records) {
      const hit = scoreRecord(r, q);
      if (hit) hits.push(hit);
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.map((h) => ({
      label: h.record.meta.sessionLabel,
      description:
        h.record.meta.projectPath ??
        metaProjectPath(h.record.meta),
      detail: h.matchSnippet,
      record: h.record,
    }));
  };

  qp.items = buildItems("");

  qp.onDidChangeValue((value) => {
    qp.items = buildItems(value);
  });

  qp.onDidAccept(() => {
    const picked = qp.selectedItems[0];
    qp.hide();
    if (!picked) return;
    const meta = picked.record.meta;
    const root = buildOutlineMindMap(
      picked.record.outline,
      meta.sessionLabel,
      {
        sessionId: meta.sessionId,
        projectSlug: meta.projectSlug,
        projectPath: meta.projectPath,
        sessionLabel: meta.sessionLabel,
        transcriptPath: meta.transcriptPath,
      }
    );
    void showMindMapStandalone(`${meta.sessionLabel} (搜索结果)`, root);
  });

  qp.onDidHide(() => qp.dispose());
  qp.show();
}

async function commandBrowseLibrary(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const records = await listRecords(storeDir);
  if (!records.length) {
    vscode.window.showInformationMessage(
      t(
        "ui.library.empty.hint",
        "Agent Mind Map: Library is empty. Analyze at least one session first (e.g. “Open Latest Session”)."
      )
    );
    return;
  }
  records.sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
  const items = records.map((r) => ({
    label: r.meta.sessionLabel,
    description:
      metaProjectPath(r.meta),
    detail: r.outline.title
      ? `${r.outline.title} · ${r.outline.outline.length} 条大纲`
      : `${r.outline.outline.length} 条大纲`,
    record: r,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t("ui.browse.placeholder", "Pick an analyzed session to open (from library)"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) {
    return;
  }
  const meta = picked.record.meta;
  const root = buildOutlineMindMap(
    picked.record.outline,
    meta.sessionLabel,
    {
      sessionId: meta.sessionId,
      projectSlug: meta.projectSlug,
      projectPath: meta.projectPath,
      sessionLabel: meta.sessionLabel,
      transcriptPath: meta.transcriptPath,
    }
  );
  await showMindMapStandalone(
    `${meta.sessionLabel} (库)`,
    root
  );
}

async function commandOpenStoreDir(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  await vscode.env.openExternal(vscode.Uri.file(storeDir));
}

/**
 * Run the click-to-jump flow without clicking a node. Useful for verifying
 * that the picker / agent-open / clipboard / line-reveal pipeline works
 * when the user reports "the leaf doesn't respond" — the most common
 * cause of that is a stale webview bundle, and this command bypasses the
 * webview entirely.
 */
async function commandDumpStateDbKey(): Promise<void> {
  if (!(await requireCursorHostForDebug())) {
    return;
  }
  const candidates = [
    "glass.localAgentProjects.v1",
    "glass.localAgentProjectMembership.v1",
    "composer.composerHeaders",
    "agentLayout.shared.v6",
  ];
  const picked = await vscode.window.showQuickPick(
    candidates.map((k) => ({ label: k })),
    {
      placeHolder: t(
        "ui.debug.pickStateKey.placeholder",
        "Pick a state.vscdb key to view its full value"
      ),
    }
  );
  if (!picked) return;
  const value = await readStateDbKey(picked.label);
  if (value === undefined) {
    vscode.window.showWarningMessage(
      t(
        "ui.debug.stateKeyMissing",
        "Agent Mind Map: key {0} does not exist or failed to read.",
        picked.label
      )
    );
    return;
  }
  let pretty = value;
  try {
    pretty = JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    // not JSON
  }
  const doc = await vscode.workspace.openTextDocument({
    content: `// state.vscdb key: ${picked.label}\n// raw size: ${value.length} chars\n\n${pretty}`,
    language: "json",
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function commandInspectComposerHeader(): Promise<void> {
  if (!(await requireCursorHostForDebug())) {
    return;
  }
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const records = await listRecords(storeDir);
  if (!records.length) {
    vscode.window.showWarningMessage(
      t(
        "ui.library.empty.hint",
        "Agent Mind Map: Library is empty. Analyze at least one session first (e.g. “Open Latest Session”)."
      )
    );
    return;
  }
  records.sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
  const picked = await vscode.window.showQuickPick(
    records.map((r) => ({
      label: r.meta.sessionLabel,
      description: r.meta.sessionId,
      detail: r.meta.projectPath ?? r.meta.projectSlug,
      sessionId: r.meta.sessionId,
    })),
    {
      placeHolder: t(
        "ui.debug.inspectComposer.pickSession.placeholder",
        "Pick a session to inspect its entry in composer.composerHeaders"
      ),
    }
  );
  if (!picked) return;

  const info = await inspectComposerHeader(picked.sessionId);
  const lines: string[] = [];
  lines.push(`=== composer.composerHeaders 概览 ===`);
  lines.push(`总数: ${info.totalComposers}`);
  lines.push(`按 type 统计:`);
  for (const [t, n] of Object.entries(info.typeCounts).sort(
    (a, b) => b[1] - a[1]
  )) {
    lines.push(`  ${t}: ${n}`);
  }
  lines.push("");
  lines.push(`=== 你选的 session 在 allComposers 里的条目 ===`);
  lines.push(`composerId: ${picked.sessionId}`);
  if (info.ourEntry === undefined) {
    lines.push(`<不在 allComposers 里>`);
  } else {
    lines.push(JSON.stringify(info.ourEntry, null, 2));
  }
  const dump = lines.join("\n");
  mindMapLog("inspectComposerHeader:\n" + dump);
  const doc = await vscode.workspace.openTextDocument({
    content: dump,
    language: "log",
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function requireCursorHostForDebug(): Promise<boolean> {
  const host = await getActiveHost(extensionContext);
  if (host.id !== "cursor") {
    vscode.window.showInformationMessage(
      t(
        "ui.debug.cursorOnly",
        "Agent Mind Map: This debug command is only available when agentMindmap.host is Cursor."
      )
    );
    return false;
  }
  return true;
}

async function commandDumpGlassState(): Promise<void> {
  if (!(await requireCursorHostForDebug())) {
    return;
  }
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const records = await listRecords(storeDir);
  records.sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);

  const allRelated = await listAgentRelatedKeys();
  const lines: string[] = [];
  lines.push(`==== All agent/composer/glass keys in state.vscdb ====`);
  lines.push(`(${allRelated.length} rows)`);
  for (const row of allRelated) {
    lines.push(`  [${row.table}] ${row.key}  (${row.valueSize} bytes)`);
  }
  lines.push("");

  if (records.length > 0) {
    const newest = records[0]!;
    lines.push(
      `==== Keys referencing newest analyzed session ${newest.meta.sessionId} (${newest.meta.sessionLabel}) ====`
    );
    const hits = await findKeysReferencingComposer(newest.meta.sessionId);
    lines.push(`(${hits.length} hits)`);
    for (const hit of hits) {
      lines.push(`  [${hit.table}] ${hit.key}`);
      lines.push(`      preview: ${hit.valuePreview}`);
    }
  }

  const dump = lines.join("\n");
  mindMapLog("Glass state dump:\n" + dump);
  // Show in a new untitled doc so the user can easily inspect/share.
  const doc = await vscode.workspace.openTextDocument({
    content: dump,
    language: "log",
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function commandTryOpenAgentShapes(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const records = await listRecords(storeDir);
  if (!records.length) {
    vscode.window.showWarningMessage(
      t(
        "ui.library.empty.hint",
        "Agent Mind Map: Library is empty. Analyze at least one session first (e.g. “Open Latest Session”)."
      )
    );
    return;
  }
  records.sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
  const picked = await vscode.window.showQuickPick(
    records.map((r) => ({
      label: r.meta.sessionLabel,
      description: r.meta.sessionId,
      detail: r.meta.projectPath ?? r.meta.projectSlug,
      sessionId: r.meta.sessionId,
    })),
    {
      placeHolder: t(
        "ui.debug.tryOpenShapes.placeholder",
        "Pick a session to debug glass.openAgentById argument shapes"
      ),
    }
  );
  if (!picked) return;
  await tryOpenAgentShapes(picked.sessionId);
}

async function commandTestJump(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const records = await listRecords(storeDir);
  if (!records.length) {
    vscode.window.showWarningMessage(
      t(
        "ui.library.empty.hint",
        "Agent Mind Map: Library is empty. Analyze at least one session first (e.g. “Open Latest Session”)."
      )
    );
    return;
  }
  records.sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
  const pickedRecord = await vscode.window.showQuickPick(
    records.map((r) => ({
      label: r.meta.sessionLabel,
      description: r.meta.projectPath ?? r.meta.projectSlug,
      record: r,
    })),
    {
      placeHolder: t(
        "ui.debug.testJump.pickSession.placeholder",
        "Pick a session as the simulated click target"
      ),
    }
  );
  if (!pickedRecord) {
    return;
  }
  const meta = pickedRecord.record.meta;
  await handleNodeClicked(
    {
      refs: [
        {
          sessionId: meta.sessionId,
          projectSlug: meta.projectSlug,
          projectPath: meta.projectPath,
          sessionLabel: meta.sessionLabel,
          transcriptPath: meta.transcriptPath,
        },
      ],
    },
    { context: extensionContext }
  );
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
  vscode.window.showInformationMessage(
    "Agent Mind Map: No Claude Code transcripts on disk for this workspace. " +
      "The VS Code extension may not persist main chats — CLI sessions are more reliable."
  );
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("agentMindmap.host") ||
        e.affectsConfiguration("agentMindmap.projectsDir") ||
        e.affectsConfiguration("agentMindmap.claudeProjectsDir")
      ) {
        resetHostCache();
      }
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
      "agent-mindmap.refresh",
      commandRefresh
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.exportJson",
      commandExportJson
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.downloadPackage",
      commandDownloadPackage
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.openDownloadedPackage",
      commandOpenDownloadedPackage
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.openMerged",
      commandOpenMerged
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.openMergedCurrentProject",
      commandOpenMergedCurrentProject
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.rebuildOntologyCache",
      commandRebuildOntologyCache
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.openConceptMerged",
      commandOpenConceptMerged
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.openConceptMergedCurrentProject",
      commandOpenConceptMergedCurrentProject
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.analyzeAndMergeCurrentProject",
      commandAnalyzeAndMergeCurrentProject
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.llmMergeRefine",
      commandLlmMergeRefine
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.searchLibrary",
      commandSearchLibrary
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.browseLibrary",
      commandBrowseLibrary
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.openStoreDir",
      commandOpenStoreDir
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.testJump",
      commandTestJump
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.diagnoseJump",
      diagnoseJumpCommands
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.tryOpenAgentShapes",
      commandTryOpenAgentShapes
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.dumpGlassState",
      commandDumpGlassState
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.inspectComposerHeader",
      commandInspectComposerHeader
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.dumpStateDbKey",
      commandDumpStateDbKey
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
}
