import { describe, expect, it } from "vitest";
import {
  buildConceptMergeWithOntology,
  prepareRecordsForConceptMerge,
} from "../extension/src/store/conceptMergeContext";
import {
  buildRecordMeta,
  buildSessionRecord,
  sha256Hex,
} from "../extension/src/store/sessionStore";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";
import type { SegmentEquivalence } from "../extension/src/llm/types";
import { topicIdForTopic } from "../extension/src/llm/topicId";
import type { ConceptOntologyRecord } from "../extension/src/store/ontologyTypes";
import { REATTACH_PROMPT_VERSION } from "../extension/src/llm/promptReattach";
import { SESSION_ANALYSIS_PROMPT_VERSION } from "../extension/src/llm/promptSessionAnalysis";

const equivalences: SegmentEquivalence[] = [
  {
    canonical: "art",
    aliases: ["runtime", "androidruntime"],
    scope: { pathPrefix: ["android"] },
    confidence: 0.95,
  },
];

function sessionRecord(sessionId: string, path: string[]) {
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
    topicGraphToOutline({
      topics: [
        {
          title: "topic",
          conceptPath: path,
          items: [{ text: "libart" }],
        },
      ],
    })
  );
}

describe("buildConceptMergeWithOntology", () => {
  it("merges runtime and art under android using segment equivalences", () => {
    const records = [
      sessionRecord("s1", ["android", "art", "jit"]),
      sessionRecord("s2", ["android", "runtime", "start"]),
    ];
    const merge = buildConceptMergeWithOntology(
      records,
      { projectSlug: "aosp", applySegmentEquivalences: true },
      { segmentEquivalences: equivalences }
    );
    const android = merge.mindMap.children?.find((c) =>
      c.data.text.startsWith("android (")
    );
    const labels =
      android?.children?.map((c) => c.data.text.split(" ")[0].toLowerCase()) ??
      [];
    expect(labels.filter((l) => l === "art")).toHaveLength(1);
    expect(labels).not.toContain("runtime");
  });
});

describe("prepareRecordsForConceptMerge", () => {
  it("applies topic paths only when ontology session set matches", () => {
    const record = sessionRecord("s1", ["mobile", "binder"]);
    const topic = record.graph.topics[0];
    const topicId = topicIdForTopic("s1", topic);
    const ontology = {
      schemaVersion: 1 as const,
      meta: {
        builtAt: 1,
        cacheKey: "k",
        sessionIds: ["s1"],
        projectSlugs: ["aosp"],
        llm: { provider: "fake" },
        promptVersions: {
          ontology: 1,
          topicPaths: 1,
          reattach: REATTACH_PROMPT_VERSION,
          refine: 1,
          outlineSchema: 1,
          sessionAnalysis: SESSION_ANALYSIS_PROMPT_VERSION,
        },
      },
      nodes: [],
      mappings: [],
      topicPaths: [
        {
          topicId,
          sessionId: "s1",
          projectSlug: "aosp",
          conceptPath: ["android", "ipc", "binder"],
          confidence: 0.9,
        },
      ],
      segmentEquivalences: equivalences,
    } satisfies ConceptOntologyRecord;
    const prepared = prepareRecordsForConceptMerge([record], { ontology });
    expect(prepared[0].graph.topics[0].conceptPath?.[0]).toBe("android");
  });
});
