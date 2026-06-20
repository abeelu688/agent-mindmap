import { searchProjectRecords } from "./searchIndex";
import type { SearchHit, SegmentEquivalence, SessionRecord } from "./storeTypes";

export type RetrievalEvalCase = {
  name: string;
  query: string;
  expectedSessionIds?: string[];
  expectedConceptKeys?: string[];
  evidenceContains?: string[];
};

export type RetrievalEvalCaseResult = {
  name: string;
  query: string;
  hitCount: number;
  recallAtK: number;
  reciprocalRank: number;
  evidenceMatched: boolean;
  topHit?: SearchHit;
};

export type RetrievalEvalReport = {
  totalCases: number;
  recallAtK: number;
  mrr: number;
  evidenceHitRate: number;
  results: RetrievalEvalCaseResult[];
};

export function evaluateRetrieval(
  records: SessionRecord[],
  cases: RetrievalEvalCase[],
  opts?: {
    k?: number;
    equivalences?: SegmentEquivalence[];
  }
): RetrievalEvalReport {
  const k = opts?.k ?? 3;
  const results = cases.map((testCase) => {
    const hits = searchProjectRecords(records, testCase.query, k, opts?.equivalences);
    return evaluateCase(testCase, hits, k);
  });
  const totalCases = results.length;
  return {
    totalCases,
    recallAtK: average(results.map((r) => r.recallAtK)),
    mrr: average(results.map((r) => r.reciprocalRank)),
    evidenceHitRate: average(results.map((r) => (r.evidenceMatched ? 1 : 0))),
    results,
  };
}

function evaluateCase(
  testCase: RetrievalEvalCase,
  hits: SearchHit[],
  k: number
): RetrievalEvalCaseResult {
  const topK = hits.slice(0, k);
  const expectedCount = expectedItemCount(testCase);
  const matchedCount = expectedItemsMatched(testCase, topK);
  const firstRank = firstRelevantRank(testCase, hits);
  return {
    name: testCase.name,
    query: testCase.query,
    hitCount: hits.length,
    recallAtK: expectedCount ? matchedCount / expectedCount : 0,
    reciprocalRank: firstRank ? 1 / firstRank : 0,
    evidenceMatched: evidenceMatched(testCase, topK),
    topHit: hits[0],
  };
}

function expectedItemCount(testCase: RetrievalEvalCase): number {
  return new Set([
    ...(testCase.expectedSessionIds ?? []).map((id) => `session:${id}`),
    ...(testCase.expectedConceptKeys ?? []).map((key) => `concept:${key}`),
  ]).size;
}

function expectedItemsMatched(testCase: RetrievalEvalCase, hits: SearchHit[]): number {
  const matched = new Set<string>();
  for (const hit of hits) {
    if (testCase.expectedSessionIds?.includes(hit.sessionId)) {
      matched.add(`session:${hit.sessionId}`);
    }
    if (hit.conceptKey && testCase.expectedConceptKeys?.includes(hit.conceptKey)) {
      matched.add(`concept:${hit.conceptKey}`);
    }
  }
  return matched.size;
}

function firstRelevantRank(testCase: RetrievalEvalCase, hits: SearchHit[]): number | undefined {
  const index = hits.findIndex(
    (hit) =>
      testCase.expectedSessionIds?.includes(hit.sessionId) ||
      (hit.conceptKey ? testCase.expectedConceptKeys?.includes(hit.conceptKey) : false)
  );
  return index >= 0 ? index + 1 : undefined;
}

function evidenceMatched(testCase: RetrievalEvalCase, hits: SearchHit[]): boolean {
  const expected = testCase.evidenceContains ?? [];
  if (!expected.length) {
    return true;
  }
  const evidenceText = hits
    .flatMap((hit) => [hit.snippet, ...hit.evidence])
    .join("\n")
    .toLowerCase();
  return expected.every((needle) => evidenceText.includes(needle.toLowerCase()));
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
