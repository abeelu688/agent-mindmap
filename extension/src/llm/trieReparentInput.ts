import {
  buildConceptTrieStructure,
  type ConceptTrieNode,
} from "../store/mergeConceptTrie";
import { collectConceptContextsForMerge } from "./buildConceptContexts";
import type { ConceptContextForMerge, SessionRecord } from "../store/storeTypes";
import { segmentKeyForMerge } from "./topicGraphValidate";
import {
  buildReattachNodeCatalog,
  type ReattachNodeCatalog,
} from "./reattachNodeCatalog";
import {
  buildStructuralReattachHints,
  enrichStructuralHintsWithNodeIds,
  type StructuralReattachHints,
} from "./reattachStructuralHints";
import type { ConceptOntologyNode, SegmentEquivalence } from "./types";
import type { TopicConceptPathDecision } from "../store/ontologyTypes";

export type { ReattachNodeCatalog, StructuralReattachHints };

/** Nested concept segment under a top-level chain root (for LLM subtree context). */
export type ChainSubtreeNode = {
  segment: string;
  label: string;
  topicCount: number;
  childSegments: string[];
  children: ChainSubtreeNode[];
};

/** One parallel root branch = one chain / one tree in the draft mind map. */
export type ReparentChain = {
  /** 1-based order; process chain₁ before chain₂ when applying rules. */
  chainIndex: number;
  /** Root segment key — must match moves[].from exactly. */
  from: string;
  label: string;
  topicCount: number;
  sessionIds: string[];
  childSegments: string[];
  pathSamples: string[][];
  keywords: string[];
  /** Concept segment tree under this root (depth-limited). */
  subtree: ChainSubtreeNode;
};

/** @deprecated Alias for ReparentChain */
export type TopBranchSummary = ReparentChain;

function aliasKeysForEquivalence(eq: SegmentEquivalence): string[] {
  const keys = new Set<string>();
  keys.add(segmentKeyForMerge(eq.canonical));
  for (const alias of eq.aliases ?? []) {
    keys.add(segmentKeyForMerge(alias));
  }
  return [...keys];
}

export type RootChildSynonymHint = {
  /** Top branch key from topBranches[].from */
  branchFrom: string;
  /** Direct child segment under that branch */
  childSegment: string;
  canonical: string;
  aliases: string[];
  scopePathPrefix?: string[];
  confidence?: number;
};

/**
 * Hints from M2 segmentEquivalences: a branch root and one of its childSegments
 * both appear in the same equivalence group (ontology-driven, not hardcoded names).
 */
export function buildRootChildSynonymHints(
  branches: TopBranchSummary[],
  equivalences: SegmentEquivalence[] | undefined
): RootChildSynonymHint[] {
  if (!equivalences?.length) {
    return [];
  }

  const hints: RootChildSynonymHint[] = [];
  for (const branch of branches) {
    const branchKey = segmentKeyForMerge(branch.from);
    for (const child of branch.childSegments) {
      const childKey = segmentKeyForMerge(child);
      if (childKey === branchKey) {
        continue;
      }
      for (const eq of equivalences) {
        const aliasKeys = aliasKeysForEquivalence(eq);
        const prefix = (eq.scope.pathPrefix ?? []).map((s) =>
          segmentKeyForMerge(s)
        );
        if (prefix.length && !prefix.includes(branchKey)) {
          continue;
        }
        const branchIn =
          aliasKeys.includes(branchKey) ||
          segmentKeyForMerge(eq.canonical) === branchKey;
        const childIn =
          aliasKeys.includes(childKey) ||
          segmentKeyForMerge(eq.canonical) === childKey;
        if (!branchIn || !childIn) {
          continue;
        }
        hints.push({
          branchFrom: branch.from,
          childSegment: child,
          canonical: eq.canonical,
          aliases: eq.aliases ?? [],
          scopePathPrefix: eq.scope.pathPrefix,
          confidence: eq.confidence,
        });
      }
    }
  }
  return hints.slice(0, 32);
}

export type TopBranchSynonymHint = {
  canonical: string;
  aliases: string[];
  /** Top-level branch keys in the same M2 equivalence group */
  branches: string[];
  confidence?: number;
};

