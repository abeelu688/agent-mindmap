import { uiTranslate } from "../l10n/uiTranslate";
import { mindMapLog } from "../webview/MindMapLog";
import { segmentKeyForMerge } from "../llm/cursorCliProvider";
import { normalizeConceptPath } from "../llm/normalizeConceptPath";
import { resolveConceptPathWithEquivalences } from "../llm/resolveConceptPathWithEquivalences";
import { filterProjectCodeReferences } from "../llm/filterCodeReferences";
import { MERGE_APPLY_SEGMENT_EQUIVALENCES } from "../pipeline/mergeSynonymPolicy";
import { leafRefs, type SessionMeta, unionChildRefs, withOrigin } from "../mindmap/origin";
import {
  mindMapLabelsForOutputLanguage,
  type MindMapLanguageLabels,
} from "../mindmap/outputLanguageLabels";
import {
  prepareRecordsForFinalTrie,
  type ConceptMergePrepOntology,
} from "./prepareConceptMergeRecords";
import { mergeTrieSiblingsByEquivalences } from "./mergeTrieByEquivalences";
import { sanitizeSessionRecord } from "./sanitizeRecords";
import type { MindMapNodeData, MindMapRoot } from "../transcript/types";
import type { MergeRecord, SessionRecord } from "./storeTypes";
import type {
  CodeReference,
  ConceptOntologyNode,
  OutlineNode,
  ReattachMove,
  ReattachStep,
  SegmentEquivalence,
  SessionAnalysis,
  SessionOutline,
  Topic,
} from "../llm/types";

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

function branch(text: string, children: MindMapNodeData[], expand = true): MindMapNodeData {
  return {
    data: { text: truncate(text), expand },
    children: children.length ? children : undefined,
  };
}

type TopicLocation = {
  record: SessionRecord;
  topic: Topic;
};

export type ConceptTrieNode = {
  /** Canonicalised key for equality across sessions. */
  key: string;
  /** Display label — pick the most common original casing seen. */
  label: string;
  /** Children keyed by canonical segment. */
  children: Map<string, ConceptTrieNode>;
  /** Topics whose conceptPath terminates at this node. */
  topics: TopicLocation[];
  /** Count of times this segment was seen (for label voting / sorting). */
  occurrences: number;
};

