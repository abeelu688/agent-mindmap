import { buildTopicMindMap } from "../mindmap/buildTopicMindMap";
import type { MindMapNodeData, MindMapRoot } from "../transcript/types";
import type { MergeRecord, SessionRecord } from "./storeTypes";

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

function branch(text: string, children: MindMapNodeData[]): MindMapNodeData {
  return {
    data: { text: truncate(text), expand: true },
    children: children.length ? children : undefined,
  };
}

function sessionBranch(record: SessionRecord): MindMapNodeData {
  // Reuse the per-session renderer so each session subtree looks identical to
  // the panel a user sees when they open that single session — just nested
  // under a project node.
  const subtree = buildTopicMindMap(record.graph, record.meta.sessionLabel);
  return {
    data: { text: subtree.data.text, expand: false },
    children: subtree.children,
  };
}

export type DeterministicMergeOptions = {
  /** Override the root node label. Defaults to "Agent Mind Map · 全部". */
  title?: string;
  /** Restrict to a specific project slug. Empty = all projects. */
  projectSlug?: string;
};

export function buildDeterministicMergeMindMap(
  records: SessionRecord[],
  options: DeterministicMergeOptions = {}
): MindMapRoot {
  const filtered = options.projectSlug
    ? records.filter((r) => r.meta.projectSlug === options.projectSlug)
    : records;

  // Group by projectSlug, sort sessions newest first.
  const byProject = new Map<string, SessionRecord[]>();
  for (const r of filtered) {
    const slug = r.meta.projectSlug;
    const arr = byProject.get(slug) ?? [];
    arr.push(r);
    byProject.set(slug, arr);
  }
  for (const arr of byProject.values()) {
    arr.sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
  }

  // Project order: most recently analyzed first.
  const projectKeys = [...byProject.keys()].sort((a, b) => {
    const am = byProject.get(a)![0].meta.analyzedAt;
    const bm = byProject.get(b)![0].meta.analyzedAt;
    return bm - am;
  });

  const projectNodes: MindMapNodeData[] = projectKeys.map((slug) => {
    const sessions = byProject.get(slug)!;
    // Prefer any record with a recorded projectPath over the slug fallback,
    // since older records may have been written before the slug-to-path
    // round-trip was added.
    const display =
      sessions.find((s) => s.meta.projectPath)?.meta.projectPath ?? slug;
    const sessionNodes = sessions.map(sessionBranch);
    return branch(`项目: ${display}`, sessionNodes);
  });

  const title =
    options.title ??
    (options.projectSlug
      ? `Agent Mind Map · ${options.projectSlug}`
      : "Agent Mind Map · 全部");

  if (!projectNodes.length) {
    return {
      data: { text: title, expand: true },
      children: [leaf("(库中暂无已分析的 session)")],
    };
  }

  return {
    data: { text: title, expand: true },
    children: projectNodes,
  };
}

export function buildDeterministicMergeRecord(
  records: SessionRecord[],
  options: DeterministicMergeOptions = {}
): MergeRecord {
  const filtered = options.projectSlug
    ? records.filter((r) => r.meta.projectSlug === options.projectSlug)
    : records;
  const projectSlugs = Array.from(
    new Set(filtered.map((r) => r.meta.projectSlug))
  ).sort();
  const sessionIds = filtered.map((r) => r.meta.sessionId);
  const mindMap = buildDeterministicMergeMindMap(records, options);
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
