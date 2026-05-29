import { describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { LlmProvider } from "../extension/src/llm/types";
import {
  computeOntologyCacheKey,
  ensureOntologyMemory,
  findReusableOntologyBase,
  isCompleteOntologyRecord,
} from "../extension/src/store/ontologyStore";
import {
  buildRecordMeta,
  buildSessionRecord,
  ensureStore,
  sha256Hex,
} from "../extension/src/store/sessionStore";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";
import type { ConceptOntologyRecord } from "../extension/src/store/ontologyTypes";

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

function baseOntology(sessionIds: string[]): ConceptOntologyRecord {
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
        reattach: 1,
        refine: 3,
        outlineSchema: 7,
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
    await ensureStore(storeDir);
    const subset = baseOntology(["s1", "s2"]);
    const subsetKey = "subset-key";
    subset.meta.cacheKey = subsetKey;
    const cacheFile = path.join(storeDir, "ontology", "cache", `${subsetKey}.json`);
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(subset), "utf8");
    const indexFile = path.join(storeDir, "ontology", "index.json");
    await fs.writeFile(
      indexFile,
      JSON.stringify({
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
      }),
      "utf8"
    );

    const records = [sessionRecord("s1"), sessionRecord("s2"), sessionRecord("s3")];
    const found = await findReusableOntologyBase(storeDir, records);
    expect(found?.nodes.length).toBe(1);
    expect(found?.meta.sessionIds).toEqual(["s1", "s2"]);
  });
});

describe("ensureOntologyMemory incremental", () => {
  it("forceRefine re-runs refine even when cache is complete", async () => {
    const records = [sessionRecord("s1")];
    const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "amm-onto-"));
    await ensureStore(storeDir);
    const cacheKey = computeOntologyCacheKey(
      records,
      { hostId: "cursor" },
      "fake"
    );
    const complete = baseOntology(["s1"]);
    complete.meta.cacheKey = cacheKey;
    expect(isCompleteOntologyRecord(complete)).toBe(true);
    const cacheFile = path.join(storeDir, "ontology", "cache", `${cacheKey}.json`);
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(complete), "utf8");

    let refineCalls = 0;
    const provider: LlmProvider = {
      id: "fake",
      async summarize(input) {
        if (input.responseSchema === "ontology-refine") {
          refineCalls += 1;
          return {
            segmentEquivalences: [
              {
                canonical: "art",
                aliases: ["runtime"],
                scope: { pathPrefix: ["android"] },
                confidence: 0.95,
              },
            ],
          };
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
    expect(refineCalls).toBe(1);
    expect(out.segmentEquivalences?.[0]?.confidence).toBe(0.95);
  });
});
