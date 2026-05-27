import { normalizeConceptPath } from "./normalizeConceptPath";
import type { SegmentEquivalence } from "./types";
import { canonicalizeConceptSegment } from "./topicGraphValidate";

export type TopicPathContext = {
  title?: string;
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
    if (pathKeys[i] !== canonicalizeConceptSegment(prefix[i])) {
      return false;
    }
  }
  return true;
}

function evidenceMatches(ctx: TopicPathContext, keywords?: string[]): boolean {
  if (!keywords?.length) {
    return true;
  }
  const blob = [ctx.title ?? "", ...(ctx.items ?? []).map((i) => i)]
    .join(" ")
    .toLowerCase();
  return keywords.some((k) => blob.includes(k.toLowerCase()));
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
  keys.add(canonicalizeConceptSegment(eq.canonical));
  for (const a of eq.aliases ?? []) {
    keys.add(canonicalizeConceptSegment(a));
  }
  return [...keys];
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

  const pathKeys = path.map((s) => canonicalizeConceptSegment(s));
  const out: string[] = [];

  for (let i = 0; i < path.length; i++) {
    const segKey = pathKeys[i];
    let label = path[i].replace(/\s+/g, " ").trim();
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
