import type { TopicConceptPathDecision } from "../store/ontologyTypes";
import {
  buildChainCollapseOverlapHints,
  deriveEquivalencesFromOverlapHints,
  mergeSegmentEquivalencesLists,
} from "./synonymHintDerive";
import type { CatalogChainInput } from "./reattachNodeCatalog";
import type { ConceptOntologyNode, SegmentEquivalence } from "./types";
import { segmentKeyForMerge } from "./topicGraphValidate";

export type DuplicateTopRootHint = {
  kind: "duplicate_top_root";
  /** Chain that already lists the duplicate as a direct child segment */
  parentChainFrom: string;
  /** Parallel top-level chain that should merge into parent */
  duplicateTopFrom: string;
  parentNodeId?: string;
  duplicateTopNodeId?: string;
};

export type ListedChildCollapseHint = {
  kind: "listed_child_collapse";
  chainFrom: string;
  childSegment: string;
  canonical: string;
  aliases: string[];
};

export type OntologySubordinateHint = {
  kind: "ontology_subordinate";
  specialistFrom: string;
  hubFrom: string;
  specialistNodeId?: string;
  hubNodeId?: string;
};

/** Top root whose merge key extends a shorter top root (e.g. androidapp → android). */
export type PrefixSubordinateHint = {
  kind: "prefix_subordinate";
  specialistFrom: string;
  hubFrom: string;
  specialistNodeId?: string;
  hubNodeId?: string;
};

export type StructuralReattachHints = {
  duplicateTopRoots: DuplicateTopRootHint[];
  listedChildCollapses: ListedChildCollapseHint[];
  ontologySubordinates: OntologySubordinateHint[];
  prefixSubordinates: PrefixSubordinateHint[];
};

/** Minimum hub merge-key length to avoid spurious art→artificial-style matches. */
const PREFIX_HUB_MIN_KEY_LEN = 4;

function aliasKeysFor(eq: SegmentEquivalence): string[] {
  const keys = new Set<string>();
  keys.add(segmentKeyForMerge(eq.canonical));
  for (const alias of eq.aliases ?? []) {
    keys.add(segmentKeyForMerge(alias));
  }
  return [...keys];
}

export function segmentsInSameEquivalenceGroup(
  aKey: string,
  bKey: string,
  equivalences: SegmentEquivalence[] | undefined
): boolean {
  if (!aKey || !bKey || aKey === bKey) {
    return true;
  }
  if (!equivalences?.length) {
    return false;
  }
  for (const eq of equivalences) {
    const group = aliasKeysFor(eq);
    if (group.includes(aKey) && group.includes(bKey)) {
      return true;
    }
  }
  return false;
}

function nodeMatchesSegmentKey(
  node: ConceptOntologyNode,
  segmentKey: string
): boolean {
  if (segmentKeyForMerge(node.key) === segmentKey) {
    return true;
  }
  return (node.aliases ?? []).some(
    (a) => segmentKeyForMerge(a) === segmentKey
  );
}

/** Ontology node aliases / parentKeys → scoped parent/child segment equivalences. */
export function deriveEquivalencesFromOntologyNodes(
  chains: CatalogChainInput[],
  nodes: ConceptOntologyNode[] | undefined,
  existing: SegmentEquivalence[]
): SegmentEquivalence[] {
  if (!nodes?.length) {
    return [];
  }

  const out: SegmentEquivalence[] = [];
  const seen = new Set<string>();

  for (const chain of chains) {
    const rootKey = segmentKeyForMerge(chain.from);
    const rootNode = nodes.find((n) => nodeMatchesSegmentKey(n, rootKey));
    if (!rootNode) {
      continue;
    }

    for (const child of chain.childSegments) {
      const childKey = segmentKeyForMerge(child);
      if (!childKey || childKey === rootKey) {
        continue;
      }

      const childNode = nodes.find((n) => nodeMatchesSegmentKey(n, childKey));
      const aliasLink =
        (rootNode.aliases ?? []).some(
          (a) => segmentKeyForMerge(a) === childKey
        ) ||
        (childNode?.aliases ?? []).some(
          (a) => segmentKeyForMerge(a) === rootKey
        );
      const parentLink =
        childNode?.parentKeys?.some(
          (pk) => segmentKeyForMerge(pk) === rootKey
        ) ?? false;

      if (!aliasLink && !parentLink) {
        continue;
      }
      if (segmentsInSameEquivalenceGroup(rootKey, childKey, existing)) {
        continue;
      }

      const dedupe = `${rootKey}|${childKey}|${chain.from}`;
      if (seen.has(dedupe)) {
        continue;
      }
      seen.add(dedupe);

      out.push({
        canonical: chain.from,
        aliases: [child],
        scope: { pathPrefix: [chain.from] },
        confidence: 0.86,
        rationale: "ontology node alias or parentKeys vs chain childSegments",
      });
    }
  }

  return out;
}

