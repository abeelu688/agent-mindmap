/**
 * Whether batch analyze should auto-apply each merge to the panel (no pending Refresh).
 * Fixed at batch start: full library coverage or an existing mind map on the panel.
 * Force re-analyze always uses pending Refresh so the user can apply when ready.
 */
export function shouldAutoApplyBatchUpdates(opts: {
  sessionCount: number;
  libraryRecordCount: number;
  panelHasMindMap: boolean;
  forceRefresh?: boolean;
}): boolean {
  if (opts.forceRefresh) {
    return false;
  }
  const { sessionCount, libraryRecordCount, panelHasMindMap } = opts;
  const hadFullLibraryCoverage = sessionCount > 0 && libraryRecordCount === sessionCount;
  return hadFullLibraryCoverage || panelHasMindMap;
}

export function hadFullLibraryCoverage(opts: {
  sessionCount: number;
  libraryRecordCount: number;
}): boolean {
  const { sessionCount, libraryRecordCount } = opts;
  return sessionCount > 0 && libraryRecordCount === sessionCount;
}
