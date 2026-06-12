import type { BatchStatus } from "../webview/MindMapHost";
import type { MindMapRoot } from "../transcript/types";
import { MindMapPanel } from "../webview/MindMapPanel";

let pendingMindMap: MindMapRoot | undefined;
let pendingBatchNo: number | undefined;
let lastStatus: BatchStatus | undefined;

export function getPendingMindMap(): MindMapRoot | undefined {
  return pendingMindMap;
}

export function setPendingMindMap(
  data: MindMapRoot | undefined,
  batchNo?: number
): void {
  pendingMindMap = data;
  pendingBatchNo = batchNo;
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
  if (lastStatus) {
    lastStatus = { ...lastStatus, pendingUpdateBatchNo: undefined };
    panel.setBatchStatus(lastStatus);
  }
  return true;
}

export function clearPendingMerge(): void {
  pendingMindMap = undefined;
  pendingBatchNo = undefined;
}

export function getPendingBatchNo(): number | undefined {
  return pendingBatchNo;
}
