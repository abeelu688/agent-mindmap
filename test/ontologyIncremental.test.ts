import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { buildRecordMeta, buildSessionRecord, sha256Hex } from "@agent-mindmap/core";
import { SESSION_ANALYSIS_PROMPT_VERSION } from "@agent-mindmap/core";
import {
  computeOntologyCacheKey,
  ensureOntologyMemory,
  findReusableOntologyBase,
  isCompleteOntologyRecord,
} from "../extension/src/store/ontologyStore";
import { __resetStoreForTest, getStoreForDir } from "../extension/src/store/storeClient";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";
import { REATTACH_PROMPT_VERSION } from "../extension/src/llm/promptReattach";
import type { LlmProvider } from "@agent-mindmap/core";
import type { OntologyRecord } from "@agent-mindmap/shared";

function sessionRecord(sessionId: string, slug = "proj-a") {
  return buildSessionRecord(
    buildRecordMeta({
      sessionId,
      projectSlug: slug,
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
          conceptPath: ["android", "art"],
          items: [{ text: "libart" }],
        },
      ],
    })
  );
}

function baseOntology(sessionIds: string[]): OntologyRecord {
  return {
    schemaVersion: 1,
    meta: {
      builtAt: 1,
      cacheKey: "base",
      sessionIds,
      projectSlugs: ["proj-a"],
      llm: { provider: "fake" },
      promptVersions: {
        ontology: 1,
        topicPaths: 1,
        reattach: REATTACH_PROMPT_VERSION,
        refine: 0,
        outlineSchema: 7,
        sessionAnalysis: SESSION_ANALYSIS_PROMPT_VERSION,
      },
    },
    nodes: [{ key: "android", label: "Android" }],
    mappings: [{ mention: "aosp", key: "android" }],
    topicPaths: sessionIds.map((sessionId) => ({
      topicId: `${sessionId}-t`,
      sessionId,
      projectSlug: "proj-a",
      conceptPath: ["android", "art"],
      confidence: 0.9,
    })),
    segmentEquivalences: [
      {
        canonical: "art",
        aliases: ["runtime"],
        scope: { pathPrefix: ["android"] },
        confidence: 0.9,
      },
    ],
  };
}

describe("findReusableOntologyBase", () => {
  it("returns latest subset cache with nodes", async () => {
    const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "amm-onto-"));
    __resetStoreForTest();
    try {
      const store = await getStoreForDir(storeDir);
      const subset = baseOntology(["s1", "s2"]);
      const subsetKey = "subset-key";
      subset.meta.cacheKey = subsetKey;
      await store.writeOntologyRecord(subsetKey, subset);
      await store.writeOntologyIndex({
        schemaVersion: 1,
        updatedAt: Date.now(),
        entries: [
          {
            cacheKey: subsetKey,
            builtAt: Date.now(),
            sessionIds: ["s1", "s2"],
            projectSlugs: ["proj-a"],
          },
        ],
      });

      const records = [sessionRecord("s1"), sessionRecord("s2"), sessionRecord("s3")];
      const found = await findReusableOntologyBase(storeDir, records);
      expect(found?.nodes.length).toBe(1);
      expect(found?.meta.sessionIds).toEqual(["s1", "s2"]);
    } finally {
      __resetStoreForTest();
      await fs.rm(storeDir, { recursive: true, force: true });
    }
  });
});

describe("ensureOntologyMemory incremental", () => {
  it("forceRefine refresh segmentEquivalences from sessions without ontology-refine LLM", async () => {
    const records = [sessionRecord("s1")];
    const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "amm-onto-"));
    __resetStoreForTest();
    try {
      const store = await getStoreForDir(storeDir);
      const cacheKey = computeOntologyCacheKey(records, { hostId: "cursor" }, "fake");
      const complete = baseOntology(["s1"]);
      complete.meta.cacheKey = cacheKey;
      expect(isCompleteOntologyRecord(complete)).toBe(true);
      await store.writeOntologyRecord(cacheKey, complete);

      let refineCalls = 0;
      const provider: LlmProvider = {
        id: "fake",
        async summarize(input) {
          if (input.responseSchema === "ontology-refine") {
            refineCalls += 1;
          }
          throw new Error(`unexpected schema ${input.responseSchema}`);
        },
      };

      const out = await ensureOntologyMemory(
        records,
        { hostId: "cursor" },
        provider,
        storeDir,
        new AbortController().signal,
        undefined,
        { forceRefine: true, refineOnly: true }
      );
      expect(refineCalls).toBe(0);
      expect(out.segmentEquivalences).toBeDefined();
    } finally {
      __resetStoreForTest();
      await fs.rm(storeDir, { recursive: true, force: true });
    }
  });
});
