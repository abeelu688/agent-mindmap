import { segmentKeyForMerge } from "./topicGraphValidate";
import type { ConceptOntologyNode, SegmentEquivalence } from "./types";
import {
  buildConceptTrieStructure,
  type ConceptTrieNode,
} from "../store/mergeConceptTrie";
import type { SessionRecord } from "../store/storeTypes";

export type TopBranchSummary = {
  /** Root segment key — must match moves[].from exactly. */
  from: string;
  label: string;
  topicCount: number;
  sessionIds: string[];
  childSegments: string[];
  pathSamples: string[][];
  keywords: string[];
};

export type TrieReparentInput = {
  topBranches: TopBranchSummary[];
  segmentEquivalences: SegmentEquivalence[];
  nodes: {
    key: string;
    label: string;
    aliases?: string[];
    parentKeys?: string[];
    evidence?: string[];
  }[];
};

const MAX_KEYWORDS = 24;
const MAX_PATH_SAMPLES = 12;

function collectBranchPaths(
  node: ConceptTrieNode,
  prefix: string[],
  out: string[][]
): void {
  if (prefix.length && out.length >= MAX_PATH_SAMPLES) {
    return;
  }
  if (node.topics.length && prefix.length) {
    out.push([...prefix]);
  }
  const sorted = [...node.children.values()].sort(
    (a, b) => b.occurrences - a.occurrences || a.label.localeCompare(b.label)
  );
  for (const child of sorted) {
    if (out.length >= MAX_PATH_SAMPLES) {
      break;
    }
    collectBranchPaths(child, [...prefix, child.label], out);
  }
}

function collectKeywords(node: ConceptTrieNode, out: Set<string>): void {
  for (const loc of node.topics) {
    const title = loc.topic.title?.trim();
    if (title) {
      out.add(title.slice(0, 80));
    }
    const summary = loc.topic.summary?.trim();
    if (summary) {
      out.add(summary.slice(0, 120));
    }
    for (const item of loc.topic.items ?? []) {
      const text = item.text?.trim();
      if (text) {
        out.add(text.slice(0, 80));
      }
    }
  }
  for (const child of node.children.values()) {
    collectKeywords(child, out);
  }
}

function summarizeTopBranch(node: ConceptTrieNode): TopBranchSummary {
  const pathSamples: string[][] = [];
  collectBranchPaths(node, [node.label], pathSamples);

  const sessionIds = new Set<string>();
  let topicCount = 0;
  const walk = (n: ConceptTrieNode): void => {
    topicCount += n.topics.length;
    for (const loc of n.topics) {
      sessionIds.add(loc.record.meta.sessionId);
    }
    for (const child of n.children.values()) {
      walk(child);
    }
  };
  walk(node);

  const keywords = new Set<string>();
  collectKeywords(node, keywords);

  const childSegments = [...node.children.values()]
    .sort((a, b) => b.occurrences - a.occurrences || a.label.localeCompare(b.label))
    .map((c) => c.key)
    .slice(0, 16);

  return {
    from: node.key,
    label: node.label,
    topicCount,
    sessionIds: [...sessionIds].sort().slice(0, 20),
    childSegments,
    pathSamples,
    keywords: [...keywords].slice(0, MAX_KEYWORDS),
  };
}

function collectOntologyNodes(
  records: SessionRecord[],
  extra?: ConceptOntologyNode[]
): TrieReparentInput["nodes"] {
  const byKey = new Map<string, TrieReparentInput["nodes"][number]>();
  for (const node of extra ?? []) {
    byKey.set(segmentKeyForMerge(node.key), {
      key: node.key,
      label: node.label,
      aliases: node.aliases,
      parentKeys: node.parentKeys,
      evidence: node.evidence,
    });
  }
  for (const record of records) {
    for (const node of record.sessionAnalysis?.nodes ??
      record.treeSnapshot?.nodes ??
      []) {
      const k = segmentKeyForMerge(node.key);
      if (!byKey.has(k)) {
        byKey.set(k, {
          key: node.key,
          label: node.label,
          aliases: node.aliases,
          parentKeys: node.parentKeys,
          evidence: node.evidence,
        });
      }
    }
  }
  return [...byKey.values()].slice(0, 80);
}

/** Draft trie top branches for LLM root-reparent (post M2 segment equivalences). */
export function buildTrieReparentInput(
  records: SessionRecord[],
  opts: {
    segmentEquivalences?: SegmentEquivalence[];
    ontologyNodes?: ConceptOntologyNode[];
    projectSlug?: string;
  } = {}
): TrieReparentInput {
  const { root } = buildConceptTrieStructure(records, {
    projectSlug: opts.projectSlug,
    segmentEquivalences: opts.segmentEquivalences,
  });

  const sortedTop = [...root.children.values()].sort(
    (a, b) => b.occurrences - a.occurrences || a.label.localeCompare(b.label)
  );

  return {
    topBranches: sortedTop.map(summarizeTopBranch),
    segmentEquivalences: (opts.segmentEquivalences ?? []).slice(0, 40),
    nodes: collectOntologyNodes(records, opts.ontologyNodes),
  };
}
