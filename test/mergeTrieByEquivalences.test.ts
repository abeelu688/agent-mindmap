import { describe, expect, it } from "vitest";
import { buildConceptTrieMindMap } from "../extension/src/store/mergeConceptTrie";
import {
  buildRecordMeta,
  buildSessionRecord,
  sha256Hex,
} from "../extension/src/store/sessionStore";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";
import type { SegmentEquivalence } from "../extension/src/llm/types";

const equivalences: SegmentEquivalence[] = [
  {
    canonical: "art",
    aliases: ["runtime", "androidruntime"],
    scope: { pathPrefix: ["android"] },
    confidence: 0.95,
  },
];

function record(sessionId: string, title: string, path: string[]) {
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
      sessionLabel: title,
    }),
    topicGraphToOutline({
      topics: [{ title, conceptPath: path, items: [{ text: "libart" }] }],
    })
  );
}

describe("mergeTrieSiblingsByEquivalences", () => {
  it("merges android/runtime and android/art under one art branch", () => {
    const records = [
      record("s1", "ART topic", ["android", "art", "jit"]),
      record("s2", "Runtime topic", ["android", "runtime", "start"]),
    ];
    const { mindMap } = buildConceptTrieMindMap(records, {
      segmentEquivalences: equivalences,
    });
    const android = mindMap.children?.find((c) =>
      c.data.text.startsWith("android (")
    );
    expect(android).toBeDefined();
    const childLabels =
      android!.children?.map((c) => c.data.text.split(" ")[0].toLowerCase()) ??
      [];
    expect(childLabels.filter((l) => l === "art")).toHaveLength(1);
    expect(childLabels).not.toContain("runtime");
  });
});
