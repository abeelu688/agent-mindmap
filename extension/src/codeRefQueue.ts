import { mindMapLog } from "./webview/MindMapLog";
import { agentLog } from "./log";
import { MindMapPanel } from "./webview/MindMapPanel";
import {
  conceptTrieMergePath,
  readRecord,
  writeMergeRecord,
  writeRecord,
} from "./store/sessionStore";
import { buildOutlineMindMap } from "./mindmap/buildOutlineMindMap";
import { rebuildProjectMergeFromStore } from "./mindmap/rebuildMindMapFromStore";
import { extractCodeReferencesFromEvents } from "./llm/extractCodeReferences";
import {
  getLastBatchStatus,
  getPendingMindMap,
  setLastBatchStatus,
  setPendingMindMap,
} from "./batch/batchStatus";
import { notifyInfo } from "./notify";
import { t } from "./l10n/uiTranslate";
import { withCancellableNotificationProgress, mergeAbortSignals } from "./progressHelpers";
import { isRetryableError } from "./errors";
import { LlmProviderError } from "./llm/types";
import { mindMapLabelsForOutputLanguage } from "./mindmap/outputLanguageLabels";
import type { MindMapProgress } from "./progress";
import type { ChatEvent } from "./transcript/types";
import type { CodeReference, LlmProvider, SessionOutline } from "./llm/types";
import type { OutputLanguage } from "./llm/promptLanguage";
import type { SessionMeta } from "./mindmap/origin";
import type { MindMapRoot } from "./transcript/types";
import type { MergeRecord } from "./store/storeTypes";
import type { BatchStatus } from "./webview/MindMapHost";

export type CodeRefPanelNotifyKind = "single" | "merged" | "none";

export function getProjectSessionIdsOnMap(
  mindMap: MindMapRoot | undefined,
  projectSlug: string
): Set<string> {
  const refs = mindMap?.data.origin?.refs;
  if (!refs?.length) {
    return new Set();
  }
  return new Set(refs.filter((ref) => ref.projectSlug === projectSlug).map((ref) => ref.sessionId));
}

export function resolveCodeRefPanelNotifyKind(
  mindMap: MindMapRoot | undefined,
  projectSlug: string,
  sessionId: string
): CodeRefPanelNotifyKind {
  const sessionIds = getProjectSessionIdsOnMap(mindMap, projectSlug);
  if (!sessionIds.has(sessionId)) {
    return "none";
  }
  return sessionIds.size === 1 ? "single" : "merged";
}

async function rebuildProjectMergeFromRecords(
  item: CodeRefQueueItem
): Promise<MergeRecord | undefined> {
  return rebuildProjectMergeFromStore(item.storeDir, item.projectSlug);
}

function truncateSessionLabel(text: string, maxLen = 40): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return normalized.slice(0, maxLen - 1) + "…";
}

function codeRefProgressTitle(): string {
  return t("ui.codeRefs.generating.title", "Agent Mind Map: Generating code descriptions…");
}

function codeRefProgressInitialMessage(item: CodeRefQueueItem, queueRemaining: number): string {
  const sessionShort = truncateSessionLabel(item.sessionLabel);
  const attempt = normalizeAttempt(item.attempt);
  const base =
    attempt > 1
      ? t(
          "ui.codeRefs.generating.retry",
          "Retry {0}/{1} · {2}",
          attempt,
          CODE_REF_MAX_ATTEMPTS,
          sessionShort
        )
      : t("ui.codeRefs.generating.session", "{0}", sessionShort);
  if (queueRemaining > 0) {
    return `${base} — ${t(
      "ui.codeRefs.generating.queueRemaining",
      "{0} more in queue",
      queueRemaining
    )}`;
  }
  return base;
}

function wrapCodeRefProgress(
  parent: MindMapProgress,
  item: CodeRefQueueItem,
  queueRemaining: number
): MindMapProgress {
  const header = codeRefProgressInitialMessage(item, queueRemaining);
  return {
    report(update) {
      const step = typeof update === "string" ? update : update.message;
      if (!step) {
        if (typeof update !== "string" && update.increment !== undefined) {
          parent.report(update);
        }
        return;
      }
      publishCodeRefPanelStatus({
        active: true,
        sessionLabel: truncateSessionLabel(item.sessionLabel),
        message: step,
        queueRemaining,
      });
      parent.report(`${header} — ${step}`);
    },
  };
}

type CodeRefPanelStatusUpdate = {
  active: boolean;
  sessionLabel?: string;
  message?: string;
  queueRemaining?: number;
};

