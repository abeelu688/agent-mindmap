import { describe, expect, it } from "vitest";
import {
  buildPrefixSubordinateHints,
  buildStructuralReattachHints,
} from "../extension/src/llm/reattachStructuralHints";
import {
  applyReattachStepsToRecords,
  inferPrefixSubordinateSteps,
} from "../extension/src/llm/reattachSteps";

function chain(from: string) {
  return {
    chainIndex: 1,
    from,
    label: from,
    topicCount: 1,
    childSegments: [] as string[],
    pathSamples: [] as string[][],
    keywords: [] as string[],
    subtree: {
      segment: from,
      label: from,
      topicCount: 1,
      childSegments: [] as string[],
      children: [],
    },
  };
}

describe("buildPrefixSubordinateHints", () => {
  it("detects android-app and android-framework under android", () => {
    const hints = buildPrefixSubordinateHints([
      chain("android"),
      chain("android-app"),
      chain("android-framework"),
      chain("aosp"),
    ]);
    expect(hints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          specialistFrom: "android-app",
          hubFrom: "android",
        }),
        expect.objectContaining({
          specialistFrom: "android-framework",
          hubFrom: "android",
        }),
      ])
    );
  });

  it("does not treat art as prefix hub for artificial", () => {
    const hints = buildPrefixSubordinateHints([
      chain("art"),
      chain("artificial-intelligence"),
    ]);
    expect(hints).toHaveLength(0);
  });
});

describe("inferPrefixSubordinateSteps", () => {
  it("adds attach_under steps and rewrites top-level paths", () => {
    const chains = [
      {
        chainIndex: 1,
        from: "android",
        label: "android",
        topicCount: 2,
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
        from: "android-app",
        label: "android-app",
        topicCount: 1,
        sessionIds: [],
        childSegments: [],
        pathSamples: [],
        keywords: [],
        subtree: {
          segment: "android-app",
          label: "android-app",
          topicCount: 0,
          childSegments: [],
          children: [],
        },
      },
      {
        chainIndex: 3,
        from: "android-framework",
        label: "android-framework",
        topicCount: 1,
        sessionIds: [],
        childSegments: [],
        pathSamples: [],
        keywords: [],
        subtree: {
          segment: "android-framework",
          label: "android-framework",
          topicCount: 0,
          childSegments: [],
          children: [],
        },
      },
    ];

    const inferred = inferPrefixSubordinateSteps(chains, []);
    expect(inferred).toHaveLength(2);

    const record = {
      schemaVersion: 1 as const,
      meta: {
        sessionId: "s1",
        projectSlug: "demo",
        projectPath: "/demo",
        sessionLabel: "s1",
        transcriptPath: "/demo/s1.jsonl",
        transcriptSha256: "x",
        transcriptMtimeMs: 1,
        analyzedAt: 1,
        llm: { provider: "fake" },
        promptParams: { maxTopics: 8, maxItemsPerTopic: 6 },
        hostId: "cursor" as const,
      },
      outline: { outline: [] },
      graph: {
        topics: [
          {
            title: "app",
            summary: "app",
            conceptPath: ["android-app", "build"],
          },
          {
            title: "fw",
            summary: "fw",
            conceptPath: ["android-framework", "props"],
          },
        ],
      },
    };

    const out = applyReattachStepsToRecords([record], inferred, chains);
    const tops = out[0]!.graph.topics.map((t) => t.conceptPath?.[0]);
    expect(tops).toEqual(["android", "android"]);
  });
});

describe("buildStructuralReattachHints", () => {
  it("includes prefixSubordinates array", () => {
    const hints = buildStructuralReattachHints(
      [chain("android"), chain("android-app")],
      undefined,
      undefined
    );
    expect(hints.prefixSubordinates).toHaveLength(1);
  });
});
