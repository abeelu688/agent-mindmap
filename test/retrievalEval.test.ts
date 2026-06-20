import { describe, expect, it } from "vitest";
import { evaluateRetrieval, type RetrievalEvalCase } from "../shared/src/retrievalEval";
import type { SegmentEquivalence, SessionRecord } from "../shared/src/storeTypes";

function record(input: {
  sessionId: string;
  sessionLabel: string;
  analyzedAt: number;
  conceptKey: string;
  conceptLabel: string;
  aliases?: string[];
  evidence: string[];
}): SessionRecord {
  return {
    schemaVersion: 1,
    meta: {
      sessionId: input.sessionId,
      projectSlug: "home-example-proj",
      projectPath: "/home/example/proj",
      transcriptPath: `/tmp/${input.sessionId}.jsonl`,
      transcriptMtimeMs: 1,
      analyzedAt: input.analyzedAt,
      llm: { provider: "test" },
      promptParams: { maxTopics: 8, maxItemsPerTopic: 6 },
      sessionLabel: input.sessionLabel,
    },
    outline: {
      title: input.sessionLabel,
      summary: input.evidence[0],
      outline: [
        {
          title: input.conceptLabel,
          summary: input.evidence[0],
        },
      ],
    },
    conceptContexts: [
      {
        key: input.conceptKey,
        label: input.conceptLabel,
        aliases: input.aliases,
        domainKeys: ["software"],
        parentKeys: [],
        childKeys: [],
        evidence: input.evidence,
        sessionId: input.sessionId,
        projectSlug: "home-example-proj",
      },
    ],
  };
}

const records = [
  record({
    sessionId: "sess-auth",
    sessionLabel: "Fix auth retry",
    analyzedAt: 1000,
    conceptKey: "auth",
    conceptLabel: "Authentication",
    aliases: ["login security"],
    evidence: ["Refresh endpoint returned 401 under clock skew."],
  }),
  record({
    sessionId: "sess-mcp",
    sessionLabel: "Add MCP memory retrieval",
    analyzedAt: 2000,
    conceptKey: "mcp",
    conceptLabel: "MCP retrieval",
    aliases: ["agent memory"],
    evidence: ["retrieve_project_memory returns local source-grounded evidence."],
  }),
  record({
    sessionId: "sess-code-ref",
    sessionLabel: "Code reference retry",
    analyzedAt: 3000,
    conceptKey: "code-ref",
    conceptLabel: "Code references",
    evidence: ["Code ref retry handles parsed output failures without external requests."],
  }),
];

const cases: RetrievalEvalCase[] = [
  {
    name: "evidence phrase",
    query: "clock skew",
    expectedSessionIds: ["sess-auth"],
    expectedConceptKeys: ["auth"],
    evidenceContains: ["clock skew"],
  },
  {
    name: "concept alias",
    query: "agent memory",
    expectedSessionIds: ["sess-mcp"],
    expectedConceptKeys: ["mcp"],
    evidenceContains: ["source-grounded"],
  },
  {
    name: "equivalence alias",
    query: "signin",
    expectedSessionIds: ["sess-auth"],
    expectedConceptKeys: ["auth"],
    evidenceContains: ["401"],
  },
];

const equivalences: SegmentEquivalence[] = [
  {
    canonical: "auth",
    aliases: ["signin"],
    scope: { projectSlugs: ["home-example-proj"] },
    confidence: 0.9,
  },
];

describe("retrieval eval", () => {
  it("computes deterministic retrieval quality metrics", () => {
    const report = evaluateRetrieval(records, cases, { k: 3, equivalences });
    expect(report.totalCases).toBe(3);
    expect(report.recallAtK).toBe(1);
    expect(report.mrr).toBeGreaterThanOrEqual(0.75);
    expect(report.evidenceHitRate).toBe(1);
    expect(report.results.map((result) => result.topHit?.sessionId)).toContain("sess-auth");
  });

  it("reports misses without throwing", () => {
    const report = evaluateRetrieval(
      records,
      [
        {
          name: "missing",
          query: "nonexistent topic",
          expectedSessionIds: ["missing-session"],
          expectedConceptKeys: ["missing-concept"],
          evidenceContains: ["not present"],
        },
      ],
      { k: 3 }
    );
    expect(report.recallAtK).toBe(0);
    expect(report.mrr).toBe(0);
    expect(report.evidenceHitRate).toBe(0);
    expect(report.results[0].hitCount).toBe(0);
  });
});
