import type { OutlineNode } from "./types";
import type { SessionRecord } from "../store/storeTypes";
import type { TopicConceptPathDecision } from "../store/ontologyTypes";
import { topicIdForTopic } from "./topicId";
import { segmentKeyForMerge } from "./topicGraphValidate";

export type {
  ChainSegmentOverlapHint,
  NodeSegmentRelationshipHint,
  SegmentOverlapHint,
  SiblingSegmentOverlapHint,
} from "./synonymHintDerive";
export {
  buildAllSegmentOverlapHints,
  buildChainCollapseOverlapHints,
  buildNodeRelationshipHints,
  buildSiblingSegmentOverlapHints,
  collectSessionSegmentEquivalences,
  deriveEquivalencesFromOverlapHints,
  deriveEquivalencesFromTopicPaths,
  enhanceSegmentEquivalencesForMerge,
  mergeSegmentEquivalencesLists,
} from "./synonymHintDerive";
export {
  applyOrphanRootReparent,
  buildOrphanRootReparentRules,
  rulesToReparentMap,
  type OrphanRootReparentRule,
} from "./reparentOrphanRootPaths";

export type SegmentSliceContext = {
  index: number;
  segment: string;
  upstream: string[];
  downstream: string[];
};

export type TopicOutlineContext = {
  topicId: string;
  sessionId: string;
  outlinePath: string[];
  siblingTitles: string[];
  title: string;
  summary?: string;
  items: string[];
};

export type TopicSegmentContext = {
  topicId: string;
  sessionId: string;
  projectSlug: string;
  conceptPath: string[];
  /** Per-segment upstream/downstream slices for refine disambiguation. */
  segments: SegmentSliceContext[];
  outlinePath: string[];
  siblingTitles: string[];
  evidence: string[];
};

const DEFAULT_REFINE_SAMPLE_LIMIT = 60;

function clipText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 3) + "...";
}

function buildSegmentSlices(path: string[]): SegmentSliceContext[] {
  return path.map((segment, index) => ({
    index,
    segment,
    upstream: path.slice(0, index),
    downstream: path.slice(index + 1),
  }));
}

/**
 * Domain-agnostic ambiguity score for refine sampling: repeated segments,
 * nested key overlap, and deep paths often need scoped equivalences.
 */
function pathAmbiguityScore(path: string[]): number {
  const keys = path.map((s) => segmentKeyForMerge(s)).filter(Boolean);
  let score = 0;

  const counts = new Map<string, number>();
  for (const k of keys) {
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const n of counts.values()) {
    if (n > 1) {
      score += 2 * (n - 1);
    }
  }

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (keys[i] === keys[j]) {
        continue;
      }
      if (keys[i].includes(keys[j]) || keys[j].includes(keys[i])) {
        score += 1;
      }
    }
  }

  score += Math.max(0, keys.length - 3);
  return score;
}

type OutlineLeaf = {
  outlinePath: string[];
  title: string;
  summary?: string;
  items: string[];
};

function collectOutlineLeaves(
  nodes: OutlineNode[],
  path: string[],
  out: OutlineLeaf[]
): void {
  for (const node of nodes) {
    const nextPath = [...path, node.title];
    if (node.details?.length) {
      const title = nextPath.join(" / ");
      out.push({
        outlinePath: nextPath,
        title: title.length > 80 ? title.slice(0, 77) + "..." : title,
        summary: node.summary,
        items: node.details.map((d) => d.text).slice(0, 8),
      });
      continue;
    }
    collectOutlineLeaves(node.children ?? [], nextPath, out);
  }
}

function indexOutlineLeavesForSession(
  record: SessionRecord
): Map<string, TopicOutlineContext> {
  const leaves: OutlineLeaf[] = [];
  collectOutlineLeaves(record.outline.outline, [], leaves);

  const byParent = new Map<string, OutlineLeaf[]>();
  for (const leaf of leaves) {
    const parentKey = leaf.outlinePath.slice(0, -1).join("\0");
    const group = byParent.get(parentKey) ?? [];
    group.push(leaf);
    byParent.set(parentKey, group);
  }

  const index = new Map<string, TopicOutlineContext>();
  for (const leaf of leaves) {
    const parentKey = leaf.outlinePath.slice(0, -1).join("\0");
    const group = byParent.get(parentKey) ?? [leaf];
    const siblingTitles = group
      .filter((l) => l.title !== leaf.title)
      .map((l) => clipText(l.title, 80));
    const topicId = topicIdForTopic(record.meta.sessionId, {
      title: leaf.title,
      items: leaf.items.map((text) => ({ text })),
    });
    index.set(`${record.meta.sessionId}:${topicId}`, {
      topicId,
      sessionId: record.meta.sessionId,
      outlinePath: leaf.outlinePath,
      siblingTitles,
      title: leaf.title,
      summary: leaf.summary,
      items: leaf.items.map((t) => clipText(t, 120)),
    });
  }
  return index;
}

/** Cross-session index keyed by `sessionId:topicId`. */
export function buildTopicContextIndex(
  records: SessionRecord[]
): Map<string, TopicOutlineContext> {
  const merged = new Map<string, TopicOutlineContext>();
  for (const record of records) {
    for (const [k, v] of indexOutlineLeavesForSession(record)) {
      merged.set(k, v);
    }
  }
  return merged;
}

export function topicSegmentContextFromDecision(
  tp: TopicConceptPathDecision,
  outlineCtx?: TopicOutlineContext
): TopicSegmentContext {
  const evidence: string[] = [];
  if (outlineCtx?.title) {
    evidence.push(outlineCtx.title);
  }
  if (outlineCtx?.summary) {
    evidence.push(clipText(outlineCtx.summary, 200));
  }
  for (const item of outlineCtx?.items ?? []) {
    evidence.push(item);
  }
  for (const e of tp.evidence ?? []) {
    evidence.push(clipText(e, 120));
  }

  return {
    topicId: tp.topicId,
    sessionId: tp.sessionId,
    projectSlug: tp.projectSlug,
    conceptPath: tp.conceptPath,
    segments: buildSegmentSlices(tp.conceptPath),
    outlinePath: outlineCtx?.outlinePath ?? [],
    siblingTitles: outlineCtx?.siblingTitles ?? [],
    evidence,
  };
}

/**
 * Prioritize ambiguous paths (likely needing scoped equivalences), capped for refine.
 */
export function buildRefineContextSamples(
  topicPaths: TopicConceptPathDecision[],
  index: Map<string, TopicOutlineContext>,
  limit = DEFAULT_REFINE_SAMPLE_LIMIT
): TopicSegmentContext[] {
  const sorted = [...topicPaths].sort(
    (a, b) => pathAmbiguityScore(b.conceptPath) - pathAmbiguityScore(a.conceptPath)
  );
  const seen = new Set<string>();
  const out: TopicSegmentContext[] = [];
  for (const tp of sorted) {
    const key = `${tp.sessionId}:${tp.topicId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(
      topicSegmentContextFromDecision(tp, index.get(key))
    );
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}
