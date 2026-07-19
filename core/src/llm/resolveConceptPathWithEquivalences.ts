import { normalizeConceptPath } from "./normalizeConceptPath";
import { segmentKeyForMerge } from "./topicGraphValidate";
import type { SegmentEquivalence } from "./types";

export type TopicPathContext = {
  title?: string;
  summary?: string;
  items?: string[];
  projectSlug?: string;
};

const DEFAULT_MIN_CONFIDENCE = 0.5;

/**
 * True if `prefix` appears as a contiguous block at the start of `pathKeys`.
 * Used for downstreamPrefix (must immediately follow the alias).
 */
function pathPrefixMatches(pathKeys: string[], prefix?: string[]): boolean {
  if (!prefix?.length) {
    return true;
  }
  if (pathKeys.length < prefix.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i++) {
    if (pathKeys[i] !== segmentKeyForMerge(prefix[i])) {
      return false;
    }
  }
  return true;
}

/**
 * True if `prefix` appears as a contiguous block anywhere in pathKeys[0..endIndex).
 * Relaxed semantics: prefix just needs to be before the alias, not at position 0.
 */
function pathPrefixAppearsBefore(pathKeys: string[], endIndex: number, prefix?: string[]): boolean {
  if (!prefix?.length) {
    return true;
  }
  if (endIndex < prefix.length) {
    return false;
  }
  const prefixKeys = prefix.map((s) => segmentKeyForMerge(s));
  for (let i = 0; i <= endIndex - prefix.length; i++) {
    let match = true;
    for (let k = 0; k < prefix.length; k++) {
      if (pathKeys[i + k] !== prefixKeys[k]) {
        match = false;
        break;
      }
    }
    if (match) {
      return true;
    }
  }
  return false;
}

function evidenceMatches(ctx: TopicPathContext, keywords?: string[]): boolean {
  if (!keywords?.length) {
    return true;
  }
  const blob = [ctx.title ?? "", ctx.summary ?? "", ...(ctx.items ?? []).map((i) => i)]
    .join(" ")
    .toLowerCase();
  return keywords.some((k) => blob.includes(k.toLowerCase()));
}

function downstreamFirstMatches(afterKeys: string[], allowed?: string[]): boolean {
  if (!allowed?.length) {
    return true;
  }
  if (!afterKeys.length) {
    return false;
  }
  const first = afterKeys[0];
  const allowedKeys = new Set(allowed.map((s) => segmentKeyForMerge(s)));
  return allowedKeys.has(first);
}

function projectMatches(ctx: TopicPathContext, slugs?: string[]): boolean {
  if (!slugs?.length) {
    return true;
  }
  if (!ctx.projectSlug) {
    return false;
  }
  return slugs.includes(ctx.projectSlug);
}

function equivalenceApplies(
  eq: SegmentEquivalence,
  pathKeys: string[],
  segmentIndex: number,
  ctx: TopicPathContext,
  minConfidence: number
): boolean {
  if ((eq.confidence ?? 1) < minConfidence) {
    return false;
  }
  if (!pathPrefixAppearsBefore(pathKeys, segmentIndex, eq.scope.pathPrefix)) {
    return false;
  }
  const afterKeys = pathKeys.slice(segmentIndex + 1);
  if (!pathPrefixMatches(afterKeys, eq.scope.downstreamPrefix)) {
    return false;
  }
  if (!downstreamFirstMatches(afterKeys, eq.scope.downstreamFirst)) {
    return false;
  }
  if (!projectMatches(ctx, eq.scope.projectSlugs)) {
    return false;
  }
  if (!evidenceMatches(ctx, eq.scope.evidenceKeywords)) {
    return false;
  }
  return true;
}

function aliasKeysFor(eq: SegmentEquivalence): string[] {
  const keys = new Set<string>();
  keys.add(segmentKeyForMerge(eq.canonical));
  for (const a of eq.aliases ?? []) {
    keys.add(segmentKeyForMerge(a));
  }
  return [...keys];
}

/**
 * Find the starting index of the first contiguous occurrence of `prefixKeys` in `keys`,
 * or -1 if not present.
 */
function findPrefixBlock(keys: string[], prefixKeys: string[]): number {
  if (!prefixKeys.length || keys.length < prefixKeys.length) {
    return -1;
  }
  for (let i = 0; i <= keys.length - prefixKeys.length; i++) {
    let match = true;
    for (let k = 0; k < prefixKeys.length; k++) {
      if (keys[i + k] !== prefixKeys[k]) {
        match = false;
        break;
      }
    }
    if (match) {
      return i;
    }
  }
  return -1;
}

