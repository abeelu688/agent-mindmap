import type { MindElixirData, NodeObj } from "mind-elixir";

export type NodeOriginRef = {
  sessionId: string;
  projectSlug: string;
  projectPath?: string;
  sessionLabel: string;
  transcriptPath: string;
  turnIndex?: number;
  jumpHref?: string;
};

export type NodeOrigin = {
  refs: NodeOriginRef[];
};

export type MindMapNodeData = {
  data: { text: string; expand?: boolean; origin?: NodeOrigin };
  children?: MindMapNodeData[];
};

export type NodeMetadata = {
  origin?: NodeOrigin;
};

let nextId = 0;

function uid(): string {
  nextId += 1;
  return `am${nextId}`;
}

function convertNode(node: MindMapNodeData): NodeObj<NodeMetadata> {
  const text = node.data?.text?.trim() || "(empty)";
  const expanded = node.data?.expand !== false;
  const origin = node.data?.origin;
  const children = (node.children ?? [])
    .map((child) => convertNode(child))
    .filter(Boolean);

  const obj: NodeObj<NodeMetadata> = {
    id: uid(),
    topic: text,
    expanded,
  };
  if (origin?.refs?.length) {
    obj.metadata = { origin };
  }
  if (children.length > 0) {
    obj.children = children;
  }
  return obj;
}

/** Map extension mind-map JSON to mind-elixir `MindElixirData`. */
export function toMindElixirData(root: MindMapNodeData): MindElixirData {
  nextId = 0;
  return { nodeData: convertNode(root) };
}

export function readOriginFromNodeObj(
  node: NodeObj<NodeMetadata> | undefined
): NodeOrigin | undefined {
  if (!node?.metadata?.origin) {
    return undefined;
  }
  const refs = node.metadata.origin.refs;
  if (!Array.isArray(refs) || refs.length === 0) {
    return undefined;
  }
  return node.metadata.origin;
}
