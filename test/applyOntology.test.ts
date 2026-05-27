import { describe, expect, it } from "vitest";
import { applyTopicPathsFromOntology } from "../extension/src/store/applyOntology";
import type { ConceptOntologyRecord } from "../extension/src/store/ontologyTypes";
import {
  buildRecordMeta,
  buildSessionRecord,
  sha256Hex,
} from "../extension/src/store/sessionStore";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";
import { topicIdForTopic } from "../extension/src/llm/topicId";

function makeRecord(sessionId: string, projectSlug: string) {
  const graph = {
    topics: [
      {
        title: "ART / JIT",
        items: [{ text: "dex2oat" }, { text: "zygote" }],
      },
      {
        title: "Binder",
        items: [{ text: "binder_transaction" }],
      },
    ],
  };
  return buildSessionRecord(
    buildRecordMeta({
      sessionId,
      projectSlug,
      projectPath: `/work/${projectSlug}`,
      transcriptPath: `/tmp/${sessionId}.jsonl`,
      transcriptMtimeMs: 1,
      transcriptSha256: sha256Hex(sessionId),
      analyzedAt: 1,
      llm: { provider: "fake" },
      promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
      promptVersion: 5,
      sessionLabel: `${sessionId}-label`,
    }),
    topicGraphToOutline(graph as any)
  );
}

describe("applyTopicPathsFromOntology", () => {
  it("overrides Topic.conceptPath when a decision exists", () => {
    const r = makeRecord("s1", "proj");
    const artTopic = r.graph.topics[0];
    const artId = topicIdForTopic(r.meta.sessionId, artTopic as any);
    const ontology: ConceptOntologyRecord = {
      schemaVersion: 1,
      meta: {
        builtAt: 1,
        cacheKey: "k",
        sessionIds: [r.meta.sessionId],
        projectSlugs: [r.meta.projectSlug],
        llm: { provider: "fake" },
        promptVersions: {
          ontology: 1,
          topicPaths: 1,
          reattach: 1,
          refine: 1,
          outlineSchema: 5,
        },
      },
      nodes: [{ key: "android", label: "Android" }],
      mappings: [{ mention: "AOSP", key: "android" }],
      topicPaths: [
        {
          topicId: artId,
          sessionId: r.meta.sessionId,
          projectSlug: r.meta.projectSlug,
          conceptPath: ["android", "art", "jit"],
          confidence: 0.9,
        },
      ],
    };

    const out = applyTopicPathsFromOntology([r], ontology);
    expect(out[0].graph.topics[0].conceptPath).toEqual(["android", "art", "jit"]);
  });

  it("leaves topics unchanged when no decision exists", () => {
    const r = makeRecord("s1", "proj");
    const ontology: ConceptOntologyRecord = {
      schemaVersion: 1,
      meta: {
        builtAt: 1,
        cacheKey: "k",
        sessionIds: [r.meta.sessionId],
        projectSlugs: [r.meta.projectSlug],
        llm: { provider: "fake" },
        promptVersions: {
          ontology: 1,
          topicPaths: 1,
          reattach: 1,
          refine: 1,
          outlineSchema: 5,
        },
      },
      nodes: [{ key: "software", label: "Software" }],
      mappings: [],
      topicPaths: [],
    };
    const out = applyTopicPathsFromOntology([r], ontology);
    expect(out[0].graph.topics[0].conceptPath).toBeUndefined();
    expect(out[0].graph.topics[1].conceptPath).toBeUndefined();
  });
});

