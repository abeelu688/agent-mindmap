import { describe, expect, it } from "vitest";
import {
  appendReattachSteps,
  batchIntroducesNewTopRoots,
  buildMergeSnapshotFromOntology,
  filterRealSessionRecords,
  isMergeSnapshotSessionId,
  MERGE_SNAPSHOT_SESSION_ID,
  snapshotToSessionRecord,
  topRootsFromRecords,
} from "../extension/src/store/mergeSnapshot";
import {
  buildRecordMeta,
  buildSessionRecord,
  sha256Hex,
} from "../extension/src/store/sessionStore";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";
import type { ConceptOntologyRecord } from "../extension/src/store/ontologyTypes";
import { REATTACH_PROMPT_VERSION } from "../extension/src/llm/promptReattach";
import { SESSION_ANALYSIS_PROMPT_VERSION } from "../extension/src/llm/promptSessionAnalysis";

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

function ontologyFor(sessionIds: string[]): ConceptOntologyRecord {
  return {
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
    nodes: [{ key: "android", label: "Android" }],
    mappings: [],
    topicPaths: sessionIds.map((sessionId) => ({
      topicId: `${sessionId}-t`,
      sessionId,
      projectSlug: "proj-a",
      conceptPath: ["android", "art"],
      confidence: 0.9,
    })),
    segmentEquivalences: [],
  };
}

describe("mergeSnapshot", () => {
  it("identifies virtual snapshot session ids", () => {
    expect(isMergeSnapshotSessionId(MERGE_SNAPSHOT_SESSION_ID)).toBe(true);
    expect(isMergeSnapshotSessionId("real-id")).toBe(false);
  });

  it("filters virtual records from batch lists", () => {
    const virtual = snapshotToSessionRecord(
      buildMergeSnapshotFromOntology(
        [sessionRecord("s1")],
        ontologyFor(["s1"]),
        {
          schemaVersion: 1,
          meta: {
            kind: "deterministic",
            builtAt: 1,
            sessionIds: ["s1"],
            projectSlugs: ["proj-a"],
          },
          mindMap: { nodeData: { data: { text: "root" } } },
        },
        "proj-a"
      )
    );
    const list = filterRealSessionRecords([
      sessionRecord("s1"),
      virtual,
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]!.meta.sessionId).toBe("s1");
  });

  it("appendReattachSteps renumbers delta steps", () => {
    const merged = appendReattachSteps(
      [
        {
          step: 1,
          kind: "merge_synonym",
          sourceFrom: "a",
          targetPath: ["b"],
          action: "merge",
          result: "merged",
        },
      ],
      [
        {
          step: 1,
          kind: "attach_under",
          sourceFrom: "c",
          targetPath: ["a", "c"],
          action: "attach",
          result: "attached",
        },
      ]
    );
    expect(merged).toHaveLength(2);
    expect(merged[1]!.step).toBe(2);
  });

  it("snapshotToSessionRecord uses virtual session id", () => {
    const snap = buildMergeSnapshotFromOntology(
      [sessionRecord("s1"), sessionRecord("s2")],
      ontologyFor(["s1", "s2"]),
      {
        schemaVersion: 1,
        meta: {
          kind: "deterministic",
          builtAt: 1,
          sessionIds: ["s1", "s2"],
          projectSlugs: ["proj-a"],
        },
        mindMap: { nodeData: { data: { text: "root" } } },
      },
      "proj-a"
    );
    expect(snap.meta.sessionIds).toEqual(["s1", "s2"]);
    const virtual = snapshotToSessionRecord(snap);
    expect(virtual.meta.sessionId).toBe(MERGE_SNAPSHOT_SESSION_ID);
    expect(virtual.graph.topics.length).toBeGreaterThan(0);
  });

  it("snapshot topicPaths reflect post-reattach prepared paths (H2)", () => {
    const s1 = buildSessionRecord(
      buildRecordMeta({
        sessionId: "s1",
        projectSlug: "proj-a",
        transcriptPath: "/tmp/s1.jsonl",
        transcriptMtimeMs: 1,
        transcriptSha256: sha256Hex("s1"),
        analyzedAt: 1,
        llm: { provider: "fake" },
        promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
        sessionLabel: "s1",
      }),
      topicGraphToOutline({
        topics: [
          {
            title: "art",
            conceptPath: ["aosp", "art"],
            items: [{ text: "x" }],
          },
        ],
      })
    );
    const ontology = ontologyFor(["s1"]);
    ontology.reattachSteps = [
      {
        step: 1,
        kind: "merge_synonym",
        sourceFrom: "aosp",
        targetPath: ["android"],
        action: "merge aosp into android",
        result: "single android root",
      },
    ];
    ontology.topicPaths = [
      {
        topicId: "s1-t",
        sessionId: "s1",
        projectSlug: "proj-a",
        conceptPath: ["aosp", "art"],
        confidence: 0.9,
      },
    ];
    const snap = buildMergeSnapshotFromOntology(
      [s1],
      ontology,
      {
        schemaVersion: 1,
        meta: {
          kind: "deterministic",
          builtAt: 1,
          sessionIds: ["s1"],
          projectSlugs: ["proj-a"],
        },
        mindMap: { nodeData: { data: { text: "root" } } },
      },
      "proj-a"
    );
    expect(snap.topicPaths[0]?.conceptPath?.[0]).toBe("android");
    expect(topRootsFromRecords([snapshotToSessionRecord(snap)])).toEqual([
      "android",
    ]);
  });

  it("batchIntroducesNewTopRoots detects new batch top segments", () => {
    const snap = buildMergeSnapshotFromOntology(
      [sessionRecord("s1")],
      ontologyFor(["s1"]),
      {
        schemaVersion: 1,
        meta: {
          kind: "deterministic",
          builtAt: 1,
          sessionIds: ["s1"],
          projectSlugs: ["proj-a"],
        },
        mindMap: { nodeData: { data: { text: "root" } } },
      },
      "proj-a"
    );
    const batch = [
      buildSessionRecord(
        buildRecordMeta({
          sessionId: "s2",
          projectSlug: "proj-a",
          transcriptPath: "/tmp/s2.jsonl",
          transcriptMtimeMs: 1,
          transcriptSha256: sha256Hex("s2"),
          analyzedAt: 1,
          llm: { provider: "fake" },
          promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
          sessionLabel: "s2",
        }),
        topicGraphToOutline({
          topics: [
            {
              title: "aosp",
              conceptPath: ["aosp", "build"],
              items: [{ text: "x" }],
            },
          ],
        })
      ),
    ];
    expect(batchIntroducesNewTopRoots(snap, batch)).toBe(true);
  });
});
