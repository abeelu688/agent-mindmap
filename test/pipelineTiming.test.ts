import { describe, expect, it } from "vitest";
import { formatDurationMs } from "../extension/src/pipeline/pipelineTiming";

describe("pipelineTiming", () => {
  it("formatDurationMs uses ms below 1s and seconds above", () => {
    expect(formatDurationMs(0.4)).toBe("<1ms");
    expect(formatDurationMs(250)).toBe("250ms");
    expect(formatDurationMs(1500)).toBe("1.50s");
  });
});
