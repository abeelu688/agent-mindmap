import { describe, expect, it } from "vitest";
import { buildRecordMeta, buildSessionRecord } from "@agent-mindmap/core";
import { computeMergeCacheKey } from "../extension/src/store/mergeLlm";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";

function makeRecord(sessionId: string, projectSlug: string) {
  return buildSessionRecord(
    buildRecordMeta({
      sessionId,
      projectSlug,
      transcriptPath: `/tmp/${sessionId}.jsonl`,
      transcriptMtimeMs: 1,
      transcriptFreshnessToken: "abc",
      llm: { provider: "fake", model: "" },
      promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
      sessionLabel: sessionId,
    }),
    topicGraphToOutline({
      topics: [{ title: "T", conceptPath: ["a"], items: [{ text: "x" }] }],
    })
  );
}

describe("computeMergeCacheKey", () => {
  it("is order-independent across records", () => {
    const r0 = makeRecord("s1", "p1");
    const r1 = makeRecord("s2", "p2");
    const opts = { maxTopics: 8, maxItemsPerTopic: 6 };
    const key1 = computeMergeCacheKey([r0, r1], opts, "fake");
    const key2 = computeMergeCacheKey([r1, r0], opts, "fake");
    expect(key1).toBe(key2);
  });

  it("changes when prompt params differ", () => {
    const r0 = makeRecord("s1", "p1");
    const r1 = makeRecord("s2", "p2");
    const key1 = computeMergeCacheKey([r0, r1], { maxTopics: 8, maxItemsPerTopic: 6 }, "fake");
    const key2 = computeMergeCacheKey([r0, r1], { maxTopics: 9, maxItemsPerTopic: 6 }, "fake");
    expect(key1).not.toBe(key2);
  });
});