/** Multiple topBranches[].from in one segmentEquivalences group (ontology-driven). */
export function buildTopBranchSynonymHints(
  branches: TopBranchSummary[],
  equivalences: SegmentEquivalence[] | undefined
): TopBranchSynonymHint[] {
  if (!equivalences?.length || branches.length < 2) {
    return [];
  }

  const hints: TopBranchSynonymHint[] = [];
  for (const eq of equivalences) {
    const aliasKeys = aliasKeysForEquivalence(eq);
    const matched = branches.filter((b) => {
      const k = segmentKeyForMerge(b.from);
      return (
        aliasKeys.includes(k) || segmentKeyForMerge(eq.canonical) === k
      );
    });
    if (matched.length < 2) {
      continue;
    }
    hints.push({
      canonical: eq.canonical,
      aliases: eq.aliases ?? [],
      branches: matched.map((m) => m.from),
      confidence: eq.confidence,
    });
  }
  return hints.slice(0, 24);
}

export type TrieReparentInput = {
  /** Part I per-node context for M-merge LLM (domain, parent, child, evidence). */
  conceptContexts: ConceptContextForMerge[];
  /** Each entry = one parallel top-level tree (chain). */
  chains: ReparentChain[];
  /** @deprecated Use chains */
  topBranches: ReparentChain[];
  segmentEquivalences: SegmentEquivalence[];
  /** Branch root + child segment in same M2 equivalence group — for LLM (A) reasoning. */
  rootChildSynonymHints: RootChildSynonymHint[];
  /** Multiple top-level branches in same M2 equivalence group. */
  topBranchSynonymHints: TopBranchSynonymHint[];
  /** Domain-agnostic structure from chains + ontology + paths (for M2.5). */
  structuralHints: StructuralReattachHints;
  /** N1…Nn index + id-annotated trees (LLM must reference these ids in steps). */
  nodeCatalog: ReattachNodeCatalog;
  nodes: {
    key: string;
    label: string;
    aliases?: string[];
    parentKeys?: string[];
    childKeys?: string[];
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

const SUBTREE_MAX_DEPTH = 4;
const SUBTREE_MAX_CHILDREN = 12;

function summarizeSubtreeNode(
  node: ConceptTrieNode,
  depth: number
): ChainSubtreeNode {
  const sorted = [...node.children.values()]
    .sort((a, b) => b.occurrences - a.occurrences || a.label.localeCompare(b.label))
    .slice(0, SUBTREE_MAX_CHILDREN);
  return {
    segment: node.key,
    label: node.label,
    topicCount: node.topics.length,
    childSegments: sorted.map((c) => c.key),
    children:
      depth < SUBTREE_MAX_DEPTH
        ? sorted.map((c) => summarizeSubtreeNode(c, depth + 1))
        : [],
  };
}

function summarizeTopBranch(
  node: ConceptTrieNode,
  chainIndex: number
): ReparentChain {
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
    chainIndex,
    from: node.key,
    label: node.label,
    topicCount,
    sessionIds: [...sessionIds].sort().slice(0, 20),
    childSegments,
    pathSamples,
    keywords: [...keywords].slice(0, MAX_KEYWORDS),
    subtree: summarizeSubtreeNode(node, 0),
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
      childKeys: node.childKeys,
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
          childKeys: node.childKeys,
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
    topicPaths?: TopicConceptPathDecision[];
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

  const chains = sortedTop.map((node, i) => summarizeTopBranch(node, i + 1));
  const segmentEquivalences = (opts.segmentEquivalences ?? []).slice(0, 40);
  const nodeCatalog = buildReattachNodeCatalog(chains);
  const rootNodeIdByFrom = new Map(
    nodeCatalog.numberedChains.map(
      (c) => [segmentKeyForMerge(c.from), c.rootNodeId] as const
    )
  );
  const structuralHints = enrichStructuralHintsWithNodeIds(
    buildStructuralReattachHints(
      chains,
      opts.ontologyNodes,
      opts.segmentEquivalences,
      opts.topicPaths
    ),
    rootNodeIdByFrom
  );

  return {
    conceptContexts: collectConceptContextsForMerge(records),
    chains,
    topBranches: chains,
    nodeCatalog,
    segmentEquivalences,
    rootChildSynonymHints: buildRootChildSynonymHints(
      chains,
      opts.segmentEquivalences
    ),
    topBranchSynonymHints: buildTopBranchSynonymHints(
      chains,
      opts.segmentEquivalences
    ),
    structuralHints,
    nodes: collectOntologyNodes(records, opts.ontologyNodes),
  };
}
