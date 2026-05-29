import { uiTranslate } from "../l10n/uiTranslate";
import { buildTopicMindMap } from "../mindmap/buildTopicMindMap";
import { type SessionMeta, unionChildRefs, withOrigin } from "../mindmap/origin";
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

function branch(text: string, children: MindMapNodeData[]): MindMapNodeData {
  return {
    data: { text: truncate(text), expand: true },
    children: children.length ? children : undefined,
  };
}

function recordSessionMeta(record: SessionRecord): SessionMeta {
  return {
    sessionId: record.meta.sessionId,
    projectSlug: record.meta.projectSlug,
    projectPath: record.meta.projectPath,
    sessionLabel: record.meta.sessionLabel,
    transcriptPath: record.meta.transcriptPath,
  };
}

function sessionBranch(record: SessionRecord): MindMapNodeData {
  // Reuse the per-session renderer so each session subtree looks identical to
  // the panel a user sees when they open that single session — just nested
  // under a project node. Caller must pass records sanitized via sanitizeRecordsForMerge.
  const sessionMeta = recordSessionMeta(record);
  const subtree = buildTopicMindMap(
    record.graph,
    record.meta.sessionLabel,
    sessionMeta
  );
  return {
    data: {
      text: subtree.data.text,
      expand: false,
      origin: subtree.data.origin,
    },
    children: subtree.children,
  };
}

export type DeterministicMergeOptions = {
  /** Override the root node label. Defaults to localized "Agent Mind Map · All". */
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
    const node = branch(
      uiTranslate("mindmap.merge.projectPrefix", "Project: {0}", display),
      sessionNodes
    );
    return withOrigin(node, unionChildRefs(sessionNodes));
  });

  const title =
    options.title ??
    (options.projectSlug
      ? `Agent Mind Map · ${options.projectSlug}`
      : uiTranslate("mindmap.merge.titleAll", "Agent Mind Map · All"));

  if (!projectNodes.length) {
    return {
      data: { text: title, expand: true },
      children: [
        leaf(
          uiTranslate(
            "mindmap.merge.empty.noSessions",
            "(No analyzed sessions in the library)"
          )
        ),
      ],
    };
  }

  const root: MindMapNodeData = {
    data: { text: title, expand: true },
    children: projectNodes,
  };
  return withOrigin(root, unionChildRefs(projectNodes));
}

export async function buildDeterministicMergeRecordAsync(
  records: SessionRecord[],
  options: DeterministicMergeOptions = {}
): Promise<MergeRecord> {
  const sanitized = await Promise.all(records.map((r) => sanitizeSessionRecord(r)));
  return buildDeterministicMergeRecord(sanitized, options);
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
