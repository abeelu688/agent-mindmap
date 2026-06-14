import { describe, expect, it } from "vitest";
import {
  countMindMapNodes,
  countTrieNodes,
  measureConceptMerge,
  measureSessionCoverage,
  collectSessionIdsAtTerminalTopics,
} from "../extension/src/eval/metrics";
import { buildConceptTrieStructure } from "../extension/src/store/mergeConceptTrie";
import {
  buildRecordMeta,
  buildSessionRecord,
  sha256Hex,
} from "../extension/src/store/sessionStore";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";
import type { Topic, TopicGraph } from "../extension/src/llm/types";
import type { MindMapNodeData } from "../extension/src/transcript/types";

function topic(
  title: string,
  conceptPath: string[] | undefined,
  items: string[] = ["detail"]
): Topic {
  return {
    title,
    conceptPath,
    items: items.map((text) => ({ text })),
  };
}

function makeRecord(sessionId: string, graph: TopicGraph) {
  return buildSessionRecord(
    buildRecordMeta({
      sessionId,
      projectSlug: "home-example-cursor-aosp14",
      transcriptPath: `/fixtures/${sessionId}.jsonl`,
      transcriptMtimeMs: 1,
      transcriptSha256: sha256Hex(sessionId),
      llm: { provider: "test" },
      promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
      sessionLabel: sessionId,
    }),
    topicGraphToOutline(graph)
  );
}

describe("eval metrics", () => {
  it("counts mind map and trie nodes", () => {
    const node: MindMapNodeData = {
      data: { text: "root" },
      children: [
        { data: { text: "a" }, children: [{ data: { text: "leaf" } }] },
        { data: { text: "b" } },
      ],
    };
    expect(countMindMapNodes(node)).toBe(4);

    const records = [
      makeRecord("s1", {
        topics: [topic("t1", ["Android", "Binder"], ["d1"])],
      }),
      makeRecord("s2", {
        topics: [topic("t2", ["Android", "ART"], ["d2"])],
      }),
    ];
    const structure = buildConceptTrieStructure(records, {
      projectSlug: "home-example-cursor-aosp14",
    });
    expect(countTrieNodes(structure.root)).toBeGreaterThan(1);

    const report = measureConceptMerge(
      records,
      {
        projectSlug: "home-example-cursor-aosp14",
      },
      ["s1", "s2"]
    );
    expect(report.conceptMerge.totalTopics).toBe(2);
    expect(report.conceptMerge.mindMapNodeCount).toBeGreaterThan(0);
    expect(report.conceptMerge.trieNodeCount).toBeGreaterThan(0);
  });

  it("measures terminal topic session coverage", () => {
    const records = [
      makeRecord("s1", {
        topics: [topic("a", ["Platform", "Binder"])],
      }),
      makeRecord("s2", {
        topics: [topic("b", ["Platform", "ART"])],
      }),
      makeRecord("s3", {
        topics: [topic("orphan", undefined)],
      }),
    ];
    const structure = buildConceptTrieStructure(records, {
      projectSlug: "home-example-cursor-aosp14",
    });
    const terminal = collectSessionIdsAtTerminalTopics(structure);
    expect(terminal.has("s1")).toBe(true);
    expect(terminal.has("s2")).toBe(true);
    expect(terminal.has("s3")).toBe(false);

    const coverage = measureSessionCoverage(structure, ["s1", "s2", "s3"]);
    expect(coverage.sessionsAtTerminalTopics).toBe(2);
    expect(coverage.sessionsInAnyTopic).toBe(3);
    expect(coverage.sessionCoverageRate).toBeCloseTo(2 / 3);
    expect(coverage.uncoveredSessionIds).toContain("s3");
  });
});
