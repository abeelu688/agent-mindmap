import type { ConceptOntologyNode, SegmentEquivalence } from "./types";
import type { TopicConceptPathDecision } from "../store/ontologyTypes";
import type { SessionRecord } from "../store/storeTypes";
import { segmentKeyForMerge } from "./topicGraphValidate";

/** Sibling segments at the same upstream depth with overlapping downstream. */
export type SiblingSegmentOverlapHint = {
  kind: "sibling";
  pathPrefix: string[];
  segments: string[];
  sharedDownstreamFirst: string[];
  supportingPathCount: number;
};

/** Outer/inner pair on the same chain: outer/inner/suffix vs inner/suffix. */
export type ChainSegmentOverlapHint = {
  kind: "chain";
  pathPrefix: string[];
  outerSegment: string;
  innerSegment: string;
  sharedSuffixCount: number;
  outerPathCount: number;
  innerPathCount: number;
};

/** Cross-node alias / shared-parent relationships from ontology nodes. */
export type NodeSegmentRelationshipHint = {
  kind: "node-alias" | "node-shared-parent";
  canonical: string;
  aliases: string[];
  pathPrefix: string[];
  downstreamFirst?: string[];
  evidenceKeywords: string[];
  supportingNodeCount: number;
};

export type SegmentOverlapHint =
  | SiblingSegmentOverlapHint
  | ChainSegmentOverlapHint
  | NodeSegmentRelationshipHint;

function upstreamKey(prefix: string[]): string {
  return prefix.map((s) => segmentKeyForMerge(s)).filter(Boolean).join("\0");
}

