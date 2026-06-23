import { conceptTrieMergePath, readMergeRecord } from "@agent-mindmap/core";
import { getStoreForDir } from "../store/storeClient";
import { mindMapLog } from "../webview/MindMapLog";
import {
  rebuildProjectMergeFromStore,
  rebuildSingleSessionMindMapFromStore,
  resolveProjectSlugFromMindMap,
} from "../mindmap/rebuildMindMapFromStore";
import {
  markBatchMergeRendered,
  shouldApplyMergeDirectlyToPanel,
  type BatchMergePanelState,
} from "../batchMergeApplyMode";
import type { MindMapPanel } from "../webview/MindMapPanel";
import type { MergeRecord } from "../store/storeTypes";

function cachedMergeMatchesProject(merge: MergeRecord, projectSlug: string): boolean {
  if (merge.meta.projectSlugs?.includes(projectSlug)) {
    return true;
  }
  return resolveProjectSlugFromMindMap(merge.mindMap) === projectSlug;
}

async function readStoredConceptMerge(
  storeDir: string,
  store: Awaited<ReturnType<typeof getStoreForDir>>
): Promise<MergeRecord | undefined> {
  const fromKv = await store.readConceptTrieMerge();
  if (fromKv?.mindMap) {
    return fromKv;
  }
  return readMergeRecord(conceptTrieMergePath(storeDir));
}

/**
 * When batch analyze starts on an empty panel, show the library's existing
 * concept map immediately while new/stale sessions continue analyzing.
 */
export async function tryBootstrapCachedConceptMap(opts: {
  storeDir: string;
  projectSlug: string;
  forceRefresh: boolean;
  panel: MindMapPanel;
  panelState: BatchMergePanelState;
  libraryRecordCount: number;
}): Promise<boolean> {
  if (opts.forceRefresh || !shouldApplyMergeDirectlyToPanel(opts.panelState)) {
    return false;
  }

  const store = await getStoreForDir(opts.storeDir);
  const cachedMerge = await readStoredConceptMerge(opts.storeDir, store);
  if (cachedMerge?.mindMap && cachedMergeMatchesProject(cachedMerge, opts.projectSlug)) {
    opts.panel.setMindMapData(cachedMerge.mindMap);
    markBatchMergeRendered(opts.panelState);
    mindMapLog(
      `[batch] bootstrap concept map from concept-trie (${cachedMerge.meta.sessionIds.length} session(s))`
    );
    return true;
  }

  if (opts.libraryRecordCount >= 2) {
    const merge = await rebuildProjectMergeFromStore(opts.storeDir, opts.projectSlug);
    if (merge?.mindMap) {
      opts.panel.setMindMapData(merge.mindMap);
      markBatchMergeRendered(opts.panelState);
      mindMapLog(
        `[batch] bootstrap concept map from library records (${opts.libraryRecordCount} session(s))`
      );
      return true;
    }
  }

  if (opts.libraryRecordCount === 1) {
    const records = await store.listRecordsForProject(opts.projectSlug);
    const sessionId = records[0]?.meta.sessionId;
    if (sessionId) {
      const mindMap = await rebuildSingleSessionMindMapFromStore(
        opts.storeDir,
        opts.projectSlug,
        sessionId
      );
      if (mindMap) {
        opts.panel.setMindMapData(mindMap);
        markBatchMergeRendered(opts.panelState);
        mindMapLog(`[batch] bootstrap single-session map from library cache`);
        return true;
      }
    }
  }

  return false;
}

export const __testing = {
  cachedMergeMatchesProject,
};
