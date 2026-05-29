import {
  resolveConceptPathWithEquivalences,
  type TopicPathContext,
} from "../llm/resolveConceptPathWithEquivalences";
import type { SegmentEquivalence, Topic } from "../llm/types";
import { segmentKeyForMerge } from "../llm/topicGraphValidate";
import type { SessionRecord } from "./storeTypes";

type TopicLocation = {
  record: SessionRecord;
  topic: Topic;
};

type TrieNodeLike = {
  key: string;
  label: string;
  children: Map<string, TrieNodeLike>;
  topics: TopicLocation[];
  occurrences: number;
};

function topicContextFromNode(child: TrieNodeLike): TopicPathContext {
  const titles: string[] = [];
  const summaries: string[] = [];
  const items: string[] = [];
  let projectSlug: string | undefined;
  for (const loc of child.topics) {
    if (loc.topic.title) {
      titles.push(loc.topic.title);
    }
    if (loc.topic.summary) {
      summaries.push(loc.topic.summary);
    }
    for (const item of loc.topic.items ?? []) {
      items.push(item.text);
    }
    projectSlug = projectSlug ?? loc.record.meta.projectSlug;
  }
  return {
    title: titles.join(" "),
    summary: summaries.join(" "),
    items,
    projectSlug,
  };
}

function mergeTrieNodes(target: TrieNodeLike, source: TrieNodeLike): void {
  target.occurrences += source.occurrences;
  target.topics.push(...source.topics);
  if (source.label.length < target.label.length) {
    target.label = source.label;
  }
  for (const [childKey, child] of source.children) {
    const existing = target.children.get(childKey);
    if (!existing) {
      target.children.set(childKey, child);
      continue;
    }
    mergeTrieNodes(existing, child);
  }
}

function resolvedSegmentKey(
  parentPathKeys: string[],
  child: TrieNodeLike,
  equivalences: SegmentEquivalence[] | undefined
): string {
  const pathLabels = [
    ...parentPathKeys.map((k) => k),
    child.label,
  ];
  const resolved = resolveConceptPathWithEquivalences(
    pathLabels,
    equivalences,
    topicContextFromNode(child)
  );
  const last = resolved[resolved.length - 1] ?? child.label;
  return segmentKeyForMerge(last);
}

/**
 * Collapse sibling trie nodes whose segments are equivalent under ontology memory.
 */
export function mergeTrieSiblingsByEquivalences<T extends TrieNodeLike>(
  node: T,
  parentPathKeys: string[],
  equivalences: SegmentEquivalence[] | undefined
): void {
  if (!equivalences?.length || !node.children.size) {
    for (const child of node.children.values()) {
      mergeTrieSiblingsByEquivalences(
        child,
        [...parentPathKeys, child.key],
        equivalences
      );
    }
    return;
  }

  const groups = new Map<string, TrieNodeLike>();
  for (const child of node.children.values()) {
    const canon = resolvedSegmentKey(parentPathKeys, child, equivalences);
    const existing = groups.get(canon);
    if (!existing) {
      child.key = canon;
      groups.set(canon, child);
      continue;
    }
    mergeTrieNodes(existing, child);
  }
  node.children = new Map(groups.entries());

  for (const child of node.children.values()) {
    mergeTrieSiblingsByEquivalences(
      child,
      [...parentPathKeys, child.key],
      equivalences
    );
  }
}