function labelForKey(
  key: string,
  topicPaths: TopicConceptPathDecision[]
): string {
  const counts = new Map<string, number>();
  for (const tp of topicPaths) {
    for (const raw of tp.conceptPath) {
      if (segmentKeyForMerge(raw) === key) {
        const label = raw.replace(/\s+/g, " ").trim().toLowerCase();
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
  }
  let best = key;
  let bestN = 0;
  for (const [label, n] of counts) {
    if (n > bestN || (n === bestN && label.length < best.length)) {
      best = label;
      bestN = n;
    }
  }
  return best;
}

function pickShorterCanonical(a: string, b: string): { canonical: string; alias: string } {
  return a.length <= b.length
    ? { canonical: a, alias: b }
    : { canonical: b, alias: a };
}

type SlotStats = {
  pathCount: number;
  downstreamFirst: Set<string>;
  downstreamSuffixes: Set<string>;
};

export function buildSiblingSegmentOverlapHints(
  topicPaths: TopicConceptPathDecision[],
  options?: {
    minSharedDownstream?: number;
    minPathsPerSegment?: number;
    maxHints?: number;
  }
): SiblingSegmentOverlapHint[] {
  const minShared = options?.minSharedDownstream ?? 1;
  const minPaths = options?.minPathsPerSegment ?? 2;
  const maxHints = options?.maxHints ?? 24;

  const byUpstream = new Map<string, Map<string, SlotStats>>();

  for (const tp of topicPaths) {
    const keys = tp.conceptPath
      .map((s) => segmentKeyForMerge(s))
      .filter(Boolean);
    for (let i = 0; i < keys.length; i++) {
      const prefix = keys.slice(0, i);
      const uKey = upstreamKey(prefix);
      const seg = keys[i];
      const slotMap = byUpstream.get(uKey) ?? new Map<string, SlotStats>();
      byUpstream.set(uKey, slotMap);
      const stats = slotMap.get(seg) ?? {
        pathCount: 0,
        downstreamFirst: new Set<string>(),
        downstreamSuffixes: new Set<string>(),
      };
      stats.pathCount += 1;
      if (i + 1 < keys.length) {
        stats.downstreamFirst.add(keys[i + 1]);
        stats.downstreamSuffixes.add(keys.slice(i + 1).join("/"));
      }
      slotMap.set(seg, stats);
    }
  }

  const hints: SiblingSegmentOverlapHint[] = [];

  for (const [uKey, slotMap] of byUpstream) {
    const pathPrefix = uKey ? uKey.split("\0") : [];
    const segments = [...slotMap.keys()];
    if (segments.length < 2) {
      continue;
    }

    for (let a = 0; a < segments.length; a++) {
      for (let b = a + 1; b < segments.length; b++) {
        const sa = slotMap.get(segments[a])!;
        const sb = slotMap.get(segments[b])!;
        if (sa.pathCount < minPaths || sb.pathCount < minPaths) {
          continue;
        }

        let sharedDownstreamFirst = [...sa.downstreamFirst].filter((d) =>
          sb.downstreamFirst.has(d)
        );
        if (!sharedDownstreamFirst.length) {
          const sharedSuffix = [...sa.downstreamSuffixes].filter((d) =>
            sb.downstreamSuffixes.has(d)
          );
          sharedDownstreamFirst = [
            ...new Set(
              sharedSuffix.map((s) => s.split("/")[0]).filter(Boolean)
            ),
          ];
        }
        if (sharedDownstreamFirst.length < minShared) {
          continue;
        }

        hints.push({
          kind: "sibling",
          pathPrefix,
          segments: [segments[a], segments[b]].sort(),
          sharedDownstreamFirst: sharedDownstreamFirst.slice(0, 8),
          supportingPathCount: sa.pathCount + sb.pathCount,
        });
      }
    }
  }

  hints.sort((a, b) => b.supportingPathCount - a.supportingPathCount);
  return hints.slice(0, maxHints);
}

/**
 * Detect outer/inner redundancy: paths outer/inner/suffix vs inner/suffix under same upstream.
 */
export function buildChainCollapseOverlapHints(
  topicPaths: TopicConceptPathDecision[],
  options?: {
    minOuterPaths?: number;
    minInnerPaths?: number;
    maxHints?: number;
  }
): ChainSegmentOverlapHint[] {
  const minOuter = options?.minOuterPaths ?? 2;
  const minInner = options?.minInnerPaths ?? 2;
  const maxHints = options?.maxHints ?? 16;

  const withOuter = new Map<string, number>();
  const innerOnly = new Map<string, number>();

  for (const tp of topicPaths) {
    const keys = tp.conceptPath
      .map((s) => segmentKeyForMerge(s))
      .filter(Boolean);
    if (keys.length >= 2) {
      const outer = keys[0];
      const rest = keys.slice(1).join("/");
      const uKey = upstreamKey([]);
      withOuter.set(`${uKey}|${outer}|${rest}`, (withOuter.get(`${uKey}|${outer}|${rest}`) ?? 0) + 1);
      innerOnly.set(`${uKey}|${rest}`, (innerOnly.get(`${uKey}|${rest}`) ?? 0) + 1);
    }
    for (let i = 1; i < keys.length - 1; i++) {
      const prefix = keys.slice(0, i);
      const outer = keys[i];
      const rest = keys.slice(i + 1).join("/");
      const uKey = upstreamKey(prefix);
      withOuter.set(`${uKey}|${outer}|${rest}`, (withOuter.get(`${uKey}|${outer}|${rest}`) ?? 0) + 1);
      innerOnly.set(`${uKey}|${rest}`, (innerOnly.get(`${uKey}|${rest}`) ?? 0) + 1);
    }
  }

  const hints: ChainSegmentOverlapHint[] = [];
  const seen = new Set<string>();

  for (const [withKey, outerPathCount] of withOuter) {
    if (outerPathCount < minOuter) {
      continue;
    }
    const parts = withKey.split("|");
    const uKey = parts[0];
    const outer = parts[1];
    const rest = parts[2];
    const innerKey = `${uKey}|${rest}`;
    const innerPathCount = innerOnly.get(innerKey) ?? 0;
    if (innerPathCount < minInner) {
      continue;
    }
    const pathPrefix = uKey ? uKey.split("\0") : [];
    const innerSegment = rest.split("/")[0];
    if (!innerSegment || innerSegment === outer) {
      continue;
    }
    const dedupe = `${pathPrefix.join("/")}|${outer}|${innerSegment}`;
    if (seen.has(dedupe)) {
      continue;
    }
    seen.add(dedupe);
    hints.push({
      kind: "chain",
      pathPrefix,
      outerSegment: outer,
      innerSegment,
      sharedSuffixCount: Math.min(outerPathCount, innerPathCount),
      outerPathCount,
      innerPathCount,
    });
  }

  hints.sort(
    (a, b) =>
      b.sharedSuffixCount - a.sharedSuffixCount ||
      b.outerPathCount + b.innerPathCount - (a.outerPathCount + a.innerPathCount)
  );
  return hints.slice(0, maxHints);
}

export function buildNodeRelationshipHints(
  nodes: ConceptOntologyNode[],
  topicPaths: TopicConceptPathDecision[]
): NodeSegmentRelationshipHint[] {
  const rootKeys = new Set<string>();
  for (const tp of topicPaths) {
    const first = tp.conceptPath[0];
    if (first) {
      rootKeys.add(segmentKeyForMerge(first));
    }
  }

  const hints: NodeSegmentRelationshipHint[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    const nodeKey = segmentKeyForMerge(node.key);
    const evidenceKeywords = (node.evidence ?? [])
      .map((e) => e.replace(/\s+/g, " ").trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 4);

    for (const alias of node.aliases ?? []) {
      const aliasKey = segmentKeyForMerge(alias);
      if (!aliasKey || aliasKey === nodeKey) {
        continue;
      }
      const target = nodes.find((n) => segmentKeyForMerge(n.key) === aliasKey);
      if (target) {
        const dedupe = `${nodeKey}|${aliasKey}`;
        if (seen.has(dedupe)) {
          continue;
        }
        seen.add(dedupe);
        const { canonical, alias: aliasLabel } = pickShorterCanonical(
          node.key,
          target.key
        );
        hints.push({
          kind: "node-alias",
          canonical: canonical.toLowerCase(),
          aliases: [aliasLabel.toLowerCase()],
          pathPrefix: [],
          evidenceKeywords: [
            ...evidenceKeywords,
            ...(target.evidence ?? []).slice(0, 2),
          ].slice(0, 6),
          supportingNodeCount: 2,
        });
        continue;
      }
      if (rootKeys.has(aliasKey)) {
        const dedupe = `root:${nodeKey}|${aliasKey}`;
        if (seen.has(dedupe)) {
          continue;
        }
        seen.add(dedupe);
        const aliasRootLabel = labelForKey(aliasKey, topicPaths);
        const { canonical, alias: aliasLabel } = pickShorterCanonical(
          node.key,
          aliasRootLabel
        );
        hints.push({
          kind: "node-alias",
          canonical: canonical.toLowerCase(),
          aliases: [aliasLabel.toLowerCase()],
          pathPrefix: [],
          evidenceKeywords: evidenceKeywords.length
            ? evidenceKeywords
            : [node.key, aliasRootLabel],
          supportingNodeCount: 1,
        });
      }
    }

    for (const parent of node.parentKeys ?? []) {
      const parentKey = segmentKeyForMerge(parent);
      if (!parentKey || parentKey === nodeKey) {
        continue;
      }
      if (!rootKeys.has(parentKey) || !rootKeys.has(nodeKey)) {
        continue;
      }
      const dedupe = `parent:${parentKey}|${nodeKey}`;
      if (seen.has(dedupe)) {
        continue;
      }
      seen.add(dedupe);
      hints.push({
        kind: "node-shared-parent",
        canonical: parent.toLowerCase(),
        aliases: [node.key.toLowerCase()],
        pathPrefix: [],
        downstreamFirst: [node.key.toLowerCase()],
        evidenceKeywords,
        supportingNodeCount: 1,
      });
    }
  }

  return hints;
}

export function buildAllSegmentOverlapHints(
  topicPaths: TopicConceptPathDecision[],
  nodes: ConceptOntologyNode[] = []
): SegmentOverlapHint[] {
  return [
    ...buildSiblingSegmentOverlapHints(topicPaths),
    ...buildChainCollapseOverlapHints(topicPaths),
    ...buildNodeRelationshipHints(nodes, topicPaths),
  ];
}

export function collectSessionSegmentEquivalences(
  records: SessionRecord[]
): SegmentEquivalence[] {
  const out: SegmentEquivalence[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const equivs =
      record.sessionAnalysis?.segmentEquivalences ??
      record.sessionSynonyms?.segmentEquivalences ??
      [];
    for (const eq of equivs) {
      const key = `${eq.canonical}|${(eq.aliases ?? []).join(",")}|${(eq.scope.pathPrefix ?? []).join("/")}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(eq);
    }
  }
  return out;
}

function equivalenceKey(eq: SegmentEquivalence): string {
  const aliases = (eq.aliases ?? [])
    .map((a) => segmentKeyForMerge(a))
    .sort()
    .join(",");
  const prefix = (eq.scope.pathPrefix ?? [])
    .map((p) => segmentKeyForMerge(p))
    .join("/");
  const down = (eq.scope.downstreamFirst ?? [])
    .map((d) => segmentKeyForMerge(d))
    .join(",");
  return `${segmentKeyForMerge(eq.canonical)}|${aliases}|${prefix}|${down}`;
}

export function mergeSegmentEquivalencesLists(
  ...groups: SegmentEquivalence[][]
): SegmentEquivalence[] {
  const out: SegmentEquivalence[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const eq of group) {
      const key = equivalenceKey(eq);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(eq);
    }
  }
  return out;
}

export function deriveEquivalencesFromOverlapHints(
  hints: SegmentOverlapHint[],
  topicPaths: TopicConceptPathDecision[],
  options?: { minSiblingSupport?: number; minChainSupport?: number }
): SegmentEquivalence[] {
  const minSibling = options?.minSiblingSupport ?? 4;
  const minChain = options?.minChainSupport ?? 3;
  const out: SegmentEquivalence[] = [];

  for (const hint of hints) {
    if (hint.kind === "sibling") {
      if (hint.supportingPathCount < minSibling) {
        continue;
      }
      const [aKey, bKey] = hint.segments;
      const aLabel = labelForKey(aKey, topicPaths);
      const bLabel = labelForKey(bKey, topicPaths);
      const { canonical, alias } = pickShorterCanonical(aLabel, bLabel);
      const downstreamFirst = hint.sharedDownstreamFirst
        .slice(0, 3)
        .map((k) => labelForKey(k, topicPaths));
      out.push({
        canonical,
        aliases: [alias],
        scope: {
          pathPrefix: hint.pathPrefix.map((k) => labelForKey(k, topicPaths)),
          downstreamFirst: downstreamFirst.length ? downstreamFirst : undefined,
          evidenceKeywords: downstreamFirst.length
            ? downstreamFirst
            : [aLabel, bLabel],
        },
        confidence: Math.min(0.95, 0.75 + hint.supportingPathCount * 0.02),
        rationale: "DET sibling overlap hint",
      });
      continue;
    }

    if (hint.kind === "chain") {
      if (
        hint.outerPathCount < minChain ||
        hint.innerPathCount < minChain
      ) {
        continue;
      }
      const innerLabel = labelForKey(hint.innerSegment, topicPaths);
      const outerLabel = labelForKey(hint.outerSegment, topicPaths);
      out.push({
        canonical: innerLabel,
        aliases: [outerLabel],
        scope: {
          pathPrefix: hint.pathPrefix.map((k) => labelForKey(k, topicPaths)),
          downstreamFirst: [innerLabel],
          evidenceKeywords: [innerLabel, outerLabel],
        },
        confidence: Math.min(
          0.94,
          0.78 + hint.sharedSuffixCount * 0.03
        ),
        rationale: "DET chain collapse hint",
      });
      continue;
    }

    if (hint.kind === "node-alias" || hint.kind === "node-shared-parent") {
      out.push({
        canonical: hint.canonical,
        aliases: hint.aliases,
        scope: {
          pathPrefix: hint.pathPrefix,
          downstreamFirst: hint.downstreamFirst,
          evidenceKeywords: hint.evidenceKeywords.length
            ? hint.evidenceKeywords
            : [hint.canonical, ...hint.aliases],
        },
        confidence: 0.82,
        rationale: `DET ${hint.kind} hint`,
      });
    }
  }

  return out;
}

export function deriveEquivalencesFromTopicPaths(
  topicPaths: TopicConceptPathDecision[],
  nodes: ConceptOntologyNode[] = [],
  options?: { minSiblingSupport?: number; minChainSupport?: number }
): SegmentEquivalence[] {
  const hints = buildAllSegmentOverlapHints(topicPaths, nodes);
  return deriveEquivalencesFromOverlapHints(hints, topicPaths, {
    minSiblingSupport: options?.minSiblingSupport ?? 2,
    minChainSupport: options?.minChainSupport ?? 2,
  });
}

/** LLM + session equivalences merged with DET overlap rules (post-LLM pass). */
export function enhanceSegmentEquivalencesForMerge(
  topicPaths: TopicConceptPathDecision[],
  nodes: ConceptOntologyNode[],
  ...groups: SegmentEquivalence[][]
): SegmentEquivalence[] {
  return mergeSegmentEquivalencesLists(
    deriveEquivalencesFromTopicPaths(topicPaths, nodes),
    ...groups
  );
}