/**
 * Reorder path so each equivalence's pathPrefix block precedes its alias.
 * Models constraints as DAG edges (prefix chain -> alias) and runs a stable
 * topological sort. Cycles (mutually conflicting rules) are detected via
 * Kahn's algorithm; cyclic nodes keep their original relative order.
 *
 * Relaxed semantics vs. the old iterative fixpoint: prefix just needs to be
 * somewhere before the alias, not pinned to position 0. This lets more
 * equivalences apply simultaneously and removes the maxIterations cap.
 */
function reorderPathForScopedEquivalences(
  path: string[],
  equivalences: SegmentEquivalence[]
): { path: string[]; reordered: boolean } {
  const labels = path.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  const n = labels.length;
  if (n < 2) {
    return { path: labels, reordered: false };
  }

  const keys = labels.map((s) => segmentKeyForMerge(s));
  const edges: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  const inDegree = new Array<number>(n).fill(0);

  const addEdge = (u: number, v: number): void => {
    if (u === v || edges[u]!.has(v)) {
      return;
    }
    edges[u]!.add(v);
    inDegree[v]! += 1;
  };

  for (const eq of equivalences) {
    const prefixKeys = (eq.scope.pathPrefix ?? [])
      .map((s) => segmentKeyForMerge(s))
      .filter(Boolean);
    if (!prefixKeys.length) {
      continue;
    }
    const prefixStart = findPrefixBlock(keys, prefixKeys);
    if (prefixStart < 0) {
      continue;
    }
    const aliasSet = new Set(aliasKeysFor(eq));
    const aliasPositions: number[] = [];
    const prefixEnd = prefixStart + prefixKeys.length;
    for (let i = 0; i < n; i++) {
      if (i >= prefixStart && i < prefixEnd) {
        continue;
      }
      if (aliasSet.has(keys[i]!)) {
        aliasPositions.push(i);
      }
    }
    if (!aliasPositions.length) {
      continue;
    }
    for (let k = 0; k < prefixKeys.length - 1; k++) {
      addEdge(prefixStart + k, prefixStart + k + 1);
    }
    const lastPrefix = prefixEnd - 1;
    for (const aliasPos of aliasPositions) {
      addEdge(lastPrefix, aliasPos);
    }
  }

  const available: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) {
      available.push(i);
    }
  }

  const result: number[] = [];
  while (available.length > 0) {
    available.sort((a, b) => a - b);
    const u = available.shift()!;
    result.push(u);
    for (const v of edges[u]!) {
      inDegree[v]! -= 1;
      if (inDegree[v] === 0) {
        available.push(v);
      }
    }
  }

  if (result.length < n) {
    const seen = new Set(result);
    for (let i = 0; i < n; i++) {
      if (!seen.has(i)) {
        result.push(i);
      }
    }
  }

  const reordered = result.some((v, i) => v !== i);
  return { path: result.map((i) => labels[i]!), reordered };
}

/**
 * Rewrite conceptPath segments using persisted, scoped equivalences (from ontology
 * memory), then apply mechanical normalizeConceptPath cleanup.
 */
export function resolveConceptPathWithEquivalences(
  path: string[],
  equivalences: SegmentEquivalence[] | undefined,
  ctx: TopicPathContext = {},
  minConfidence = DEFAULT_MIN_CONFIDENCE
): string[] {
  if (!path.length) {
    return [];
  }
  if (!equivalences?.length) {
    return normalizeConceptPath(path);
  }

  const { path: orderedPath } = reorderPathForScopedEquivalences(path, equivalences);

  const pathKeys = orderedPath.map((s) => segmentKeyForMerge(s));
  const out: string[] = [];

  for (let i = 0; i < orderedPath.length; i++) {
    const segKey = pathKeys[i]!;
    let label = orderedPath[i]!.replace(/\s+/g, " ").trim();
    for (const eq of equivalences) {
      if (!aliasKeysFor(eq).includes(segKey)) {
        continue;
      }
      if (!equivalenceApplies(eq, pathKeys, i, ctx, minConfidence)) {
        continue;
      }
      label = eq.canonical;
      break;
    }
    out.push(label);
  }

  return normalizeConceptPath(out);
}

export const __testingResolveConceptPath = {
  reorderPathForScopedEquivalences,
};
