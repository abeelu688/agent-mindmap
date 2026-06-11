import { buildMergeSessionAnalysisTabularInput } from "./mergeSessionAnalysisTabular";
import { buildConceptContextsFromAnalysis } from "./buildConceptContexts";
import { enrichAnalysisNodesFromOutline } from "./enrichNodeChildrenFromOutline";
import { MERGE_SNAPSHOT_SESSION_ID, isMergeSnapshotSessionId } from "../store/mergeSnapshot";
import { collectDistinctTopSegmentKeys } from "../store/prepareConceptMergeRecords";
import type { ConceptContextForMerge, SessionRecord } from "../store/storeTypes";
import type { MergeInputMode } from "./trieReparentInput";
import type { OutlineNode, SessionAnalysis } from "./types";

const MAX_NODES_PER_SESSION = 48;
const MAX_CONTEXTS_PER_SESSION = 40;
const MAX_SNAPSHOT_NODES = 96;

const MAX_OUTLINE_DEPTH = 4;
const MAX_OUTLINE_TOP_BRANCHES = 8;
const MAX_OUTLINE_CHILDREN_PER_NODE = 4;
const MAX_OUTLINE_LEAF_COUNT = 32;

const MAX_EVIDENCE_PER_NODE = 3;
const MAX_EVIDENCE_CHARS = 100;
const MAX_ALIASES_PER_NODE = 4;

export type MergeSessionInputNode = {
  key: string;
  label: string;
  domainKeys: string[];
  parentKeys: string[];
  childKeys: string[];
  aliases: string[];
  evidence: string[];
};

export type MergeOutlineNode = {
  title: string;
  summary?: string;
  conceptPath?: string[];
  children?: MergeOutlineNode[];
};

export type MergeSessionInputSession = {
  sessionId: string;
  label: string;
  role: "snapshot" | "batch" | "library";
  domains: string[];
  nodes: MergeSessionInputNode[];
  segmentEquivalences: SessionAnalysis["segmentEquivalences"];
  outline: {
    title: string;
    summary?: string;
    tree: MergeOutlineNode[];
  };
  /** Snapshot only: stable top roots from prior merge. */
  frozenTopRootKeys?: string[];
  /** Snapshot only: stable domain keys from prior merge. */
  frozenDomains?: string[];
};

export type MergeSessionAnalysisInput = {
  mergeMode: MergeInputMode;
  snapshotSessionId?: string;
  sessions: MergeSessionInputSession[];
};

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 3) + "...";
}

function truncateEvidence(list: string[] | undefined): string[] {
  return (list ?? [])
    .slice(0, MAX_EVIDENCE_PER_NODE)
    .map((e) => truncate(e, MAX_EVIDENCE_CHARS));
}

function nodeRowFromContext(ctx: ConceptContextForMerge): MergeSessionInputNode {
  return {
    key: ctx.key,
    label: ctx.label,
    domainKeys: [...(ctx.domainKeys ?? [])],
    parentKeys: [...(ctx.parentKeys ?? [])],
    childKeys: [...(ctx.childKeys ?? [])],
    aliases: [...(ctx.aliases ?? [])].slice(0, MAX_ALIASES_PER_NODE),
    evidence: truncateEvidence(ctx.evidence),
  };
}

function nodeRowFromAnalysisNode(
  n: SessionAnalysis["nodes"][0],
  domainKeys: string[]
): MergeSessionInputNode {
  return {
    key: n.key,
    label: n.label,
    domainKeys: [...domainKeys],
    parentKeys: [...(n.parentKeys ?? [])],
    childKeys: [...(n.childKeys ?? [])],
    aliases: [...(n.aliases ?? [])].slice(0, MAX_ALIASES_PER_NODE),
    evidence: truncateEvidence(n.evidence),
  };
}

function collectOutlinePathKeys(nodes: OutlineNode[], out: Set<string>): void {
  for (const node of nodes) {
    for (const seg of node.conceptPath ?? []) {
      const k = seg.toLowerCase().trim();
      if (k) {
        out.add(k);
      }
    }
    if (node.children?.length) {
      collectOutlinePathKeys(node.children, out);
    }
  }
}

