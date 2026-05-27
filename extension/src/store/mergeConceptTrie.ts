import { canonicalizeConceptSegment } from "../llm/cursorCliProvider";
import { normalizeConceptPath } from "../llm/normalizeConceptPath";
import type { Topic } from "../llm/types";
import {
  leafRefs,
  type SessionMeta,
  unionChildRefs,
  withOrigin,
} from "../mindmap/origin";
import type { MindMapNodeData, MindMapRoot } from "../transcript/types";
import type { MergeRecord, SessionRecord } from "./storeTypes";
import { sanitizeSessionRecord } from "./sanitizeRecords";

const MAX_LABEL = 120;

function truncate(text: string, max = MAX_LABEL): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 3) + "...";
}

function leaf(text: string): MindMapNodeData {
  return { data: { text: truncate(text) } };
}

function branch(
  text: string,
  children: MindMapNodeData[],
  expand = true
): MindMapNodeData {
  return {
    data: { text: truncate(text), expand },
    children: children.length ? children : undefined,
  };
}

type TopicLocation = {
  record: SessionRecord;
  topic: Topic;
};

type TrieNode = {
  /** Canonicalised key for equality across sessions. */
  key: string;
  /** Display label — pick the most common original casing seen. */
  label: string;
  /** Children keyed by canonical segment. */
  children: Map<string, TrieNode>;
  /** Topics whose conceptPath terminates at this node. */
  topics: TopicLocation[];
  /** Count of times this segment was seen (for label voting / sorting). */
  occurrences: number;
};

function makeNode(canonical: string, label: string): TrieNode {
  return {
    key: canonical,
    label,
    children: new Map(),
    topics: [],
    occurrences: 0,
  };
}

function insertPath(
  root: TrieNode,
  path: string[],
  location: TopicLocation
): void {
  const normalized = normalizeConceptPath(path);
  let node = root;
  for (const segment of normalized) {
    const key = canonicalizeConceptSegment(segment);
    if (!key) {
      continue;
    }
    let next = node.children.get(key);
    if (!next) {
      next = makeNode(key, segment.trim());
      node.children.set(key, next);
    }
    next.occurrences += 1;
    // Prefer the shortest / lowest-cased label as the canonical display when
    // multiple records disagree on capitalisation or whitespace.
    if (segment.trim().length < next.label.length) {
      next.label = segment.trim();
    }
    node = next;
  }
  node.topics.push(location);
}

function locSessionMeta(loc: TopicLocation): SessionMeta {
  return {
    sessionId: loc.record.meta.sessionId,
    projectSlug: loc.record.meta.projectSlug,
    projectPath: loc.record.meta.projectPath,
    sessionLabel: loc.record.meta.sessionLabel,
    transcriptPath: loc.record.meta.transcriptPath,
  };
}

function topicBranch(loc: TopicLocation): MindMapNodeData {
  const sessionTag = `[${loc.record.meta.sessionLabel}]`;
  const heading = `${loc.topic.title} · ${sessionTag}`;
  const sessionMeta = locSessionMeta(loc);
  const children: MindMapNodeData[] = [];
  if (loc.topic.summary && loc.topic.summary.trim()) {
    children.push(withOrigin(leaf(`概述：${loc.topic.summary}`), [
      { ...sessionMeta },
    ]));
  }
  for (const item of loc.topic.items) {
    const refs = item.sourceTurnIndices?.length
      ? ` (Q${item.sourceTurnIndices.map((n) => n + 1).join("/Q")})`
      : "";
    children.push(
      withOrigin(
        leaf(`${item.text}${refs}`),
        leafRefs(sessionMeta, item.sourceTurnIndices)
      )
    );
  }
  const node = branch(heading, children, false);
  return withOrigin(node, unionChildRefs(children));
}

