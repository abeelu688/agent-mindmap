import { analyzeProject, type AnalyzeProjectResult } from "@agent-mindmap/core";
import { getActiveHost, getWorkspaceSlug } from "../host";
import { ensureModelSelected } from "../llmOptions";
import { MindMapPanel } from "../webview/MindMapPanel";
import { withCancellableProgress } from "../progressHelpers";
import { t } from "../l10n/uiTranslate";
import { notifyInfo } from "../notify";
import { buildAnalyzeProjectDeps } from "../adapters/coreUseCaseDeps";
import type * as vscode from "vscode";

function formatSummary(result: AnalyzeProjectResult): string {
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
    const more = result.failures.length > 3 ? ` 等 ${result.failures.length} 条` : "";
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
  const panel = MindMapPanel.createOrShow(context.extensionUri);
  panel.setLoading(true, t("ui.loading.preparing", "Understanding conversation…"));
  try {
    const slug = getWorkspaceSlug(await getActiveHost(context));
    const handle = await withCancellableProgress(
      ({ signal, progress }) =>
        analyzeProject({ ...buildAnalyzeProjectDeps(context, panel, signal, progress) }, {}),
      t("ui.batch.progress.title", "Agent Mind Map: Batch analyze & merge…"),
      panel,
      { forwardToWebviewLoading: false }
    );
    if (handle) {
      notifyInfo(formatSummary(handle.result));
      if (slug) {
        panel.setTitle(`Concept Mind Map · ${slug}`);
      }
    }
  } finally {
    panel.setLoading(false);
  }
}
