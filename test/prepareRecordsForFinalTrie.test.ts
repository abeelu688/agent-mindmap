import { describe, expect, it } from "vitest";
import { prepareRecordsForFinalTrie } from "../extension/src/pipeline/stages/updateConceptTrie";
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

describe("prepareRecordsForFinalTrie", () => {
  it("does not undo reattach when segment equivalences would remap hub to child root", () => {
    const steps: ReattachStep[] = [
      {
        step: 1,
        kind: "attach_under",
        sourceFrom: "art",
        targetPath: ["android", "art"],
        action: "hang art under android",
        result: "art under android",
      },
    ];

    const records = [
      record("s1", [topic(["art", "jit"], "art jit")]),
    ];

    const ontology = {
      nodes: [],
      mappings: [],
      topicPaths: [
        {
          sessionId: "s1",
          topicId: "s1:0",
          conceptPath: ["art", "jit"],
        },
      ],
      segmentEquivalences: [
        {
          canonical: "art",
          aliases: ["android"],
          confidence: 0.9,
          scope: {},
        },
      ],
    };

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
        from: "art",
        label: "art",
        topicCount: 1,
        sessionIds: [],
        childSegments: [],
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

    const prepared = prepareRecordsForFinalTrie(records, ontology, undefined, steps);
    const root = prepared[0].graph.topics[0].conceptPath?.[0];
    expect(root).toBe("android");
  });
});