export function buildDuplicateTopRootHints(
  chains: CatalogChainInput[]
): DuplicateTopRootHint[] {
  const topByKey = new Map(
    chains.map((c) => [segmentKeyForMerge(c.from), c] as const)
  );
  const hints: DuplicateTopRootHint[] = [];
  const seen = new Set<string>();

  for (const parent of chains) {
    const parentKey = segmentKeyForMerge(parent.from);
    for (const child of parent.childSegments) {
      const childKey = segmentKeyForMerge(child);
      const duplicate = topByKey.get(childKey);
      if (!duplicate || duplicate.from === parent.from) {
        continue;
      }
      const id = `${parent.from}|${duplicate.from}`;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      hints.push({
        kind: "duplicate_top_root",
        parentChainFrom: parent.from,
        duplicateTopFrom: duplicate.from,
      });
    }
  }

  return hints.slice(0, 16);
}

export function buildListedChildCollapseHints(
  chains: CatalogChainInput[],
  equivalences: SegmentEquivalence[] | undefined
): ListedChildCollapseHint[] {
  const hints: ListedChildCollapseHint[] = [];
  const seen = new Set<string>();

  for (const chain of chains) {
    const rootKey = segmentKeyForMerge(chain.from);
    for (const child of chain.childSegments) {
      const childKey = segmentKeyForMerge(child);
      if (!childKey || childKey === rootKey) {
        continue;
      }
      if (!segmentsInSameEquivalenceGroup(rootKey, childKey, equivalences)) {
        continue;
      }
      const nested = chain.pathSamples.some(
        (p) =>
          p.length >= 2 &&
          segmentKeyForMerge(p[0]) === rootKey &&
          segmentKeyForMerge(p[1]) === childKey
      );
      if (!nested) {
        continue;
      }
      const id = `${chain.from}|${child}`;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const eq = equivalences?.find((e) => {
        const g = aliasKeysFor(e);
        return g.includes(rootKey) && g.includes(childKey);
      });
      hints.push({
        kind: "listed_child_collapse",
        chainFrom: chain.from,
        childSegment: child,
        canonical: eq?.canonical ?? chain.from,
        aliases: eq?.aliases ?? [child],
      });
    }
  }

  return hints.slice(0, 24);
}

/**
 * Domain-agnostic: specialist top root merge key extends hub key (android-app → android).
 */
