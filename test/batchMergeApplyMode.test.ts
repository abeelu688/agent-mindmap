import { describe, expect, it } from "vitest";
import {
  createBatchMergePanelState,
  hadFullLibraryCoverage,
  markBatchMergeRendered,
  shouldApplyMergeDirectlyToPanel,
  shouldAutoApplyBatchUpdates,
} from "../extension/src/batchMergeApplyMode";

describe("batch merge panel contract", () => {
  it("renders the first merge when the panel started empty", () => {
    const state = createBatchMergePanelState(false);
    expect(shouldApplyMergeDirectlyToPanel(state)).toBe(true);
    markBatchMergeRendered(state);
    expect(shouldApplyMergeDirectlyToPanel(state)).toBe(false);
  });

  it("uses pending Refresh for all merges when the panel already had a map", () => {
    const state = createBatchMergePanelState(true);
    expect(shouldApplyMergeDirectlyToPanel(state)).toBe(false);
  });
});

describe("shouldAutoApplyBatchUpdates (legacy)", () => {
  it("matches first-render semantics from batch-start panel state", () => {
    expect(
      shouldAutoApplyBatchUpdates({
        sessionCount: 24,
        libraryRecordCount: 24,
        panelHasMindMap: false,
      })
    ).toBe(true);
    expect(
      shouldAutoApplyBatchUpdates({
        sessionCount: 24,
        libraryRecordCount: 10,
        panelHasMindMap: true,
      })
    ).toBe(false);
    expect(
      shouldAutoApplyBatchUpdates({
        sessionCount: 7,
        libraryRecordCount: 7,
        panelHasMindMap: false,
        forceRefresh: true,
      })
    ).toBe(false);
  });
});

describe("hadFullLibraryCoverage", () => {
  it("is false for zero sessions", () => {
    expect(hadFullLibraryCoverage({ sessionCount: 0, libraryRecordCount: 0 })).toBe(false);
  });

  it("is true only when counts match and sessions > 0", () => {
    expect(hadFullLibraryCoverage({ sessionCount: 5, libraryRecordCount: 5 })).toBe(true);
    expect(hadFullLibraryCoverage({ sessionCount: 5, libraryRecordCount: 4 })).toBe(false);
  });
});