function publishCodeRefPanelStatus(update: CodeRefPanelStatusUpdate): void {
  const panel = MindMapPanel.getCurrent();
  if (!panel) {
    return;
  }
  const current = getLastBatchStatus();
  if (!current) {
    return;
  }
  const nextStatus: BatchStatus = update.active
    ? {
        ...current,
        codeRefActive: true,
        codeRefSessionLabel: update.sessionLabel,
        codeRefMessage: update.message,
        codeRefQueueRemaining: update.queueRemaining,
      }
    : {
        ...current,
        codeRefActive: undefined,
        codeRefSessionLabel: undefined,
        codeRefMessage: undefined,
        codeRefQueueRemaining: undefined,
      };
  setLastBatchStatus(nextStatus);
  panel.setBatchStatus(nextStatus);
}

function finishCodeRefPanelStatus(): void {
  if (queue.length > 0) {
    return;
  }
  publishCodeRefPanelStatus({ active: false });
}

function notifyPanelPendingCodeRefUpdate(
  panel: MindMapPanel,
  pendingMap: MindMapRoot,
  label: string
): void {
  setPendingMindMap(pendingMap, undefined, label);
  const currentStatus = getLastBatchStatus();
  const nextStatus = currentStatus
    ? { ...currentStatus, pendingUpdateLabel: label }
    : {
        total: 1,
        processed: 1,
        analyzed: 1,
        cached: 0,
        failed: 0,
        batchNo: 0,
        running: false,
        pendingUpdateLabel: label,
      };
  setLastBatchStatus(nextStatus);
  panel.setBatchStatus(nextStatus);
  notifyInfo(
    t(
      "ui.codeRefs.pendingRefresh",
      "Agent Mind Map: Code descriptions are ready. Click Refresh in the mind map to update."
    )
  );
}

function hasProjectOnMap(mindMap: MindMapRoot | undefined, projectSlug: string): boolean {
  return getProjectSessionIdsOnMap(mindMap, projectSlug).size > 0;
}

async function publishMergedCodeRefRefresh(
  item: CodeRefQueueItem,
  panel: MindMapPanel,
  _reason: string
): Promise<boolean> {
  const merge = await rebuildProjectMergeFromRecords(item);
  if (!merge) {
    return false;
  }
  await writeMergeRecord(conceptTrieMergePath(item.storeDir), merge);
  const labels = mindMapLabelsForOutputLanguage(item.outputLanguage);
  notifyPanelPendingCodeRefUpdate(panel, merge.mindMap, labels.relatedCode);
  return true;
}

export async function flushPendingCodeRefRefreshForProject(projectSlug: string): Promise<void> {
  const item = dirtyProjectItems.get(projectSlug);
  const panel = MindMapPanel.getCurrent();
  if (!item || !panel) {
    return;
  }
  const currentMap = panel.getMindMapData();
  const pendingMap = getPendingMindMap();
  if (!hasProjectOnMap(currentMap, projectSlug) && !hasProjectOnMap(pendingMap, projectSlug)) {
    return;
  }
  await publishMergedCodeRefRefresh(item, panel, "dirty-project-flush");
}

export type CodeRefQueueItem = {
  sessionId: string;
  projectSlug: string;
  projectPath?: string;
  sessionLabel: string;
  transcriptPath: string;
  events: ChatEvent[];
  outline: SessionOutline;
  provider: LlmProvider;
  model?: string;
  cacheDir?: string;
  cache: boolean;
  timeoutMs: number;
  storeDir: string;
  outputLanguage?: OutputLanguage;
  /** 1-based attempt counter; defaults to 1 on first enqueue. */
  attempt?: number;
};

/** Total attempts per session code-ref LLM job (initial + retries). */
export const CODE_REF_MAX_ATTEMPTS = 3;

function normalizeAttempt(attempt?: number): number {
  return attempt ?? 1;
}

function mergeEnqueueAttempt(existing?: number, incoming?: number): number {
  return Math.max(normalizeAttempt(existing), normalizeAttempt(incoming));
}

function shouldScheduleCodeRefRetry(err: unknown, attempt: number): boolean {
  if (err instanceof LlmProviderError && err.code === "cancelled") {
    return false;
  }
  return attempt < CODE_REF_MAX_ATTEMPTS && isRetryableError(err);
}

const queue: CodeRefQueueItem[] = [];
const dirtyProjectItems = new Map<string, CodeRefQueueItem>();
let running = false;