export function buildPrefixSubordinateHints(
  chains: CatalogChainInput[]
): PrefixSubordinateHint[] {
  if (chains.length < 2) {
    return [];
  }

  const tops = chains.map((c) => ({
    from: c.from,
    key: segmentKeyForMerge(c.from),
  }));
  const hints: PrefixSubordinateHint[] = [];
  const seen = new Set<string>();

  for (const spec of tops) {
    if (!spec.key || spec.key.length <= PREFIX_HUB_MIN_KEY_LEN) {
      continue;
    }
    const hub = tops
      .filter(
        (h) =>
          h.key !== spec.key &&
          h.key.length >= PREFIX_HUB_MIN_KEY_LEN &&
          spec.key.startsWith(h.key) &&
          spec.key.length > h.key.length
      )
      .sort((a, b) => a.key.length - b.key.length)[0];
    if (!hub) {
      continue;
    }
    const id = `${spec.from}|${hub.from}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    hints.push({
      kind: "prefix_subordinate",
      specialistFrom: spec.from,
      hubFrom: hub.from,
    });
  }

  return hints.slice(0, 24);
}

export function buildOntologySubordinateHints(
  chains: CatalogChainInput[],
  nodes: ConceptOntologyNode[] | undefined
): OntologySubordinateHint[] {
  if (!nodes?.length || chains.length < 2) {
    return [];
  }

  const chainByKey = new Map(
    chains.map((c) => [segmentKeyForMerge(c.from), c] as const)
  );
  const hints: OntologySubordinateHint[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    const specKey = segmentKeyForMerge(node.key);
    const specChain = chainByKey.get(specKey);
    if (!specChain) {
      continue;
    }
    for (const pk of node.parentKeys ?? []) {
      const hubKey = segmentKeyForMerge(pk);
      const hubChain = chainByKey.get(hubKey);
      if (!hubChain || hubChain.from === specChain.from) {
        continue;
      }
      const id = `${specChain.from}|${hubChain.from}`;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      hints.push({
        kind: "ontology_subordinate",
        specialistFrom: specChain.from,
        hubFrom: hubChain.from,
      });
    }
  }

  return hints.slice(0, 16);
}

export function buildStructuralReattachHints(
  chains: CatalogChainInput[],
  nodes: ConceptOntologyNode[] | undefined,
  equivalences: SegmentEquivalence[] | undefined,
  topicPaths?: TopicConceptPathDecision[]
): StructuralReattachHints {
  return {
    duplicateTopRoots: buildDuplicateTopRootHints(chains),
    listedChildCollapses: buildListedChildCollapseHints(chains, equivalences),
    ontologySubordinates: buildOntologySubordinateHints(chains, nodes),
    prefixSubordinates: buildPrefixSubordinateHints(chains),
  };
}

/** Map structural hints to nodeCatalog root ids (for M2.5 prompt). */
export function enrichStructuralHintsWithNodeIds(
  hints: StructuralReattachHints,
  rootNodeIdByFrom: Map<string, string>
): StructuralReattachHints {
  const rootId = (from: string) =>
    rootNodeIdByFrom.get(segmentKeyForMerge(from));

  return {
    duplicateTopRoots: hints.duplicateTopRoots.map((h) => ({
      ...h,
      parentNodeId: rootId(h.parentChainFrom),
      duplicateTopNodeId: rootId(h.duplicateTopFrom),
    })),
    listedChildCollapses: hints.listedChildCollapses,
    ontologySubordinates: hints.ontologySubordinates.map((h) => ({
      ...h,
      hubNodeId: rootId(h.hubFrom),
      specialistNodeId: rootId(h.specialistFrom),
    })),
    prefixSubordinates: hints.prefixSubordinates.map((h) => ({
      ...h,
      hubNodeId: rootId(h.hubFrom),
      specialistNodeId: rootId(h.specialistFrom),
    })),
  };
}

/** DET chain collapse + ontology-listed children → extra scoped equivalences before M2.5/M3. */
export function deriveSegmentEquivalencesFromReattachStructure(
  chains: CatalogChainInput[],
  topicPaths: TopicConceptPathDecision[] | undefined,
  nodes: ConceptOntologyNode[] | undefined,
  existing: SegmentEquivalence[]
): SegmentEquivalence[] {
  const groups: SegmentEquivalence[][] = [];

  if (topicPaths?.length) {
    const chainHints = buildChainCollapseOverlapHints(topicPaths, {
      minOuterPaths: 2,
      minInnerPaths: 2,
      maxHints: 20,
    });
    if (chainHints.length) {
      groups.push(
        deriveEquivalencesFromOverlapHints(chainHints, topicPaths, {
          minChainSupport: 2,
        })
      );
    }
  }

  groups.push(
    deriveEquivalencesFromOntologyNodes(chains, nodes, existing)
  );

  return mergeSegmentEquivalencesLists(...groups);
}
