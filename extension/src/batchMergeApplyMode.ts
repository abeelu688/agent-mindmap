/**
 * Batch analyze → concept merge panel update contract:
 *
 * 1. **Batch start** (empty panel, library has prior merge/records):
 *    {@link tryBootstrapCachedConceptMap} renders cached concept map immediately.
 * 2. **First new merge** in this run when bootstrap did not run (panel still empty):
 *    render immediately via `setMindMapData` — no Refresh flash.
 * 3. **Later merge / final refine** in the same run:
 *    `setPendingMindMap` + `pendingUpdateBatchNo` — Refresh button flashes until click.
 * 4. **Code ref LLM** (separate queue in `codeRefQueue.ts`):
 *    always pending Refresh via `pendingUpdateLabel`; runs parallel to analyze/merge.
 *
 * Do not freeze this decision at batch start with library coverage flags — evaluate
 * {@link BatchMergePanelState.initialMergeRendered} on each merge apply.
 */

export type BatchMergePanelState = {
  /** Set true at batch start when the panel already shows a map, or after the first direct apply. */
  initialMergeRendered: boolean;
};

export function createBatchMergePanelState(panelHasMindMap: boolean): BatchMergePanelState {
  return { initialMergeRendered: panelHasMindMap };
}

/** First merge of this batch run when the panel started empty. */
export function shouldApplyMergeDirectlyToPanel(state: BatchMergePanelState): boolean {
  return !state.initialMergeRendered;
}

export function markBatchMergeRendered(state: BatchMergePanelState): void {
  state.initialMergeRendered = true;
}

export function hadFullLibraryCoverage(opts: {
  sessionCount: number;
  libraryRecordCount: number;
}): boolean {
  const { sessionCount, libraryRecordCount } = opts;
  return sessionCount > 0 && libraryRecordCount === sessionCount;
}

/** @deprecated Use {@link createBatchMergePanelState} + {@link shouldApplyMergeDirectlyToPanel}. */
export function shouldAutoApplyBatchUpdates(opts: {
  sessionCount: number;
  libraryRecordCount: number;
  panelHasMindMap: boolean;
  forceRefresh?: boolean;
}): boolean {
  if (opts.forceRefresh) {
    return false;
  }
  return !opts.panelHasMindMap;
}
