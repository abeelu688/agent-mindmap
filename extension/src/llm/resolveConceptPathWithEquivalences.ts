import { normalizeConceptPath } from "./normalizeConceptPath";
import type { SegmentEquivalence } from "./types";
import { segmentKeyForMerge } from "./topicGraphValidate";

export type TopicPathContext = {
  title?: string;
  summary?: string;
  items?: string[];
  projectSlug?: string;
};

const DEFAULT_MIN_CONFIDENCE = 0.5;

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

function evidenceMatches(ctx: TopicPathContext, keywords?: string[]): boolean {
  if (!keywords?.length) {
    return true;
  }
  const blob = [ctx.title ?? "", ctx.summary ?? "", ...(ctx.items ?? []).map((i) => i)]
    .join(" ")
    .toLowerCase();
  return keywords.some((k) => blob.includes(k.toLowerCase()));
}

function downstreamFirstMatches(
  afterKeys: string[],
  allowed?: string[]
): boolean {
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
  if (!pathPrefixMatches(pathKeys.slice(0, segmentIndex), eq.scope.pathPrefix)) {
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

function indexOfContiguous(
  haystack: string[],
  needle: string[],
  fromIndex: number
): number {
  if (!needle.length || haystack.length < needle.length) {
    return -1;
  }
  for (let i = fromIndex; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let k = 0; k < needle.length; k++) {
      if (haystack[i + k] !== needle[k]) {
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
 * When an alias segment appears before its scoped pathPrefix (LLM inverted order),
 * move the prefix block before the alias so scoped equivalences can apply.
 */
function reorderPathForScopedEquivalences(
  path: string[],
  equivalences: SegmentEquivalence[]
): { path: string[]; reordered: boolean } {
  let labels = path
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  let reordered = false;

  let changed = true;
  while (changed) {
    changed = false;
    const keys = labels.map((s) => segmentKeyForMerge(s));
    for (const eq of equivalences) {
      const prefix = (eq.scope.pathPrefix ?? [])
        .map((s) => segmentKeyForMerge(s))
        .filter(Boolean);
      if (!prefix.length) {
        continue;
      }
      for (let i = 0; i < keys.length; i++) {
        if (!aliasKeysFor(eq).includes(keys[i])) {
          continue;
        }
        if (pathPrefixMatches(keys.slice(0, i), prefix)) {
          continue;
        }
        const j = indexOfContiguous(keys, prefix, i + 1);
        if (j < 0) {
          continue;
        }
        const prefixLabels = labels.slice(j, j + prefix.length);
        labels = [
          ...prefixLabels,
          ...labels.slice(0, i),
          ...labels.slice(i, j),
          ...labels.slice(j + prefix.length),
        ];
        reordered = true;
        changed = true;
        break;
      }
      if (changed) {
        break;
      }
    }
  }

  return { path: labels, reordered };
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

  const { path: orderedPath } = reorderPathForScopedEquivalences(
    path,
    equivalences
  );

  const pathKeys = orderedPath.map((s) => segmentKeyForMerge(s));
  const out: string[] = [];

  for (let i = 0; i < orderedPath.length; i++) {
    const segKey = pathKeys[i];
    let label = orderedPath[i].replace(/\s+/g, " ").trim();
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
