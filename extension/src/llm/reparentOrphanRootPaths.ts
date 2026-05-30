import type { ConceptOntologyNode } from "./types";
import type { TopicConceptPathDecision } from "../store/ontologyTypes";
import { segmentKeyForMerge } from "./topicGraphValidate";

/** Reparent root paths [S, …] → [parent, S, …] when nested paths exist. */
export type OrphanRootReparentRule = {
  segmentKey: string;
  parentKey: string;
  parentLabel: string;
  nestedPathCount: number;
  rootPathCount: number;
  sharedSuffixCount: number;
};

function labelForSegmentKey(
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

function suffixKey(keys: string[]): string {
  return keys.map((s) => segmentKeyForMerge(s)).join("/");
}

function suffixesOverlap(a: string, b: string): boolean {
  if (!a || !b) {
    return a === b;
  }
  if (a === b) {
    return true;
  }
  const a0 = a.split("/")[0];
  const b0 = b.split("/")[0];
  return Boolean(a0 && b0 && a0 === b0);
}

function ontologyParentBoost(
  nodes: ConceptOntologyNode[],
  segmentKey: string,
  parentKey: string
): number {
  let boost = 0;
  for (const node of nodes) {
    if (segmentKeyForMerge(node.key) !== segmentKey) {
      continue;
    }
    for (const pk of node.parentKeys ?? []) {
      if (segmentKeyForMerge(pk) === parentKey) {
        boost += 4;
      }
    }
    for (const alias of node.aliases ?? []) {
      if (segmentKeyForMerge(alias) === parentKey) {
        boost += 2;
      }
    }
  }
  const parentNode = nodes.find(
    (n) => segmentKeyForMerge(n.key) === parentKey
  );
  if (parentNode) {
    for (const pk of parentNode.parentKeys ?? []) {
      if (segmentKeyForMerge(pk) === segmentKey) {
        boost += 1;
      }
    }
  }
  return boost;
}

/**
 * When segment S appears as trie root ([S, suffix]) and under parent P ([P, S, suffix])
 * with overlapping downstream, prefer nesting under P (domain-aligned reparent).
 */
export function buildOrphanRootReparentRules(
  topicPaths: TopicConceptPathDecision[],
  nodes: ConceptOntologyNode[] = [],
  options?: {
    minNestedPaths?: number;
    minRootPaths?: number;
    minSharedSuffixPaths?: number;
  }
): OrphanRootReparentRule[] {
  const minNested = options?.minNestedPaths ?? 2;
  const minRoot = options?.minRootPaths ?? 1;
  const minShared = options?.minSharedSuffixPaths ?? 1;

  type RootBucket = Map<string, number>;
  /** parentKey → suffixKey → count */
  type ParentsForSegment = Map<string, Map<string, number>>;

  const rootBySegment = new Map<string, RootBucket>();
  const nestedByParent = new Map<string, ParentsForSegment>();

  for (const tp of topicPaths) {
    const keys = tp.conceptPath
      .map((s) => segmentKeyForMerge(s))
      .filter(Boolean);
    if (!keys.length) {
      continue;
    }
    const seg = keys[0];
    const rootSuffix = suffixKey(keys.slice(1));
    const rootBucket = rootBySegment.get(seg) ?? new Map<string, number>();
    rootBucket.set(rootSuffix, (rootBucket.get(rootSuffix) ?? 0) + 1);
    rootBySegment.set(seg, rootBucket);

    if (keys.length >= 2) {
      const parent = keys[0];
      const inner = keys[1];
      const nestedSuffix = suffixKey(keys.slice(2));
      let parentMap = nestedByParent.get(inner);
      if (!parentMap) {
        parentMap = new Map<string, Map<string, number>>();
        nestedByParent.set(inner, parentMap);
      }
      let bucket = parentMap.get(parent);
      if (!bucket) {
        bucket = new Map<string, number>();
        parentMap.set(parent, bucket);
      }
      bucket.set(nestedSuffix, (bucket.get(nestedSuffix) ?? 0) + 1);
    }
  }

  const rules: OrphanRootReparentRule[] = [];
  const chosenParent = new Map<string, OrphanRootReparentRule>();

  for (const [segmentKey, rootSuffixes] of rootBySegment) {
    const parentMap = nestedByParent.get(segmentKey);
    if (!parentMap?.size) {
      continue;
    }

    const rootPathCount = [...rootSuffixes.values()].reduce((a, b) => a + b, 0);
    if (rootPathCount < minRoot) {
      continue;
    }

    let best: OrphanRootReparentRule | undefined;

    for (const [parentKey, nestedSuffixes] of parentMap) {
      const nestedPathCount = [...nestedSuffixes.values()].reduce(
        (a, b) => a + b,
        0
      );
      if (nestedPathCount < minNested) {
        continue;
      }

      let sharedSuffixCount = 0;
      for (const [rootSuffix, rootCount] of rootSuffixes) {
        for (const [nestedSuffix, nestedCount] of nestedSuffixes) {
          if (suffixesOverlap(rootSuffix, nestedSuffix)) {
            sharedSuffixCount += Math.min(rootCount, nestedCount);
          }
        }
      }
      if (sharedSuffixCount < minShared) {
        continue;
      }

      const score =
        sharedSuffixCount * 3 +
        nestedPathCount +
        ontologyParentBoost(nodes, segmentKey, parentKey);

      const candidate: OrphanRootReparentRule = {
        segmentKey,
        parentKey,
        parentLabel: labelForSegmentKey(parentKey, topicPaths),
        nestedPathCount,
        rootPathCount,
        sharedSuffixCount,
      };

      if (
        !best ||
        score >
          best.sharedSuffixCount * 3 +
            best.nestedPathCount +
            ontologyParentBoost(nodes, best.segmentKey, best.parentKey)
      ) {
        best = candidate;
      }
    }

    if (best) {
      chosenParent.set(segmentKey, best);
    }
  }

  for (const rule of chosenParent.values()) {
    rules.push(rule);
  }

  rules.sort(
    (a, b) =>
      b.sharedSuffixCount - a.sharedSuffixCount ||
      b.nestedPathCount - a.nestedPathCount
  );
  return rules;
}

export function rulesToReparentMap(
  rules: OrphanRootReparentRule[]
): Map<string, OrphanRootReparentRule> {
  return new Map(rules.map((r) => [r.segmentKey, r]));
}

/**
 * Rewrite [S, …suffix] → [parent, S, …suffix] when a reparent rule exists for S.
 */
export function applyOrphanRootReparent(
  path: string[],
  rules: Map<string, OrphanRootReparentRule>
): string[] {
  if (path.length < 1 || !rules.size) {
    return path;
  }
  const segKey = segmentKeyForMerge(path[0]);
  const rule = rules.get(segKey);
  if (!rule) {
    return path;
  }
  if (segmentKeyForMerge(path[0]) === rule.parentKey) {
    return path;
  }
  if (
    path.length >= 2 &&
    segmentKeyForMerge(path[1]) === segKey &&
    segmentKeyForMerge(path[0]) === rule.parentKey
  ) {
    return path;
  }
  return [rule.parentLabel, ...path];
}

export function applyOrphanRootReparentToPaths(
  paths: string[][],
  rules: OrphanRootReparentRule[]
): string[][] {
  const map = rulesToReparentMap(rules);
  return paths.map((p) => applyOrphanRootReparent(p, map));
}
