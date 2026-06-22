import { getStoreDir } from "../paths";
import { getProjectSessionIdsOnMap } from "../codeRefQueue";
import {
  rebuildProjectMergeFromStore,
  rebuildSingleSessionMindMapFromStore,
  resolveProjectSlugFromMindMap,
} from "../mindmap/rebuildMindMapFromStore";
import { getStoreForDir } from "../store/storeClient";
import {
  applyPendingMergeToPanel,
  clearPendingPanelUpdateFlags,
  getLastBatchStatus,
  getPendingMindMap,
} from "./batchStatus";
import type { MindMapRoot } from "@agent-mindmap/core";
import type { MindMapPanel } from "../webview/MindMapPanel";

export function hasPendingPanelUpdates(): boolean {
  const status = getLastBatchStatus();
  return Boolean(
    getPendingMindMap() || status?.pendingUpdateBatchNo !== undefined || status?.pendingUpdateLabel
  );
}

export async function applyPendingUpdatesToPanel(panel: MindMapPanel): Promise<boolean> {
  if (!hasPendingPanelUpdates()) {
    return false;
  }

  const currentMap = panel.getMindMapData();
  const hintMap = getPendingMindMap() ?? currentMap;
  if (!hintMap) {
    return false;
  }

  const projectSlug = resolveProjectSlugFromMindMap(hintMap);
  if (!projectSlug) {
    return applyPendingMergeToPanel(panel);
  }

  const storeDir = getStoreDir();
  const sessionIds = getProjectSessionIdsOnMap(hintMap, projectSlug);
  let mindMap: MindMapRoot | undefined;

  if (sessionIds.size <= 1) {
    const sessionId =
      sessionIds.size === 1
        ? [...sessionIds][0]
        : hintMap.data.origin?.refs?.find((ref) => ref.projectSlug === projectSlug)?.sessionId;
    if (sessionId) {
      mindMap = await rebuildSingleSessionMindMapFromStore(storeDir, projectSlug, sessionId);
    }
  } else {
    const merge = await rebuildProjectMergeFromStore(storeDir, projectSlug);
    if (merge) {
      await (await getStoreForDir(storeDir)).writeConceptTrieMerge(merge);
      mindMap = merge.mindMap;
    }
  }

  if (!mindMap) {
    return applyPendingMergeToPanel(panel);
  }

  panel.setMindMapData(mindMap);
  clearPendingPanelUpdateFlags(panel);
  return true;
}