/** Wait until the background code-reference queue is idle (for headless scripts). */
export function drainCodeRefQueue(): Promise<void> {
  return new Promise((resolve) => {
    const tick = (): void => {
      if (!running && queue.length === 0) {
        resolve();
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

/** Drop queued code-ref jobs for a project (e.g. before force re-analyze). */
export function purgeCodeRefQueueForProject(projectSlug: string): number {
  let removed = 0;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i]!.projectSlug === projectSlug) {
      queue.splice(i, 1);
      removed += 1;
    }
  }
  return removed;
}

export function enqueueCodeRefUpdate(item: CodeRefQueueItem): void {
  enqueueCodeRefItemOnly(item);
  processNext();
}

function enqueueCodeRefItemOnly(item: CodeRefQueueItem): void {
  const attempt = normalizeAttempt(item.attempt);
  const idx = queue.findIndex((q) => q.sessionId === item.sessionId);
  if (idx >= 0) {
    const existing = queue[idx]!;
    queue[idx] = { ...item, attempt: mergeEnqueueAttempt(existing.attempt, attempt) };
  } else {
    queue.push({ ...item, attempt });
  }
}

function processNext(): void {
  if (running || queue.length === 0) {
    return;
  }
  running = true;
  const item = queue.shift()!;
  setImmediate(() => {
    void runItem(item).finally(() => {
      running = false;
      processNext();
    });
  });
}

function markCodeRefsDone(refs: CodeReference[]): CodeReference[] {
  const now = Date.now();
  return refs.map((ref) => ({
    ...ref,
    llmStatus: "done" as const,
    llmUpdatedAt: now,
    llmError: undefined,
  }));
}

function markCodeRefsFailed(
  refs: CodeReference[] | undefined,
  err: unknown
): CodeReference[] | undefined {
  if (!refs?.length) {
    return refs;
  }
  const now = Date.now();
  const message = err instanceof Error ? err.message : String(err);
  return refs.map((ref) =>
    ref.llmStatus === "done"
      ? ref
      : {
          ...ref,
          llmStatus: "failed" as const,
          llmUpdatedAt: now,
          llmError: message.slice(0, 200),
        }
  );
}

async function notifyCodeRefMapUpdate(
  item: CodeRefQueueItem,
  outline: SessionOutline,
  codeRefs: CodeReference[]
): Promise<void> {
  const panel = MindMapPanel.getCurrent();
  const currentMap = panel?.getMindMapData();
  const pendingBatchMap = getPendingMindMap();
  const currentNotifyKind = resolveCodeRefPanelNotifyKind(
    currentMap,
    item.projectSlug,
    item.sessionId
  );
  const pendingNotifyKind = resolveCodeRefPanelNotifyKind(
    pendingBatchMap,
    item.projectSlug,
    item.sessionId
  );
  const notifyKind = currentNotifyKind !== "none" ? currentNotifyKind : pendingNotifyKind;
  const labels = mindMapLabelsForOutputLanguage(item.outputLanguage);

  if (!panel) {
    return;
  }

  if (notifyKind === "none") {
    if (
      hasProjectOnMap(currentMap, item.projectSlug) ||
      hasProjectOnMap(pendingBatchMap, item.projectSlug)
    ) {
      if (await publishMergedCodeRefRefresh(item, panel, "project-map-without-session")) {
        return;
      }
    }
    dirtyProjectItems.set(item.projectSlug, item);
    return;
  }

  let pendingMap: MindMapRoot | undefined;
  if (notifyKind === "single") {
    const sessionMeta: SessionMeta = {
      sessionId: item.sessionId,
      projectSlug: item.projectSlug,
      projectPath: item.projectPath,
      sessionLabel: item.sessionLabel,
      transcriptPath: item.transcriptPath,
    };
    pendingMap = buildOutlineMindMap(
      outline,
      item.sessionLabel,
      sessionMeta,
      codeRefs,
      item.projectPath,
      item.outputLanguage
    );
  } else {
    const merge = await rebuildProjectMergeFromRecords(item);
    if (merge) {
      await writeMergeRecord(conceptTrieMergePath(item.storeDir), merge);
      pendingMap = merge.mindMap;
    }
  }

  if (!pendingMap) {
    return;
  }

  notifyPanelPendingCodeRefUpdate(panel, pendingMap, labels.relatedCode);
}

async function persistAndNotifyPartialCodeRefs(
  item: CodeRefQueueItem,
  codeRefs: CodeReference[],
  outline: SessionOutline
): Promise<void> {
  const latest = await readRecord(item.storeDir, item.projectSlug, item.sessionId);
  if (!latest?.sessionAnalysis) {
    return;
  }
  latest.sessionAnalysis.codeReferences = codeRefs;
  await writeRecord(item.storeDir, latest);
  const doneCount = codeRefs.filter((ref) => ref.llmStatus === "done").length;
  const pendingCount = codeRefs.filter((ref) => ref.llmStatus === "pending").length;
  mindMapLog(
    `[codeRefQueue] partial session=${item.sessionId.slice(0, 8)} done=${doneCount} pending=${pendingCount}`
  );
  await notifyCodeRefMapUpdate(item, outline, codeRefs);
}

async function runItem(item: CodeRefQueueItem): Promise<void> {
  const attempt = normalizeAttempt(item.attempt);
  mindMapLog(
    `[codeRefQueue] start session=${item.sessionId.slice(0, 8)} attempt=${attempt}/${CODE_REF_MAX_ATTEMPTS} queue_remaining=${queue.length}`
  );

  publishCodeRefPanelStatus({
    active: true,
    sessionLabel: truncateSessionLabel(item.sessionLabel),
    queueRemaining: queue.length,
  });

  let doneRefs: CodeReference[] | undefined;
  try {
    const refs = await withCancellableNotificationProgress(
      codeRefProgressTitle(),
      codeRefProgressInitialMessage(item, queue.length),
      ({ progress, signal: cancelSignal }) => {
        const signal = mergeAbortSignals(AbortSignal.timeout(item.timeoutMs), cancelSignal);
        return extractCodeReferencesFromEvents(
          item.events,
          item.provider,
          signal,
          {
            projectPath: item.projectPath,
            model: item.model,
            cacheDir: item.cacheDir,
            cache: item.cache,
            outline: item.outline,
            timeoutMs: item.timeoutMs,
            outputLanguage: item.outputLanguage,
            onBatchComplete: async (batch) => {
              await persistAndNotifyPartialCodeRefs(item, batch.snapshotRefs, item.outline);
            },
          },
          wrapCodeRefProgress(progress, item, queue.length)
        );
      }
    );

    if (refs === undefined) {
      mindMapLog(
        `[codeRefQueue] cancelled session=${item.sessionId.slice(0, 8)}, skipping status write`
      );
      finishCodeRefPanelStatus();
      return;
    }

    if (!refs.length) {
      mindMapLog(
        `[codeRefQueue] no refs returned session=${item.sessionId.slice(0, 8)}, skipping update`
      );
      finishCodeRefPanelStatus();
      return;
    }
    doneRefs = markCodeRefsDone(refs);
  } catch (err) {
    agentLog.warn(`[codeRefQueue] LLM failed session=${item.sessionId.slice(0, 8)}`, {
      error: String(err),
    });
    // On cancellation (extension reload / user cancel), do NOT overwrite stored refs —
    // they will be retried on the next load as long as they stay "pending" or "failed".
    // Overwriting on cancel could corrupt "done" refs from a prior successful run.
    const isCancelled = err instanceof LlmProviderError && err.code === "cancelled";
    if (isCancelled) {
      mindMapLog(
        `[codeRefQueue] cancelled session=${item.sessionId.slice(0, 8)}, skipping status write`
      );
      finishCodeRefPanelStatus();
      return;
    }
    if (shouldScheduleCodeRefRetry(err, attempt)) {
      enqueueCodeRefUpdate({ ...item, attempt: attempt + 1 });
      mindMapLog(
        `[codeRefQueue] retry session=${item.sessionId.slice(0, 8)} attempt=${attempt + 1}/${CODE_REF_MAX_ATTEMPTS}`
      );
      finishCodeRefPanelStatus();
      return;
    }
    // Persist failed status so next load can retry on a later session open
    try {
      const latest = await readRecord(item.storeDir, item.projectSlug, item.sessionId);
      if (latest?.sessionAnalysis) {
        const failed = markCodeRefsFailed(latest.sessionAnalysis.codeReferences, err);
        latest.sessionAnalysis.codeReferences = failed?.length ? failed : undefined;
        await writeRecord(item.storeDir, latest);
      }
    } catch (writeErr) {
      agentLog.error("[codeRefQueue] failed to persist failure status", writeErr);
    }
    mindMapLog(
      `[codeRefQueue] failed session=${item.sessionId.slice(0, 8)} error=${err instanceof Error ? err.message : String(err)}`
    );
    finishCodeRefPanelStatus();
    return;
  }

  // Persist done refs (final snapshot; last batch already notified incrementally)
  try {
    const latest = await readRecord(item.storeDir, item.projectSlug, item.sessionId);
    if (!latest?.sessionAnalysis) {
      finishCodeRefPanelStatus();
      return;
    }
    latest.sessionAnalysis.codeReferences = doneRefs;
    await writeRecord(item.storeDir, latest);

    mindMapLog(`[codeRefQueue] done session=${item.sessionId.slice(0, 8)} refs=${doneRefs.length}`);

    await notifyCodeRefMapUpdate(item, latest.outline, doneRefs);
  } catch (writeErr) {
    agentLog.error("[codeRefQueue] failed to persist done refs", writeErr);
  } finally {
    finishCodeRefPanelStatus();
  }
}

export const __testing = {
  shouldScheduleCodeRefRetry,
  mergeEnqueueAttempt,
  normalizeAttempt,
  enqueueCodeRefItemOnly,
  codeRefProgressInitialMessage,
  markCodeRefsFailed,
  publishCodeRefPanelStatus,
  getQueueSnapshot: (): ReadonlyArray<CodeRefQueueItem> => [...queue],
  resetQueueState: (): void => {
    queue.length = 0;
    dirtyProjectItems.clear();
    running = false;
  },
};
