import { filterProjectCodeReferences } from "../llm/filterCodeReferences";
import { leafRefs, type SessionMeta, unionChildRefs, withOrigin } from "./origin";
import { mindMapLabelsForOutputLanguage, type MindMapLanguageLabels } from "./outputLanguageLabels";
import type { CodeReference, OutlineNode, SessionOutline } from "../llm/types";
import type { MindMapNodeData, MindMapRoot } from "../transcript/types";

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

function buildCodeReferencesNode(
  refs: CodeReference[],
  sessionMeta: SessionMeta | undefined,
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
    const pathRefs = groups.get(p)!;
    const descNodes: MindMapNodeData[] = pathRefs.map((ref) => {
      const descLeaf = leaf(ref.description);
      if (!sessionMeta) {
        return descLeaf;
      }
      // Attach turn-level origin so clicking a description jumps to the right Q.
      const turnIndices = ref.sourceTurnIndices?.length ? ref.sourceTurnIndices : undefined;
      return withOrigin(descLeaf, leafRefs(sessionMeta, turnIndices));
    });
    // File path branch: union of its descriptions' refs
    const fileBranch = branch(p, descNodes, true);
    const fileRefs = unionChildRefs(descNodes);
    children.push(fileRefs.length ? withOrigin(fileBranch, fileRefs) : fileBranch);
  }
  const codeRefsRoot = branch(labels.relatedCode, children, false);
  const rootRefs = unionChildRefs(children);
  return rootRefs.length ? withOrigin(codeRefsRoot, rootRefs) : codeRefsRoot;
}

function renderOutlineNode(
  node: OutlineNode,
  sessionMeta: SessionMeta | undefined,
  labels: MindMapLanguageLabels
): MindMapNodeData {
  const children: MindMapNodeData[] = [];

  if (node.summary?.trim()) {
    const summaryNode = leaf(`${labels.summaryPrefix}${node.summary}`);
    children.push(sessionMeta ? withOrigin(summaryNode, [{ ...sessionMeta }]) : summaryNode);
  }

  for (const child of node.children ?? []) {
    children.push(renderOutlineNode(child, sessionMeta, labels));
  }

  for (const detail of node.details ?? []) {
    const refs = detail.sourceTurnIndices?.length
      ? ` (Q${detail.sourceTurnIndices.map((n) => n + 1).join("/Q")})`
      : "";
    const itemNode = leaf(`${detail.text}${refs}`);
    children.push(
      sessionMeta ? withOrigin(itemNode, leafRefs(sessionMeta, detail.sourceTurnIndices)) : itemNode
    );
  }

  const label = node.details?.length && node.summary?.trim() ? node.summary.trim() : node.title;
  const title = truncate(label, MAX_LABEL);
  if (!children.length) {
    const titleLeaf = leaf(title);
    return sessionMeta ? withOrigin(titleLeaf, [{ ...sessionMeta }]) : titleLeaf;
  }

  const built = branch(title, children);
  return sessionMeta ? withOrigin(built, unionChildRefs(children)) : built;
}

export function buildOutlineMindMap(
  outline: SessionOutline,
  sessionLabel?: string,
  sessionMeta?: SessionMeta,
  codeReferences?: CodeReference[],
  projectPath?: string,
  outputLanguage?: string
): MindMapRoot {
  const labels = mindMapLabelsForOutputLanguage(outputLanguage);
  const llmTitle = outline.title?.trim();
  const rootText = llmTitle
    ? truncate(llmTitle, 60)
    : sessionLabel
      ? truncate(sessionLabel, 80)
      : labels.sessionDefault;

  const topicNodes = outline.outline.map((node) => renderOutlineNode(node, sessionMeta, labels));

  const filteredRefs = codeReferences?.length
    ? filterProjectCodeReferences(codeReferences, projectPath ?? sessionMeta?.projectPath)
    : undefined;
  if (filteredRefs?.length) {
    topicNodes.push(buildCodeReferencesNode(filteredRefs, sessionMeta, labels));
  }

  const root: MindMapNodeData = {
    data: { text: rootText, expand: true },
    children: topicNodes.length ? topicNodes : undefined,
  };

  if (!sessionMeta || !topicNodes.length) {
    return root;
  }
  return withOrigin(root, unionChildRefs(topicNodes));
}