/** @internal alias */
type TrieNode = ConceptTrieNode;

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
  location: TopicLocation,
  equivalences: SegmentEquivalence[] | undefined,
  applyEquivalences: boolean
): void {
  const ctx = {
    title: location.topic.title,
    summary: location.topic.summary,
    items: location.topic.items?.map((i) => i.text),
    projectSlug: location.record.meta.projectSlug,
  };
  const normalized = applyEquivalences
    ? resolveConceptPathWithEquivalences(path, equivalences, ctx)
    : normalizeConceptPath(path);
  let node = root;
  for (const segment of normalized) {
    const key = segmentKeyForMerge(segment);
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

function lastTitleSegment(title: string): string {
  const parts = title
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : title.trim();
}

/** Penultimate topic label: full LLM summary when present, else title segment. */
function topicHeadline(topic: Topic): string {
  const summary = topic.summary?.trim();
  if (summary) {
    return summary;
  }
  const last = lastTitleSegment(topic.title);
  if (last) {
    return truncate(last, MAX_LABEL);
  }
  return truncate(topic.title.trim(), MAX_LABEL);
}

/**
 * Build a SessionOutline deterministically from the concept trie
 * (domains + nodes with parentKeys/childKeys).
 * Used when the merge LLM skips outline generation (Route 1).
 */
export function buildOutlineFromConceptTrie(
  domains: string[],
  nodes: ConceptOntologyNode[]
): SessionOutline {
  const nodesByKey = new Map<string, ConceptOntologyNode>();
  for (const node of nodes) {
    nodesByKey.set(node.key.toLowerCase(), node);
  }

  // Build child map: parentKey → sorted child keys
  const childrenOf = new Map<string, string[]>();
  for (const node of nodes) {
    const childKey = node.key.toLowerCase();
    for (const pk of node.parentKeys ?? []) {
      const parent = pk.toLowerCase();
      let arr = childrenOf.get(parent);
      if (!arr) {
        arr = [];
        childrenOf.set(parent, arr);
      }
      if (!arr.includes(childKey)) {
        arr.push(childKey);
      }
    }
  }
  // Also use explicit childKeys
  for (const node of nodes) {
    const parent = node.key.toLowerCase();
    for (const ck of node.childKeys ?? []) {
      const existing = childrenOf.get(parent);
      if (!existing) {
        childrenOf.set(parent, [ck.toLowerCase()]);
      } else if (!existing.includes(ck.toLowerCase())) {
        existing.push(ck.toLowerCase());
      }
    }
  }
  // Sort each child list
  for (const [key, arr] of childrenOf) {
    childrenOf.set(key, [...new Set(arr)].sort());
  }

  const buildNode = (key: string, pathSoFar: string[]): OutlineNode => {
    const node = nodesByKey.get(key);
    const title = node?.label || key;
    const summary = node?.evidence?.[0];
    const conceptPath = [...pathSoFar, key];
    const childKeys = childrenOf.get(key) ?? [];

    if (childKeys.length === 0) {
      // Leaf node
      const result: OutlineNode = { title, conceptPath };
      if (summary) {
        result.summary = summary.length > 80 ? summary.slice(0, 77) + "..." : summary;
      }
      return result;
    }

    // Interior node
    const children = childKeys.map((ck) => buildNode(ck, conceptPath));
    const result: OutlineNode = { title, children };
    if (summary) {
      result.summary = summary.length > 80 ? summary.slice(0, 77) + "..." : summary;
    }
    return result;
  };

  // Top-level: domains as root outline nodes
  const outline: OutlineNode[] = [];
  for (const domain of domains) {
    outline.push(buildNode(domain.toLowerCase(), []));
  }

  // Handle root nodes not covered by any domain
  const coveredKeys = new Set<string>();
  const collectKeys = (key: string) => {
    coveredKeys.add(key.toLowerCase());
    for (const ck of childrenOf.get(key.toLowerCase()) ?? []) {
      collectKeys(ck);
    }
  };
  for (const domain of domains) {
    collectKeys(domain.toLowerCase());
  }
  for (const node of nodes) {
    const key = node.key.toLowerCase();
    if (!coveredKeys.has(key) && (node.parentKeys ?? []).length === 0) {
      outline.push(buildNode(key, []));
    }
  }

  return { outline };
}

function buildCodeReferencesNode(
  refs: CodeReference[],
  sessionMeta: SessionMeta,
  labels: MindMapLanguageLabels
): MindMapNodeData {
  const groups = new Map<string, CodeReference[]>();
  for (const ref of refs) {
    let arr = groups.get(ref.path);
    if (!arr) {
      arr = [];
      groups.set(ref.path, arr);
    }
    arr.push(ref);
  }
  const sortedPaths = [...groups.keys()].sort();
  const children: MindMapNodeData[] = [];
  for (const p of sortedPaths) {
    const descs = groups.get(p)!.map((ref) => {
      const turnIndices = ref.sourceTurnIndices?.length ? ref.sourceTurnIndices : undefined;
      return withOrigin(leaf(ref.description), leafRefs(sessionMeta, turnIndices));
    });
    const fileBranch = branch(p, descs, true);
    const fileRefs = unionChildRefs(descs);
    children.push(fileRefs.length ? withOrigin(fileBranch, fileRefs) : fileBranch);
  }
  const node = branch(labels.relatedCode, children, false);
  return withOrigin(node, unionChildRefs(children));
}

function topicBranch(loc: TopicLocation): MindMapNodeData {
  const heading = topicHeadline(loc.topic);
  const sessionMeta = locSessionMeta(loc);
  const labels = mindMapLabelsForOutputLanguage(loc.record.meta.outputLanguage);
  const children: MindMapNodeData[] = [];
  const items = loc.topic.items ?? [];
  if (items.length) {
    for (const item of items) {
      const refs = item.sourceTurnIndices?.length
        ? ` (Q${item.sourceTurnIndices.map((n) => n + 1).join("/Q")})`
        : "";
      children.push(
        withOrigin(leaf(`${item.text}${refs}`), leafRefs(sessionMeta, item.sourceTurnIndices))
      );
    }
  } else {
    children.push(withOrigin(leaf(labels.noDetails), [{ ...sessionMeta }]));
  }
  const rawCodeRefs = loc.record.sessionAnalysis?.codeReferences;
  const codeRefs = rawCodeRefs?.length
    ? filterProjectCodeReferences(rawCodeRefs, loc.record.meta.projectPath)
    : undefined;
  if (codeRefs?.length) {
    // Filter to code refs relevant to this topic's turns
    const topicTurns = new Set((loc.topic.items ?? []).flatMap((it) => it.sourceTurnIndices ?? []));
    const filtered = topicTurns.size
      ? codeRefs.filter((ref) => ref.sourceTurnIndices?.some((t) => topicTurns.has(t)))
      : codeRefs;
    if (filtered.length) {
      children.push(buildCodeReferencesNode(filtered, sessionMeta, labels));
    }
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

export type { ConceptMergePrepOntology } from "./prepareConceptMergeRecords";

export type ConceptMergeOptions = {
  title?: string;
  projectSlug?: string;
  segmentEquivalences?: SegmentEquivalence[];
  /** When false, paths insert as-is (mechanical normalize only). */
  applySegmentEquivalences?: boolean;
  /** When set, apply topicPaths + reattach + equivalences before trie build. */
  ontologyForPrep?: ConceptMergePrepOntology;
  reattachMoves?: ReattachMove[];
  reattachSteps?: ReattachStep[];
  /** M-merge virtual combined session (preferred over reattach when set). */
  virtualSessionAnalysis?: SessionAnalysis;
  /** Skip prep when records were already prepared (default false). */
  recordsAlreadyPrepared?: boolean;
};

/** Stats useful for UI / tests / progress messages. */
export type ConceptMergeStats = {
  recordCount: number;
  totalTopics: number;
  topicsWithPath: number;
  topicsWithoutPath: number;
  rootChildren: number;
};

export type ConceptTrieStructure = {
  root: ConceptTrieNode;
  orphans: TopicLocation[];
  filtered: SessionRecord[];
  stats: ConceptMergeStats;
};

function outputLanguageFromRecords(records: SessionRecord[]): string | undefined {
  const votes = new Map<string, { count: number; latestIndex: number }>();
  records.forEach((record, index) => {
    const language = record.meta.outputLanguage;
    if (!language) {
      return;
    }
    const current = votes.get(language) ?? { count: 0, latestIndex: -1 };
    votes.set(language, { count: current.count + 1, latestIndex: index });
  });
  const ranked = [...votes.entries()].sort(
    (a, b) => b[1].count - a[1].count || b[1].latestIndex - a[1].latestIndex
  );
  return ranked[0]?.[0];
}

function conceptTrieEmptyLeaf(
  filteredRecordCount: number,
  totalTopics: number,
  rootHiddenTopics: number
): MindMapNodeData {
  if (filteredRecordCount === 0 || totalTopics === 0) {
    return leaf(
      uiTranslate(
        "mindmap.concept.empty.noSessions",
        "(No analyzed sessions in the library; run Open Latest Session or Analyze Project Sessions first.)"
      )
    );
  }
  if (rootHiddenTopics > 0) {
    return leaf(
      uiTranslate(
        "mindmap.concept.empty.invalidConceptPath",
        "(Some topics have invalid conceptPath; refresh a session to re-analyze.)"
      )
    );
  }
  return leaf(
    uiTranslate(
      "mindmap.concept.empty.noConceptPath",
      "(No topics with conceptPath in the library; refresh a session to re-analyze.)"
    )
  );
}

export function buildConceptTrieStructure(
  records: SessionRecord[],
  options: ConceptMergeOptions = {}
): ConceptTrieStructure {
  const applyEquivalences = options.applySegmentEquivalences ?? MERGE_APPLY_SEGMENT_EQUIVALENCES;
  const filtered = options.projectSlug
    ? records.filter((r) => r.meta.projectSlug === options.projectSlug)
    : records;

  const root = makeNode("", "(root)");
  const orphans: TopicLocation[] = [];
  let total = 0;

  for (const record of filtered) {
    for (const topic of record.graph.topics) {
      total += 1;
      const location: TopicLocation = { record, topic };
      if (topic.conceptPath?.length) {
        insertPath(
          root,
          topic.conceptPath,
          location,
          options.segmentEquivalences,
          applyEquivalences
        );
      } else {
        orphans.push(location);
      }
    }
  }

  mindMapLog(
    `[buildConceptTrieStructure] filtered=${filtered.length} totalTopics=${total} orphans=${orphans.length} rootChildren=${root.children.size}`
  );

  if (applyEquivalences) {
    mergeTrieSiblingsByEquivalences(root, [], options.segmentEquivalences);
  }

  const sortedTop = [...root.children.values()].sort(
    (a, b) => b.occurrences - a.occurrences || a.label.localeCompare(b.label)
  );
  const rootChildren = sortedTop.length + (orphans.length ? 1 : 0);

  const stats: ConceptMergeStats = {
    recordCount: filtered.length,
    totalTopics: total,
    topicsWithPath: total - orphans.length,
    topicsWithoutPath: orphans.length,
    rootChildren,
  };

  return { root, orphans, filtered, stats };
}

export function buildConceptTrieMindMap(
  records: SessionRecord[],
  options: ConceptMergeOptions = {}
): { mindMap: MindMapRoot; stats: ConceptMergeStats } {
  const { root, orphans, stats } = buildConceptTrieStructure(records, options);
  const filtered = options.projectSlug
    ? records.filter((r) => r.meta.projectSlug === options.projectSlug)
    : records;
  const labels = mindMapLabelsForOutputLanguage(outputLanguageFromRecords(filtered));

  const title =
    options.title ??
    (options.projectSlug
      ? labels.conceptTitleProject(options.projectSlug)
      : labels.conceptTitleAll);

  const sortedTop = [...root.children.values()].sort(
    (a, b) => b.occurrences - a.occurrences || a.label.localeCompare(b.label)
  );
  const topChildren = sortedTop.map(renderNode);
  if (orphans.length) {
    const orphanNodes = orphans.map(topicBranch);
    const orphanBranch = branch(labels.uncategorized(orphans.length), orphanNodes, false);
    topChildren.push(withOrigin(orphanBranch, unionChildRefs(orphanNodes)));
  }

  if (!topChildren.length) {
    const emptyLeaf = conceptTrieEmptyLeaf(
      stats.recordCount,
      stats.totalTopics,
      root.topics.length
    );
    return {
      mindMap: {
        data: { text: title, expand: true },
        children: [emptyLeaf],
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

function recordsForTrieBuild(
  records: SessionRecord[],
  options: ConceptMergeOptions
): SessionRecord[] {
  if (options.recordsAlreadyPrepared || !options.ontologyForPrep) {
    return records;
  }
  return prepareRecordsForFinalTrie(
    records,
    options.ontologyForPrep,
    options.reattachMoves,
    options.reattachSteps,
    options.virtualSessionAnalysis
  );
}

export function buildConceptMergeRecord(
  records: SessionRecord[],
  options: ConceptMergeOptions = {}
): MergeRecord {
  const filtered = options.projectSlug
    ? records.filter((r) => r.meta.projectSlug === options.projectSlug)
    : records;
  const sessionIds = filtered.map((r) => r.meta.sessionId);
  const projectSlugs = Array.from(new Set(filtered.map((r) => r.meta.projectSlug))).sort();
  const trieRecords = recordsForTrieBuild(records, options);
  mindMapLog(
    `[buildConceptMergeRecord] input: ${records.length} records, ${filtered.length} filtered, ${trieRecords.length} trieRecords, ontologyForPrep=${!!options.ontologyForPrep}, virtualSession=${!!options.virtualSessionAnalysis}`
  );
  // Log trieRecords topics detail
  for (const r of trieRecords.slice(0, 2)) {
    const topics = r.graph?.topics ?? [];
    const paths = topics.map((t: any) => t.conceptPath);
    mindMapLog(
      `[buildConceptMergeRecord] trieRecord=${r.meta?.sessionId?.slice(0, 8)} topics=${topics.length} paths=${JSON.stringify(paths)}`
    );
  }
  const { mindMap } = buildConceptTrieMindMap(trieRecords, options);
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
