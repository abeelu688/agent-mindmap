import type { MindMapPanel } from "../webview/MindMapPanel";
import type { BatchStatus } from "../webview/MindMapHost";
import type { MindMapRoot } from "../transcript/types";

let pendingMindMap: MindMapRoot | undefined;
let pendingBatchNo: number | undefined;
let pendingUpdateLabel: string | undefined;
let lastStatus: BatchStatus | undefined;

export function getPendingMindMap(): MindMapRoot | undefined {
  return pendingMindMap;
}

export function setPendingMindMap(
  data: MindMapRoot | undefined,
  batchNo?: number,
  label?: string
): void {
  pendingMindMap = data;
  pendingBatchNo = batchNo;
  pendingUpdateLabel = label;
}

export function getLastBatchStatus(): BatchStatus | undefined {
  return lastStatus;
}

export function setLastBatchStatus(status: BatchStatus): void {
  lastStatus = status;
}

export function applyPendingMergeToPanel(panel: MindMapPanel): boolean {
  if (!pendingMindMap) {
    return false;
  }
  panel.setMindMapData(pendingMindMap);
  pendingMindMap = undefined;
  pendingBatchNo = undefined;
  pendingUpdateLabel = undefined;
  if (lastStatus) {
    lastStatus = {
      ...lastStatus,
      pendingUpdateBatchNo: undefined,
      pendingUpdateLabel: undefined,
    };
    panel.setBatchStatus(lastStatus);
  }
  return true;
}

export function clearPendingMerge(): void {
  pendingMindMap = undefined;
  pendingBatchNo = undefined;
  pendingUpdateLabel = undefined;
}

/**
 * Clear the pending map only when it is a single-session map for the given
 * session. Leaves batch-analysis (multi-session) pending maps untouched.
 *
 * Call this after loading a session whose code refs are already complete so
 * that a stale `pendingMindMap` left from a previous extension-host process
 * (built before `sourceTurnIndices` propagation was fixed) is not applied on
 * top of the already-correct initial map.
 */
export function clearPendingMindMapIfForSession(projectSlug: string, sessionId: string): void {
  const refs = pendingMindMap?.data.origin?.refs;
  if (!refs?.length) {
    return;
  }
  const isForThisSession = refs.every(
    (ref) => ref.projectSlug === projectSlug && ref.sessionId === sessionId
  );
  if (isForThisSession) {
    clearPendingMerge();
  }
}

export function getPendingBatchNo(): number | undefined {
  return pendingBatchNo;
}

export function getPendingUpdateLabel(): string | undefined {
  return pendingUpdateLabel;
}
