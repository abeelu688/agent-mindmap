import { describe, expect, it } from "vitest";
import {
  MERGE_SESSION_TIMEOUT_PROMPT_SLOT_BYTES,
  REATTACH_TIMEOUT_CHAINS_PER_SLOT,
  scaleMergeSessionAnalysisTimeoutMs,
  scaleReattachTimeoutMs,
} from "../extension/src/llm/reattachTimeout";

describe("scaleReattachTimeoutMs", () => {
  it("doubles base timeout for 11 chains (batch 1 full reconcile)", () => {
    expect(scaleReattachTimeoutMs(90_000, 11)).toBe(180_000);
  });

  it("keeps base for small chain counts", () => {
    expect(scaleReattachTimeoutMs(90_000, REATTACH_TIMEOUT_CHAINS_PER_SLOT)).toBe(90_000);
  });

  it("respects cap", () => {
    expect(scaleReattachTimeoutMs(300_000, 100)).toBe(600_000);
  });
});

describe("scaleMergeSessionAnalysisTimeoutMs", () => {
  it("scales batch 2 delta snapshot+batch (6 sessions) to 270s at 90s base", () => {
    expect(scaleMergeSessionAnalysisTimeoutMs(90_000, 6, { mergeMode: "delta" })).toBe(270_000);
  });

  it("adds slot for large prompts", () => {
    // 5 sessions → ceil(5/3) = 2 slots; large prompt adds 1 slot → 3 × 90s.
    expect(
      scaleMergeSessionAnalysisTimeoutMs(90_000, 5, {
        mergeMode: "full",
        promptBytes: MERGE_SESSION_TIMEOUT_PROMPT_SLOT_BYTES + 1,
      })
    ).toBe(270_000);
  });

  it("batch 1 full (5 sessions) stays at 180s", () => {
    expect(scaleMergeSessionAnalysisTimeoutMs(90_000, 5, { mergeMode: "full" })).toBe(180_000);
  });
});
