import { mindMapLog } from "./webview/MindMapLog";
import { agentLog } from "./log";
import { MindMapPanel } from "./webview/MindMapPanel";
import {
  conceptTrieMergePath,
  listRecords,
  readRecord,
  writeMergeRecord,
  writeRecord,
} from "./store/sessionStore";
import { sanitizeSessionRecord } from "./store/sanitizeRecords";
import {
  buildConceptMergeWithOntology,
  loadSegmentEquivalencesForRecords,
} from "./store/conceptMergeContext";
import { buildOutlineMindMap } from "./mindmap/buildOutlineMindMap";
import { extractCodeReferencesFromEvents } from "./llm/extractCodeReferences";
import {
  getLastBatchStatus,
  getPendingMindMap,
  setLastBatchStatus,
  setPendingMindMap,
} from "./batch/batchStatus";
import { notifyInfo } from "./notify";
import { t } from "./l10n/uiTranslate";
import { LlmProviderError } from "./llm/types";
import { mindMapLabelsForOutputLanguage } from "./mindmap/outputLanguageLabels";
import type { ChatEvent } from "./transcript/types";
import type { CodeReference, LlmProvider, SessionOutline } from "./llm/types";
import type { OutputLanguage } from "./llm/promptLanguage";
import type { SessionMeta } from "./mindmap/origin";
import type { MindMapRoot } from "./transcript/types";
import type { MergeRecord } from "./store/storeTypes";

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
  const all = await listRecords(item.storeDir);
  const projectRecords = all.filter((r) => r.meta.projectSlug === item.projectSlug);
  if (!projectRecords.length) {
    return undefined;
  }
  const sanitized = await Promise.all(projectRecords.map((r) => sanitizeSessionRecord(r)));
  const llmOpts = {
    providerId: item.provider.id,
    model: item.model,
    hostId: sanitized[0]?.meta.hostId,
    outputLanguage: item.outputLanguage,
  };
  const ctx = await loadSegmentEquivalencesForRecords(item.storeDir, sanitized, llmOpts);
  return buildConceptMergeWithOntology(sanitized, { projectSlug: item.projectSlug }, ctx);
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
};

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
  // Replace any existing pending item for the same session (deduplicate)
  const idx = queue.findIndex((q) => q.sessionId === item.sessionId);
  if (idx >= 0) {
    queue[idx] = item;
  } else {
    queue.push(item);
  }
  processNext();
}

function processNext(): void {
  if (running || queue.length === 0) {
    return;
  }
  running = true;
  const item = queue.shift()!;
  runItem(item).finally(() => {
    running = false;
    processNext();
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
  return refs.map((ref) => ({
    ...ref,
    llmStatus: "failed" as const,
    llmUpdatedAt: now,
    llmError: message.slice(0, 200),
  }));
}

async function runItem(item: CodeRefQueueItem): Promise<void> {
  mindMapLog(
    `[codeRefQueue] start session=${item.sessionId.slice(0, 8)} queue_remaining=${queue.length}`
  );
  const signal = AbortSignal.timeout(item.timeoutMs);

  let doneRefs: CodeReference[] | undefined;
  try {
    const refs = await extractCodeReferencesFromEvents(item.events, item.provider, signal, {
      projectPath: item.projectPath,
      model: item.model,
      cacheDir: item.cacheDir,
      cache: item.cache,
      outline: item.outline,
      timeoutMs: item.timeoutMs,
      outputLanguage: item.outputLanguage,
    });

    if (!refs?.length) {
      mindMapLog(
        `[codeRefQueue] no refs returned session=${item.sessionId.slice(0, 8)}, skipping update`
      );
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
      return;
    }
    // Persist failed status so next load can retry
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
    return;
  }

  // Persist done refs
  try {
    const latest = await readRecord(item.storeDir, item.projectSlug, item.sessionId);
    if (!latest?.sessionAnalysis) {
      return;
    }
    latest.sessionAnalysis.codeReferences = doneRefs;
    await writeRecord(item.storeDir, latest);

    mindMapLog(`[codeRefQueue] done session=${item.sessionId.slice(0, 8)} refs=${doneRefs.length}`);

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
        latest.outline,
        item.sessionLabel,
        sessionMeta,
        doneRefs,
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
  } catch (writeErr) {
    agentLog.error("[codeRefQueue] failed to persist done refs", writeErr);
  }
}
