import { describe, expect, it } from "vitest";
import {
  hadFullLibraryCoverage,
  shouldAutoApplyBatchUpdates,
} from "../extension/src/batchMergeApplyMode";

describe("shouldAutoApplyBatchUpdates", () => {
  it("returns false when no sessions and no panel map", () => {
    expect(
      shouldAutoApplyBatchUpdates({
        sessionCount: 0,
        libraryRecordCount: 0,
        panelHasMindMap: false,
      })
    ).toBe(false);
  });

  it("returns true when library covers all sessions", () => {
    expect(
      shouldAutoApplyBatchUpdates({
        sessionCount: 24,
        libraryRecordCount: 24,
        panelHasMindMap: false,
      })
    ).toBe(true);
  });

  it("returns false for partial library without panel map", () => {
    expect(
      shouldAutoApplyBatchUpdates({
        sessionCount: 24,
        libraryRecordCount: 10,
        panelHasMindMap: false,
      })
    ).toBe(false);
  });

  it("returns true for partial library when panel already has a map", () => {
    expect(
      shouldAutoApplyBatchUpdates({
        sessionCount: 24,
        libraryRecordCount: 10,
        panelHasMindMap: true,
      })
    ).toBe(true);
  });

  it("returns false for force re-analyze even with full library coverage", () => {
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
