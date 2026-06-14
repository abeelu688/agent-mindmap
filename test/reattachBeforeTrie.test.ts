import { describe, expect, it } from "vitest";
import { buildConceptMergeRecord } from "../extension/src/store/mergeConceptTrie";
import {
  collectStaleReattachTopRoots,
  prepareRecordsForFinalTrie,
} from "../extension/src/store/prepareConceptMergeRecords";
import type { ReattachStep } from "../extension/src/llm/types";

function topic(path: string[], title: string) {
  return { title, summary: title, items: [], conceptPath: path };
}

function record(sessionId: string, topics: ReturnType<typeof topic>[]) {
  return {
    schemaVersion: 1 as const,
    meta: {
      sessionId,
      projectSlug: "home-example-cursor-aosp14",
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

const androidReattachSteps: ReattachStep[] = [
  {
    step: 1,
    kind: "attach_under",
    sourceFrom: "androidapp",
    targetPath: ["android", "androidapp"],
    action: "hang android-app under android",
    result: "android-app under android",
    confidence: 0.92,
  },
  {
    step: 2,
    kind: "merge_synonym",
    sourceFrom: "androidframework",
    targetPath: ["aosp"],
    action: "merge android-framework top into aosp",
    result: "framework under aosp",
    confidence: 0.95,
  },
];

describe("prepareRecordsForFinalTrie android reattach", () => {
  it("rewrites top-level android-app and android-framework paths", () => {
    const records = [
      record("s1", [
        topic(["android-app", "system-version", "android-framework"], "app version"),
        topic(["android-framework", "android-os-build", "build-version"], "framework build"),
        topic(["aosp", "android-framework", "android-os-build"], "aosp build"),
      ]),
    ];

    const prepared = prepareRecordsForFinalTrie(records, {
      nodes: [],
      mappings: [],
      topicPaths: [],
      reattachSteps: androidReattachSteps,
    });

    const tops = new Set(
      prepared[0].graph.topics.map((t) => t.conceptPath?.[0]).filter(Boolean) as string[]
    );
    expect(tops.has("android-app")).toBe(false);
    expect(tops.has("android-framework")).toBe(false);
    expect(collectStaleReattachTopRoots(prepared, androidReattachSteps)).toEqual([]);
  });
});

describe("buildConceptMergeRecord ontologyForPrep gate", () => {
  it("does not show android-app or android-framework as mind map top roots", () => {
    const records = [
      record("s1", [
        topic(["android-app", "system-version", "android-framework"], "app version"),
        topic(["android-framework", "system-properties"], "framework props"),
      ]),
    ];

    const merge = buildConceptMergeRecord(records, {
      projectSlug: "home-example-cursor-aosp14",
      applySegmentEquivalences: false,
      ontologyForPrep: {
        nodes: [],
        mappings: [],
        topicPaths: [],
        reattachSteps: androidReattachSteps,
      },
    });

    const topLabels = merge.mindMap.children?.map((c) => c.data.text.split(" (")[0]) ?? [];
    expect(topLabels.some((l) => l === "android-app")).toBe(false);
    expect(topLabels.some((l) => l === "android-framework")).toBe(false);
    expect(topLabels.some((l) => l === "android" || l === "aosp")).toBe(true);
  });
});
