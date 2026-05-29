import {
  buildConceptTrieMindMap,
  buildConceptTrieStructure,
  type ConceptMergeOptions,
  type ConceptMergeStats,
  type ConceptTrieNode,
  type ConceptTrieStructure,
} from "../store/mergeConceptTrie";
import type { SessionRecord } from "../store/storeTypes";
import type { MindMapNodeData, MindMapRoot } from "../transcript/types";

export type ConceptMergeMetrics = ConceptMergeStats & {
  trieNodeCount: number;
  mindMapNodeCount: number;
};

export type SessionCoverageMetrics = {
  fixtureSessionCount: number;
  analyzedSessionCount: number;
  sessionsAtTerminalTopics: number;
  sessionsInAnyTopic: number;
  sessionCoverageRate: number;
  uncoveredSessionIds: string[];
};

export type ConceptEvalReport = {
  evaluatedAt: string;
  conceptMerge: ConceptMergeMetrics;
  coverage: SessionCoverageMetrics;
};

export function countMindMapNodes(node: MindMapNodeData): number {
  let count = 1;
  for (const child of node.children ?? []) {
    count += countMindMapNodes(child);
  }
  return count;
}

export function countMindMapRootNodes(root: MindMapRoot): number {
  return countMindMapNodes(root);
}

export function countTrieNodes(node: ConceptTrieNode): number {
  let count = 1;
  for (const child of node.children.values()) {
    count += countTrieNodes(child);
  }
  return count;
}

function walkTrieSessionIds(
  node: ConceptTrieNode,
  terminalOnly: boolean,
  out: Set<string>
): void {
  const isTerminal = node.children.size === 0 && node.topics.length > 0;
  if (!terminalOnly || isTerminal) {
    for (const loc of node.topics) {
      out.add(loc.record.meta.sessionId);
    }
  }
  for (const child of node.children.values()) {
    walkTrieSessionIds(child, terminalOnly, out);
  }
}

export function collectSessionIdsAtTerminalTopics(
  structure: ConceptTrieStructure
): Set<string> {
  const out = new Set<string>();
  walkTrieSessionIds(structure.root, true, out);
  return out;
}

export function collectSessionIdsInAnyTopic(
  structure: ConceptTrieStructure
): Set<string> {
  const out = new Set<string>();
  walkTrieSessionIds(structure.root, false, out);
  for (const loc of structure.orphans) {
    out.add(loc.record.meta.sessionId);
  }
  return out;
}

export function measureSessionCoverage(
  structure: ConceptTrieStructure,
  fixtureSessionIds: string[]
): SessionCoverageMetrics {
  const fixtureSet = new Set(fixtureSessionIds);
  const atTerminal = collectSessionIdsAtTerminalTopics(structure);
  const inAny = collectSessionIdsInAnyTopic(structure);
  const analyzedSessionCount = structure.filtered.length;
  const sessionsAtTerminalTopics = [...atTerminal].filter((id) =>
    fixtureSet.has(id)
  ).length;
  const sessionsInAnyTopic = [...inAny].filter((id) => fixtureSet.has(id)).length;
  const fixtureSessionCount = fixtureSessionIds.length;
  const sessionCoverageRate =
    fixtureSessionCount > 0 ? sessionsAtTerminalTopics / fixtureSessionCount : 0;
  const uncoveredSessionIds = fixtureSessionIds.filter((id) => !atTerminal.has(id));

  return {
    fixtureSessionCount,
    analyzedSessionCount,
    sessionsAtTerminalTopics,
    sessionsInAnyTopic,
    sessionCoverageRate,
    uncoveredSessionIds,
  };
}

export function measureConceptMerge(
  records: SessionRecord[],
  options: ConceptMergeOptions,
  fixtureSessionIds: string[]
): ConceptEvalReport {
  const structure = buildConceptTrieStructure(records, options);
  const { mindMap, stats } = buildConceptTrieMindMap(records, options);

  const conceptMerge: ConceptMergeMetrics = {
    ...stats,
    trieNodeCount: countTrieNodes(structure.root),
    mindMapNodeCount: countMindMapRootNodes(mindMap),
  };

  const coverage = measureSessionCoverage(structure, fixtureSessionIds);

  return {
    evaluatedAt: new Date().toISOString(),
    conceptMerge,
    coverage,
  };
}

export type BaselineComparable = {
  conceptMerge: Pick<
    ConceptMergeMetrics,
    | "trieNodeCount"
    | "mindMapNodeCount"
    | "totalTopics"
    | "topicsWithPath"
    | "topicsWithoutPath"
    | "rootChildren"
  >;
  coverage: Pick<
    SessionCoverageMetrics,
    "sessionCoverageRate" | "sessionsAtTerminalTopics" | "sessionsInAnyTopic"
  >;
};

export type BaselineDelta = {
  trieNodeCount: number;
  mindMapNodeCount: number;
  totalTopics: number;
  topicsWithPath: number;
  topicsWithoutPath: number;
  rootChildren: number;
  sessionCoverageRate: number;
  sessionsAtTerminalTopics: number;
  sessionsInAnyTopic: number;
};

export function diffAgainstBaseline(
  report: ConceptEvalReport,
  baseline: BaselineComparable
): BaselineDelta {
  return {
    trieNodeCount: report.conceptMerge.trieNodeCount - baseline.conceptMerge.trieNodeCount,
    mindMapNodeCount:
      report.conceptMerge.mindMapNodeCount - baseline.conceptMerge.mindMapNodeCount,
    totalTopics: report.conceptMerge.totalTopics - baseline.conceptMerge.totalTopics,
    topicsWithPath:
      report.conceptMerge.topicsWithPath - baseline.conceptMerge.topicsWithPath,
    topicsWithoutPath:
      report.conceptMerge.topicsWithoutPath - baseline.conceptMerge.topicsWithoutPath,
    rootChildren: report.conceptMerge.rootChildren - baseline.conceptMerge.rootChildren,
    sessionCoverageRate:
      report.coverage.sessionCoverageRate - baseline.coverage.sessionCoverageRate,
    sessionsAtTerminalTopics:
      report.coverage.sessionsAtTerminalTopics -
      baseline.coverage.sessionsAtTerminalTopics,
    sessionsInAnyTopic:
      report.coverage.sessionsInAnyTopic - baseline.coverage.sessionsInAnyTopic,
  };
}
