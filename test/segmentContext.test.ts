import { describe, expect, it } from "vitest";
import {
  buildRefineContextSamples,
  buildTopicContextIndex,
} from "../extension/src/llm/segmentContext";
import {
  buildRecordMeta,
  buildSessionRecord,
  sha256Hex,
} from "../extension/src/store/sessionStore";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";
import type { TopicConceptPathDecision } from "../extension/src/store/ontologyTypes";
import { topicIdForTopic } from "../extension/src/llm/topicId";

function recordWithOutline(
  sessionId: string,
  outlineNodes: Parameters<typeof topicGraphToOutline>[0]
) {
  return buildSessionRecord(
    buildRecordMeta({
      sessionId,
      projectSlug: "aosp",
      transcriptPath: `/tmp/${sessionId}.jsonl`,
      transcriptMtimeMs: 1,
      transcriptSha256: sha256Hex(sessionId),
      analyzedAt: 1,
      llm: { provider: "fake" },
      promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
      promptVersion: 5,
      sessionLabel: sessionId,
    }),
    outlineNodes
  );
}

describe("segmentContext", () => {
  it("indexes sibling titles under the same outline parent", () => {
    const record = recordWithOutline("s1", {
      outline: [
        {
          title: "Android",
          children: [
            {
              title: "ART",
              details: [{ text: "libart" }],
            },
            {
              title: "Runtime",
              details: [{ text: "zygote" }],
            },
          ],
        },
      ],
    });
    const index = buildTopicContextIndex([record]);
    const artTopicId = topicIdForTopic("s1", {
      title: "Android / ART",
      items: [{ text: "libart" }],
    });
    const artCtx = index.get(`s1:${artTopicId}`);
    expect(artCtx).toBeDefined();
    expect(artCtx!.siblingTitles.some((t) => t.includes("Runtime"))).toBe(true);
    expect(artCtx!.outlinePath).toEqual(["Android", "ART"]);
  });

  it("builds per-segment upstream/downstream slices in refine samples", () => {
    const record = recordWithOutline("s1", {
      outline: [
        {
          title: "Android",
          children: [
            {
              title: "ART runtime",
              details: [{ text: "dex2oat" }],
            },
          ],
        },
      ],
    });
    const topicId = topicIdForTopic("s1", {
      title: "Android / ART runtime",
      items: [{ text: "dex2oat" }],
    });
    const topicPaths: TopicConceptPathDecision[] = [
      {
        topicId,
        sessionId: "s1",
        projectSlug: "aosp",
        conceptPath: ["android", "art", "runtime", "start"],
      },
    ];
    const samples = buildRefineContextSamples(
      topicPaths,
      buildTopicContextIndex([record]),
      10
    );
    expect(samples).toHaveLength(1);
    const runtimeSlice = samples[0].segments.find((s) => s.segment === "runtime");
    expect(runtimeSlice).toEqual({
      index: 2,
      segment: "runtime",
      upstream: ["android", "art"],
      downstream: ["start"],
    });
    expect(samples[0].evidence.some((e) => e.includes("dex2oat"))).toBe(true);
  });
});