/** Prefer roots, outline-path nodes, then hubs when capping snapshot nodes. */
export function prioritizeNodesForMergeInput(
  nodes: MergeSessionInputNode[],
  outlinePathKeys: Set<string>,
  cap: number
): MergeSessionInputNode[] {
  if (nodes.length <= cap) {
    return nodes;
  }
  const score = (n: MergeSessionInputNode): number => {
    let s = 0;
    if (!n.parentKeys.length) {
      s += 1000;
    }
    if (outlinePathKeys.has(n.key.toLowerCase())) {
      s += 500;
    }
    s += (n.childKeys?.length ?? 0) * 10;
    s += Math.min(n.evidence?.length ?? 0, 3);
    return s;
  };
  return [...nodes]
    .sort(
      (a, b) =>
        score(b) - score(a) || a.key.localeCompare(b.key)
    )
    .slice(0, cap);
}

type SerializeOutlineOpts = {
  maxDepth: number;
  maxTop: number;
  maxChildren: number;
  leafCap: number;
};

function serializeOutlineNode(
  node: OutlineNode,
  depth: number,
  opts: SerializeOutlineOpts,
  leafCount: { n: number }
): MergeOutlineNode | undefined {
  if (depth >= opts.maxDepth || leafCount.n >= opts.leafCap) {
    return undefined;
  }
  const hasPath = Boolean(node.conceptPath?.length);
  const rawChildren = node.children ?? [];
  const isLeaf = hasPath && !rawChildren.length;

  if (isLeaf) {
    leafCount.n += 1;
    return {
      title: truncate(node.title, 80),
      summary: node.summary ? truncate(node.summary, 120) : undefined,
      conceptPath: [...node.conceptPath!],
    };
  }

  const children: MergeOutlineNode[] = [];
  for (const child of rawChildren.slice(0, opts.maxChildren)) {
    if (leafCount.n >= opts.leafCap) {
      break;
    }
    const serialized = serializeOutlineNode(child, depth + 1, opts, leafCount);
    if (serialized) {
      children.push(serialized);
    }
  }

  const out: MergeOutlineNode = {
    title: truncate(node.title, 80),
  };
  if (node.summary?.trim()) {
    out.summary = truncate(node.summary, 120);
  }
  if (hasPath) {
    out.conceptPath = [...node.conceptPath!];
    leafCount.n += 1;
  }
  if (children.length) {
    out.children = children;
  }
  if (!out.conceptPath && !out.children?.length) {
    return undefined;
  }
  return out;
}

/** Serialize session outline as a depth-limited tree for M-merge LLM input. */
export function serializeOutlineTree(
  roots: OutlineNode[],
  opts?: Partial<SerializeOutlineOpts>
): MergeOutlineNode[] {
  const full: SerializeOutlineOpts = {
    maxDepth: opts?.maxDepth ?? MAX_OUTLINE_DEPTH,
    maxTop: opts?.maxTop ?? MAX_OUTLINE_TOP_BRANCHES,
    maxChildren: opts?.maxChildren ?? MAX_OUTLINE_CHILDREN_PER_NODE,
    leafCap: opts?.leafCap ?? MAX_OUTLINE_LEAF_COUNT,
  };
  const leafCount = { n: 0 };
  const tree: MergeOutlineNode[] = [];
  for (const root of roots.slice(0, full.maxTop)) {
    if (leafCount.n >= full.leafCap) {
      break;
    }
    const node = serializeOutlineNode(root, 0, full, leafCount);
    if (node) {
      tree.push(node);
    }
  }
  return tree;
}

function frozenTopRootKeysFromRecord(record: SessionRecord): string[] {
  const analysis = record.sessionAnalysis;
  const fromNodes = (analysis?.nodes ?? [])
    .filter((n) => !(n.parentKeys?.length ?? 0))
    .map((n) => n.key.toLowerCase().trim())
    .filter(Boolean);
  if (fromNodes.length) {
    return [...new Set(fromNodes)].sort();
  }
  return collectDistinctTopSegmentKeys([record]).sort();
}

