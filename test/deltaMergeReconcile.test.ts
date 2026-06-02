import { describe, expect, it } from "vitest";
import {
  shouldFullReconcile,
  snapshotCoversCurrentSessions,
  type RunDeltaMergePipelineOpts,
} from "../extension/src/pipeline/deltaMergePipeline";
import { buildMergeSnapshotFromOntology } from "../extension/src/store/mergeSnapshot";
import {
  buildRecordMeta,
  buildSessionRecord,
  sha256Hex,
} from "../extension/src/store/sessionStore";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";
import type { MergeSnapshot } from "../extension/src/store/storeTypes";
import { REATTACH_PROMPT_VERSION } from "../extension/src/llm/promptReattach";
import { SESSION_ANALYSIS_PROMPT_VERSION } from "../extension/src/llm/promptSessionAnalysis";

function sessionRecord(sessionId: string) {
  return buildSessionRecord(
    buildRecordMeta({
      sessionId,
      projectSlug: "proj-a",
      transcriptPath: `/tmp/${sessionId}.jsonl`,
      transcriptMtimeMs: 1,
      transcriptSha256: sha256Hex(sessionId),
      analyzedAt: 1,
      llm: { provider: "fake" },
      promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
      sessionLabel: sessionId,
    }),
    topicGraphToOutline({
      topics: [
        {
          title: "t",
          conceptPath: ["a", "b"],
          items: [{ text: "x" }],
        },
      ],
    })
  );
}

function minimalSnapshot(sessionIds: string[]): MergeSnapshot {
  const records = sessionIds.map((id) => sessionRecord(id));
  return buildMergeSnapshotFromOntology(
    records,
    {
      schemaVersion: 1,
      meta: {
        builtAt: 1,
        cacheKey: "k",
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
      nodes: [{ key: "a", label: "A" }],
      mappings: [],
      topicPaths: sessionIds.map((sessionId) => ({
        topicId: `${sessionId}-t`,
        sessionId,
        projectSlug: "proj-a",
        conceptPath: ["a", "b"],
        confidence: 0.9,
      })),
    },
    {
      schemaVersion: 1,
      meta: {
        kind: "deterministic",
        builtAt: 1,
        sessionIds,
        projectSlugs: ["proj-a"],
      },
      mindMap: { nodeData: { data: { text: "root" } } },
    },
    "proj-a"
  );
}

function baseOpts(
  overrides: Partial<RunDeltaMergePipelineOpts> = {}
): RunDeltaMergePipelineOpts {
  return {
    storeDir: "/tmp",
    projectSlug: "proj-a",
    allRecords: [],
    batchRecords: [],
    batchNo: 1,
    mergeMode: "delta",
    mergeFullReconcileEvery: 4,
    providerId: "fake",
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("shouldFullReconcile", () => {
  it("batch 1 always full even when stale snapshot file exists (H1)", () => {
    const snap = minimalSnapshot(["old-1", "old-2"]);
    const current = [sessionRecord("new-1")];
    expect(snapshotCoversCurrentSessions(snap, current)).toBe(false);
    expect(
      shouldFullReconcile(baseOpts({ batchNo: 1 }), snap, current)
    ).toBe(true);
  });

  it("batch 2 can delta when snapshot matches library", () => {
    const snap = minimalSnapshot(["s1"]);
    const current = [sessionRecord("s1"), sessionRecord("s2")];
    expect(
      shouldFullReconcile(baseOpts({ batchNo: 2 }), snap, current)
    ).toBe(false);
  });

  it("batch 2 can use delta when new sessions add unstale-looking top roots", () => {
    const snap = minimalSnapshot(["s1"]);
    snap.reattachSteps = [
      {
        step: 1,
        kind: "merge_synonym",
        sourceFrom: "aosp",
        targetPath: ["android"],
        action: "merge",
        result: "merged",
      },
    ];
    const current = [sessionRecord("s1"), sessionRecord("s2")];
    const opts = baseOpts({ batchNo: 2 });
    expect(shouldFullReconcile(opts, snap, current)).toBe(false);
  });

  it("batch 4 triggers periodic full reconcile", () => {
    const snap = minimalSnapshot(["s1"]);
    const current = [sessionRecord("s1")];
    expect(
      shouldFullReconcile(baseOpts({ batchNo: 4 }), snap, current)
    ).toBe(true);
  });
});
