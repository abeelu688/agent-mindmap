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
  /** Optional code reference; when provided, the record's outline/concept text
   * is kept free of the codeRef's keywords so the codeRef is the sole signal. */
  codeRef?: { path: string; lines: string; description: string; sourceTurnIndices?: number[] };
  conceptPath?: string[];
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
          ...(input.conceptPath ? { conceptPath: input.conceptPath } : {}),
          ...(input.codeRef?.sourceTurnIndices
            ? {
                details: [
                  { text: input.evidence[0], sourceTurnIndices: input.codeRef.sourceTurnIndices },
                ],
              }
            : {}),
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
    ...(input.codeRef
      ? {
          sessionAnalysis: {
            domains: ["software"],
            nodes: [],
            segmentEquivalences: [],
            codeReferences: [
              {
                path: input.codeRef.path,
                lines: input.codeRef.lines,
                description: input.codeRef.description,
                ...(input.codeRef.sourceTurnIndices
                  ? { sourceTurnIndices: input.codeRef.sourceTurnIndices }
                  : {}),
              },
            ],
          },
        }
      : {}),
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
  record({
    sessionId: "sess-jwt-code",
    sessionLabel: "Token refresh tweak",
    analyzedAt: 4000,
    conceptKey: "auth",
    conceptLabel: "Authentication",
    aliases: ["login security"],
    // Outline/evidence deliberately avoids "jwt"/"verify"/"leeway"/"clock skew"
    // so the codeRef description below is the ONLY signal for those query terms,
    // and so this record does not collide with the sess-auth "clock skew" case.
    evidence: ["Refresh endpoint returned 401 under token expiry."],
    conceptPath: ["backend", "auth"],
    codeRef: {
      path: "src/auth/jwt.ts",
      lines: "42-57",
      description: "JWT verify with clock-skew leeway adjustment for token refresh.",
      sourceTurnIndices: [0],
    },
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
  {
    // Q1 semantic-complement: query terms appear only in codeRef description.
    name: "codeRef description semantic complement",
    query: "jwt verify leeway",
    expectedSessionIds: ["sess-jwt-code"],
    expectedConceptKeys: ["auth"],
    evidenceContains: ["jwt verify"],
  },
  {
    // Q1 filename-fragment: precise path hit.
    name: "codeRef path filename hit",
    query: "jwt.ts",
    expectedSessionIds: ["sess-jwt-code"],
    evidenceContains: ["jwt.ts"],
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
    expect(report.totalCases).toBe(5);
    expect(report.recallAtK).toBe(1);
    expect(report.mrr).toBeGreaterThanOrEqual(0.75);
    expect(report.evidenceHitRate).toBe(1);
    expect(report.results.map((result) => result.topHit?.sessionId)).toContain("sess-auth");
    expect(report.results.map((result) => result.topHit?.sessionId)).toContain("sess-jwt-code");
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