function renderNode(node: TrieNode): MindMapNodeData {
  const childNodes: MindMapNodeData[] = [];
  // Sort children: more occurrences first; tiebreak by label.
  const sortedChildren = [...node.children.values()].sort(
    (a, b) => b.occurrences - a.occurrences || a.label.localeCompare(b.label)
  );
  for (const child of sortedChildren) {
    childNodes.push(renderNode(child));
  }
  for (const t of node.topics) {
    childNodes.push(topicBranch(t));
  }
  const trieNode = branch(
    `${node.label} (${node.occurrences || node.topics.length})`,
    childNodes,
    childNodes.length <= 8
  );
  return withOrigin(trieNode, unionChildRefs(childNodes));
}

export type ConceptMergeOptions = {
  title?: string;
  projectSlug?: string;
};

/** Stats useful for UI / tests / progress messages. */
export type ConceptMergeStats = {
  totalTopics: number;
  topicsWithPath: number;
  topicsWithoutPath: number;
  rootChildren: number;
};

export function buildConceptTrieMindMap(
  records: SessionRecord[],
  options: ConceptMergeOptions = {}
): { mindMap: MindMapRoot; stats: ConceptMergeStats } {
  const filtered = options.projectSlug
    ? records.filter((r) => r.meta.projectSlug === options.projectSlug)
    : records;

  const root = makeNode("", "(root)");
  const orphans: TopicLocation[] = [];
  let total = 0;

  for (const record of filtered) {
    for (const topic of record.graph.topics) {
      total += 1;
      const path = topic.conceptPath?.length
        ? normalizeConceptPath(topic.conceptPath)
        : undefined;
      const location: TopicLocation = { record, topic };
      if (path && path.length) {
        insertPath(root, path, location);
      } else {
        orphans.push(location);
      }
    }
  }

  const title =
    options.title ??
    (options.projectSlug
      ? `Concept Mind Map · ${options.projectSlug}`
      : "Concept Mind Map · 全部");

  const sortedTop = [...root.children.values()].sort(
    (a, b) => b.occurrences - a.occurrences || a.label.localeCompare(b.label)
  );
  const topChildren = sortedTop.map(renderNode);
  if (orphans.length) {
    const orphanNodes = orphans.map(topicBranch);
    const orphanBranch = branch(
      `未分类 (${orphans.length})`,
      orphanNodes,
      false
    );
    topChildren.push(withOrigin(orphanBranch, unionChildRefs(orphanNodes)));
  }

  const stats: ConceptMergeStats = {
    totalTopics: total,
    topicsWithPath: total - orphans.length,
    topicsWithoutPath: orphans.length,
    rootChildren: topChildren.length,
  };

  if (!topChildren.length) {
    return {
      mindMap: {
        data: { text: title, expand: true },
        children: [
          leaf("(库中暂无带 conceptPath 的核心；Refresh 一次会话以触发重新分析)"),
        ],
      },
      stats,
    };
  }

  const mindMap: MindMapRoot = {
    data: { text: title, expand: true },
    children: topChildren,
  };
  return {
    mindMap: withOrigin(mindMap, unionChildRefs(topChildren)),
    stats,
  };
}

export async function buildConceptMergeRecordAsync(
  records: SessionRecord[],
  options: ConceptMergeOptions = {}
): Promise<MergeRecord> {
  const sanitized = await Promise.all(records.map((r) => sanitizeSessionRecord(r)));
  return buildConceptMergeRecord(sanitized, options);
}

export function buildConceptMergeRecord(
  records: SessionRecord[],
  options: ConceptMergeOptions = {}
): MergeRecord {
  const filtered = options.projectSlug
    ? records.filter((r) => r.meta.projectSlug === options.projectSlug)
    : records;
  const sessionIds = filtered.map((r) => r.meta.sessionId);
  const projectSlugs = Array.from(
    new Set(filtered.map((r) => r.meta.projectSlug))
  ).sort();
  const { mindMap } = buildConceptTrieMindMap(records, options);
  return {
    schemaVersion: 1,
    meta: {
      kind: "deterministic",
      builtAt: Date.now(),
      sessionIds,
      projectSlugs,
      title: typeof mindMap.data.text === "string" ? mindMap.data.text : undefined,
    },
    mindMap,
  };
}
