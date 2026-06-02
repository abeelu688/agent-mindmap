import { describe, expect, it } from "vitest";
import { applyReattachStepsToRecords } from "../extension/src/llm/reattachSteps";
import type { ReattachStep } from "../extension/src/llm/types";

function topic(path: string[], title: string) {
  return { title, summary: title, items: [], conceptPath: path };
}

function record(sessionId: string, topics: ReturnType<typeof topic>[]) {
  return {
    schemaVersion: 1 as const,
    meta: {
      sessionId,
      projectSlug: "demo",
      projectPath: "/demo",
      sessionLabel: sessionId,
      transcriptPath: `/demo/${sessionId}.jsonl`,
      transcriptSha256: "x",
      transcriptMtimeMs: 1,
      analyzedAt: 1,
      llm: { provider: "fake" },
      promptParams: { maxTopics: 8, maxItemsPerTopic: 6 },
      hostId: "cursor" as const,
    },
    outline: { outline: [] },
    graph: { topics },
  };
}

describe("applyReattachStepsToRecords batch", () => {
  it("collapses parallel art/aosp roots under android via batch hub normalize", () => {
    const chains = [
      {
        chainIndex: 1,
        from: "android",
        label: "android",
        topicCount: 5,
        sessionIds: [],
        childSegments: [],
        pathSamples: [],
        keywords: [],
        subtree: {
          segment: "android",
          label: "android",
          topicCount: 0,
          childSegments: [],
          children: [],
        },
      },
      {
        chainIndex: 2,
        from: "aosp",
        label: "aosp",
        topicCount: 1,
        sessionIds: [],
        childSegments: [],
        pathSamples: [],
        keywords: [],
        subtree: {
          segment: "aosp",
          label: "aosp",
          topicCount: 0,
          childSegments: [],
          children: [],
        },
      },
      {
        chainIndex: 3,
        from: "art",
        label: "art",
        topicCount: 3,
        sessionIds: [],
        childSegments: ["jit"],
        pathSamples: [],
        keywords: [],
        subtree: {
          segment: "art",
          label: "art",
          topicCount: 0,
          childSegments: [],
          children: [],
        },
      },
    ];

    const steps: ReattachStep[] = [
      {
        step: 1,
        kind: "attach_under",
        sourceFrom: "art",
        targetPath: ["android", "art"],
        action: "hang art under android",
        result: "art under android",
      },
      {
        step: 2,
        kind: "attach_under",
        sourceFrom: "aosp",
        targetPath: ["android", "aosp"],
        action: "hang aosp under android",
        result: "aosp under android",
      },
    ];

    const records = [
      record("s1", [
        topic(["art", "jit"], "art jit"),
        topic(["aosp", "build"], "aosp build"),
        topic(["android-platform", "kernel"], "platform kernel"),
      ]),
    ];

    const moved = applyReattachStepsToRecords(records, steps, chains);
    const roots = new Set(
      moved[0].graph.topics.map((t) => t.conceptPath?.[0]).filter(Boolean)
    );
    expect(roots.has("art")).toBe(false);
    expect(roots.has("aosp")).toBe(false);
    expect(roots.has("android")).toBe(true);
    expect(roots.has("android-platform")).toBe(true);
  });
});
