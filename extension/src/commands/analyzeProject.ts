import * as vscode from "vscode";
import { getActiveHost, getWorkspacePath, getWorkspaceSlug } from "../host";
import { getStoreDir } from "../paths";
import { showCliInstallGuide } from "../llm/cliInstallGuide";
import { uiTranslate, t } from "../l10n/uiTranslate";
import { ensureModelSelected, readLlmOptions, resolveLlmProviderId } from "../llmOptions";
import {
  ensureStore,
  readRecord,
} from "../store/sessionStore";
import type { ProjectMergeMode } from "../pipeline/deltaMergePipeline";
import { runFinalRootRefresh } from "../pipeline/snapshotHierarchy";
import { deleteSnapshotHierarchy } from "../store/mergeSnapshot";
import { sanitizeSessionRecord } from "../store/sanitizeRecords";
import { getProvider } from "../llm";
import { agentLog } from "../log";
import { notifyWarning, notifyInfo, notifyError } from "../notify";
import type { SessionRecord } from "../store/storeTypes";
import {
  runProjectSessionBatches,
  type AnalyzeProjectBatchInfo,
  type AnalyzeProjectResult,
  type LoadDeps,
} from "../sessionLoader";
import { MindMapPanel } from "../webview/MindMapPanel";
import { MindMapHost } from "../webview/MindMapHost";
import { withCancellableProgress } from "../progressHelpers";
import { shouldAutoApplyBatchUpdates } from "../batchMergeApplyMode";
import { mindMapLog } from "../webview/MindMapLog";
import {
  toConceptMergeLlmOpts,
  buildProjectConceptMergeForBatch,
} from "../batch/conceptMerge";
import {
  applyPendingMergeToPanel,
  setPendingMindMap,
  clearPendingMerge,
  getLastBatchStatus,
  setLastBatchStatus,
  getPendingBatchNo,
} from "../batch/batchStatus";

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

export async function commandAnalyzeAndMergeCurrentProject(
  context: vscode.ExtensionContext
): Promise<void> {
  if (!(await ensureModelSelected(context))) {
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

  const host = await getActiveHost(context);
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

  const panel = MindMapPanel.createOrShow(context.extensionUri);
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

        clearPendingMerge();
        setLastBatchStatus({
          total: sessions.length,
          processed: 0,
          analyzed: 0,
          cached: 0,
          failed: 0,
          batchNo: 0,
          running: true,
        });
        panel.setBatchStatus(getLastBatchStatus()!);

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

        const llmOpts = await readLlmOptions(context);
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

        const deps: LoadDeps = { context, signal, progress };
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
              agentLog.info(`[onBatchDone] batchNo=${info.batchNo} processed=${info.processed}/${info.total} analyzed=${info.analyzed} skippedFresh=${info.skippedFresh} failed=${info.failed} batchSessionIds=${info.batchSessionIds.join(",")}`);

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
                clearPendingMerge();
                panel.setMindMapData(conceptMerge.mindMap);
                setLastBatchStatus({
                  total: info.total,
                  processed: info.processed,
                  analyzed: info.analyzed,
                  cached,
                  failed: info.failed,
                  batchNo: info.batchNo,
                  running: true,
                });
              } else {
                setPendingMindMap(conceptMerge.mindMap, info.batchNo);
                setLastBatchStatus({
                  total: info.total,
                  processed: info.processed,
                  analyzed: info.analyzed,
                  cached,
                  failed: info.failed,
                  batchNo: info.batchNo,
                  running: true,
                  pendingUpdateBatchNo: getPendingBatchNo(),
                });
              }
              panel.setBatchStatus(getLastBatchStatus()!);

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
              setPendingMindMap(finalMerge.mindMap, Math.max(1, Math.ceil(result.total / 5)));
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

        setLastBatchStatus({
          total: result.total,
          processed: result.total,
          analyzed: result.analyzed,
          cached: result.skippedFresh,
          failed: result.failed,
          batchNo: Math.max(1, Math.ceil(result.total / 5)),
          running: false,
          ...(autoApplyUpdates
            ? {}
            : { pendingUpdateBatchNo: getPendingBatchNo() }),
        });
        panel.setBatchStatus(getLastBatchStatus()!);

        return undefined;
      },
      t("ui.batch.progress.title", "Agent Mind Map: Batch analyze & merge…"),
      panel,
      { forwardToWebviewLoading: false }
    );
    if (!completed && getLastBatchStatus()?.running) {
      setLastBatchStatus({ ...getLastBatchStatus()!, running: false });
      panel.setBatchStatus(getLastBatchStatus()!);
    }
    panel.setTitle(`Concept Mind Map · ${slug}`);
  } finally {
    panel.setLoading(false);
  }
}
