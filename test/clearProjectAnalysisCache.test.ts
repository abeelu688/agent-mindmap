import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { clearProjectAnalysisCache } from "../extension/src/store/clearProjectAnalysisCache";
import { buildRecordMeta, buildSessionRecord } from "../extension/src/store/sessionStore";
import { __resetStoreForTest, getStoreForDir } from "../extension/src/store/storeClient";
import type { OntologyRecord } from "../shared/src";
import type { SessionOutline } from "@agent-mindmap/core";

const sampleOutline: SessionOutline = {
  title: "Test",
  outline: [{ title: "Topic", details: [{ text: "detail" }] }],
};

function recordFor(projectSlug: string, sessionId: string) {
  return buildSessionRecord(
    buildRecordMeta({
      sessionId,
      projectSlug,
      projectPath: `/tmp/${projectSlug}`,
      transcriptPath: `/tmp/${sessionId}.jsonl`,
      transcriptMtimeMs: 1,
      transcriptFreshnessToken: sessionId,
      llm: { provider: "cursor-cli" },
      promptParams: { maxTopics: 8, maxItemsPerTopic: 4 },
      sessionLabel: sessionId,
    }),
    sampleOutline
  );
}

describe("clearProjectAnalysisCache", () => {
  it("removes project session records and leaves other projects intact", async () => {
    const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-mindmap-clear-"));
    __resetStoreForTest();
    try {
      const store = await getStoreForDir(storeDir);
      await store.upsertRecord(recordFor("proj-a", "s1"));
      await store.upsertRecord(recordFor("proj-a", "s2"));
      await store.upsertRecord(recordFor("proj-b", "s3"));

      const cleared = await clearProjectAnalysisCache(storeDir, "proj-a");
      expect(cleared.removedSessionRecords).toBe(2);
      expect(await store.getRecord("proj-a", "s1")).toBeUndefined();
      expect(await store.getRecord("proj-b", "s3")).toBeDefined();

      const remaining = await store.listAllRecords();
      expect(remaining.map((r) => r.meta.sessionId)).toEqual(["s3"]);
    } finally {
      __resetStoreForTest();
      await fs.rm(storeDir, { recursive: true, force: true });
    }
  });

  it("clears ontology cache entries from the store", async () => {
    const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-mindmap-clear-"));
    __resetStoreForTest();
    try {
      const store = await getStoreForDir(storeDir);
      await store.upsertRecord(recordFor("proj-a", "s1"));
      const ontology: OntologyRecord = {
        schemaVersion: 1,
        meta: {
          builtAt: Date.now(),
          cacheKey: "sample",
          sessionIds: ["s1"],
          projectSlugs: ["proj-a"],
          llm: { provider: "cursor-cli" },
          promptVersions: {
            ontology: 1,
            topicPaths: 1,
            reattach: 1,
            refine: 0,
            outlineSchema: 1,
            sessionAnalysis: 1,
            mergeSessionAnalysis: 1,
          },
        },
        nodes: [],
        mappings: [],
        topicPaths: [],
        segmentEquivalences: [],
      };
      await store.writeOntologyIndex({
        schemaVersion: 1,
        updatedAt: Date.now(),
        entries: [
          {
            cacheKey: "sample",
            builtAt: ontology.meta.builtAt,
            sessionIds: ["s1"],
            projectSlugs: ["proj-a"],
          },
        ],
      });
      await store.writeOntologyRecord("sample", ontology);
      expect(await store.readOntologyRecord("sample")).toBeDefined();

      await clearProjectAnalysisCache(storeDir, "proj-a");

      expect(await store.readOntologyRecord("sample")).toBeUndefined();
      expect(await store.readOntologyIndex()).toBeUndefined();
    } finally {
      __resetStoreForTest();
      await fs.rm(storeDir, { recursive: true, force: true });
    }
  });
});
