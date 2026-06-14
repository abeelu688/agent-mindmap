import { dedupRefs, unionChildRefs, withOrigin } from "./origin";
import { mindMapLabelsForOutputLanguage, type MindMapLanguageLabels } from "./outputLanguageLabels";
import type { MergedOutline, MergedOutlineDetail, MergedOutlineNode } from "../llm/types";
import type { MindMapNodeData, MindMapRoot, NodeOriginRef } from "../transcript/types";
import type { SessionRecord } from "../store/storeTypes";

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

function refsForMergedDetail(
  records: SessionRecord[],
  sources: MergedOutlineDetail["sources"]
): NodeOriginRef[] {
  if (!sources?.length) {
    return [];
  }
  const refs: NodeOriginRef[] = [];
  for (const src of sources) {
    const rec = records[src.sessionIndex];
    if (!rec) {
      continue;
    }
    refs.push({
      sessionId: rec.meta.sessionId,
      projectSlug: rec.meta.projectSlug,
      projectPath: rec.meta.projectPath,
      sessionLabel: rec.meta.sessionLabel,
      transcriptPath: rec.meta.transcriptPath,
      turnIndex: src.turnIndex,
    });
  }
  return dedupRefs(refs);
}

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

function renderMergedNode(
  node: MergedOutlineNode,
  records: SessionRecord[],
  labels: MindMapLanguageLabels
): MindMapNodeData {
  const children: MindMapNodeData[] = [];

  if (node.summary?.trim()) {
    children.push(leaf(`${labels.summaryPrefix}${node.summary}`));
  }

  for (const child of node.children ?? []) {
    children.push(renderMergedNode(child, records, labels));
  }

  for (const detail of node.details ?? []) {
    const refs = refsForMergedDetail(records, detail.sources);
    const suffix =
      detail.sources?.length && detail.sources.some((s) => s.turnIndex !== undefined)
        ? ` (S${detail.sources.map((s) => s.sessionIndex + 1).join("/S")})`
        : "";
    const itemNode = leaf(`${detail.text}${suffix}`);
    children.push(refs.length ? withOrigin(itemNode, refs) : itemNode);
  }

  const title = truncate(node.title, 80);
  if (!children.length) {
    return leaf(title);
  }
  const built = branch(title, children);
  const refs = unionChildRefs(children);
  return refs.length ? withOrigin(built, refs) : built;
}

export function buildMergedOutlineMindMap(
  merged: MergedOutline,
  records: SessionRecord[],
  rootTitleOverride?: string
): MindMapRoot {
  const labels = mindMapLabelsForOutputLanguage(outputLanguageFromRecords(records));
  const rootText = rootTitleOverride?.trim() || merged.title?.trim() || "Merged Mind Map";
  const topicNodes = merged.outline.map((n) => renderMergedNode(n, records, labels));
  const root: MindMapNodeData = {
    data: { text: truncate(rootText, 60), expand: true },
    children: topicNodes.length ? topicNodes : undefined,
  };
  const refs = unionChildRefs(topicNodes);
  return refs.length ? withOrigin(root, refs) : root;
}
