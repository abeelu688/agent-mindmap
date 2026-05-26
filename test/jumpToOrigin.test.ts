import { describe, expect, it } from "vitest";
import {
  flattenCandidates,
  formatPickerLabel,
  type JumpCandidate,
} from "../extension/src/jumpToOriginCore";
import type { NodeOriginRef } from "../extension/src/transcript/types";

const sessA: Omit<NodeOriginRef, "turnIndex"> = {
  sessionId: "sess-A",
  projectSlug: "proj-a",
  projectPath: "/work/proj-a",
  sessionLabel: "sess-A · now",
  transcriptPath: "/tmp/A.jsonl",
};

const sessB: Omit<NodeOriginRef, "turnIndex"> = {
  sessionId: "sess-B",
  projectSlug: "proj-b",
  projectPath: "/work/proj-b",
  sessionLabel: "sess-B · now",
  transcriptPath: "/tmp/B.jsonl",
};

describe("flattenCandidates", () => {
  it("returns one row per (sessionId, turnIndex), preserving first-seen order", () => {
    const refs: NodeOriginRef[] = [
      { ...sessA, turnIndex: 0 },
      { ...sessA, turnIndex: 1 },
      { ...sessB, turnIndex: 0 },
      { ...sessB, turnIndex: 1 },
    ];
    const out = flattenCandidates(refs);
    expect(out.map((c) => `${c.sessionId}#${c.turnIndex}`)).toEqual([
      "sess-A#0",
      "sess-A#1",
      "sess-B#0",
      "sess-B#1",
    ]);
  });

  it("dedups identical (sessionId, turnIndex) pairs", () => {
    const refs: NodeOriginRef[] = [
      { ...sessA, turnIndex: 0 },
      { ...sessA, turnIndex: 0 },
      { ...sessA, turnIndex: 1 },
    ];
    const out = flattenCandidates(refs);
    expect(out.length).toBe(2);
  });

  it("treats branch refs (turnIndex undefined) as their own row", () => {
    const refs: NodeOriginRef[] = [
      { ...sessA },
      { ...sessA, turnIndex: 0 },
      { ...sessA },
    ];
    const out = flattenCandidates(refs);
    expect(out.length).toBe(2);
    expect(out[0].turnIndex).toBeUndefined();
    expect(out[1].turnIndex).toBe(0);
  });
});

describe("formatPickerLabel", () => {
  const base: JumpCandidate = {
    sessionId: "sess-A",
    projectSlug: "proj-a",
    sessionLabel: "sess-A",
    transcriptPath: "/tmp/A.jsonl",
  };

  it("renders branch-level candidates as 整段会话", () => {
    expect(formatPickerLabel({ ...base, turnIndex: undefined })).toBe(
      "整段会话"
    );
  });

  it("renders turn candidates as Q{n+1}: <preview>", () => {
    expect(
      formatPickerLabel({
        ...base,
        turnIndex: 2,
        question: "Why does binder fail under load?",
      })
    ).toBe("Q3: Why does binder fail under load?");
  });

  it("collapses whitespace and truncates long previews", () => {
    const longQuery = "A".repeat(200);
    const label = formatPickerLabel({
      ...base,
      turnIndex: 0,
      question: longQuery,
    });
    expect(label.startsWith("Q1: ")).toBe(true);
    expect(label.length).toBeLessThanOrEqual("Q1: ".length + 60);
    expect(label.endsWith("…")).toBe(true);
  });

  it("omits preview when question is unknown", () => {
    expect(formatPickerLabel({ ...base, turnIndex: 1 })).toBe("Q2");
  });
});