function buildNodesForRecord(
  record: SessionRecord,
  role: MergeSessionInputSession["role"],
  outlinePathKeys: Set<string>
): MergeSessionInputNode[] {
  const analysis = record.sessionAnalysis;
  const outline = record.outline;
  const cap =
    role === "snapshot" ? MAX_SNAPSHOT_NODES : MAX_CONTEXTS_PER_SESSION;

  let nodes: MergeSessionInputNode[];
  if (record.conceptContexts?.length) {
    nodes = record.conceptContexts.map(nodeRowFromContext);
  } else if (analysis) {
    const enriched = enrichAnalysisNodesFromOutline({
      ...analysis,
      outline,
    });
    const contexts = buildConceptContextsFromAnalysis(enriched, {
      sessionId: record.meta.sessionId,
      projectSlug: record.meta.projectSlug,
    });
    nodes = contexts.map(nodeRowFromContext);
    if (!nodes.length) {
      nodes = (enriched.nodes ?? [])
        .slice(0, MAX_NODES_PER_SESSION)
        .map((n) =>
          nodeRowFromAnalysisNode(n, analysis.domains?.slice(0, 1) ?? [])
        );
    }
  } else {
    nodes = [];
  }

  if (role === "snapshot" && nodes.length > cap) {
    return prioritizeNodesForMergeInput(nodes, outlinePathKeys, cap);
  }
  return nodes.slice(0, cap);
}

function sessionFromRecord(
  record: SessionRecord,
  role: MergeSessionInputSession["role"]
): MergeSessionInputSession {
  const analysis = record.sessionAnalysis;
  const outline = record.outline;
  const outlinePathKeys = new Set<string>();
  collectOutlinePathKeys(outline?.outline ?? [], outlinePathKeys);
  const tree = serializeOutlineTree(outline?.outline ?? []);
  const nodes = buildNodesForRecord(record, role, outlinePathKeys);

  const session: MergeSessionInputSession = {
    sessionId: record.meta.sessionId,
    label: truncate(record.meta.sessionLabel ?? record.meta.sessionId, 80),
    role,
    domains: [...(analysis?.domains ?? [])],
    nodes,
    segmentEquivalences: analysis?.segmentEquivalences ?? [],
    outline: {
      title: truncate(outline?.title ?? record.meta.sessionLabel ?? "session", 80),
      summary: outline?.summary ? truncate(outline.summary, 160) : undefined,
      tree,
    },
  };

  if (role === "snapshot") {
    session.frozenTopRootKeys = frozenTopRootKeysFromRecord(record);
    session.frozenDomains = [...(analysis?.domains ?? [])];
  }

  return session;
}

/** Build structured input for M-merge session-analysis LLM. */
export function buildMergeSessionAnalysisInput(
  records: SessionRecord[],
  mergeMode: MergeInputMode = "full",
  snapshotSessionId?: string
): MergeSessionAnalysisInput {
  const sessions: MergeSessionInputSession[] = [];
  for (const record of records) {
    const isSnapshot =
      record.meta.sessionId === snapshotSessionId ||
      record.meta.sessionId === MERGE_SNAPSHOT_SESSION_ID ||
      (mergeMode === "delta" &&
        isMergeSnapshotSessionId(record.meta.sessionId));
    sessions.push(
      sessionFromRecord(
        record,
        isSnapshot ? "snapshot" : mergeMode === "delta" ? "batch" : "library"
      )
    );
  }
  return {
    mergeMode,
    snapshotSessionId,
    sessions,
  };
}

export function formatMergeSessionAnalysisInput(
  input: MergeSessionAnalysisInput
): string {
  return buildMergeSessionAnalysisTabularInput(input);
}

export const __testing = {
  MAX_SNAPSHOT_NODES,
  MAX_CONTEXTS_PER_SESSION,
  MAX_OUTLINE_LEAF_COUNT,
};
