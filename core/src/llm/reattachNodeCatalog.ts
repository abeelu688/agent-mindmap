import type { ReattachStep } from "./types";

/** Minimal chain shape for catalog numbering (avoids import cycle). */
export type CatalogChainInput = {
  chainIndex: number;
  from: string;
  label: string;
  topicCount: number;
  childSegments: string[];
  pathSamples: string[][];
  keywords: string[];
  subtree: CatalogSubtreeInput;
};

export type CatalogSubtreeInput = {
  segment: string;
  label: string;
  topicCount: number;
  children: CatalogSubtreeInput[];
};

/** One node in the draft mind map (stable id for LLM steps). */
export type ReattachCatalogNode = {
  id: string;
  /** Segment keys from map root to this node (for apply). */
  path: string[];
  segment: string;
  label: string;
  depth: number;
  /** Set for parallel top-level chain roots only. */
  chainIndex?: number;
  isTopRoot: boolean;
};

export type NumberedSubtreeNode = {
  id: string;
  segment: string;
  label: string;
  topicCount: number;
  children: NumberedSubtreeNode[];
};

/** Top-level chain with id-annotated subtree (LLM input). */
export type NumberedReparentChain = {
  chainIndex: number;
  rootNodeId: string;
  from: string;
  label: string;
  topicCount: number;
  childSegmentIds: string[];
  pathSamples: string[][];
  keywords: string[];
  tree: NumberedSubtreeNode;
};

export type ReattachNodeCatalog = {
  nodes: ReattachCatalogNode[];
  byId: Map<string, ReattachCatalogNode>;
  numberedChains: NumberedReparentChain[];
};

function numberedSubtree(
  node: CatalogSubtreeInput,
  pathSegments: string[],
  chainIndex: number,
  isRoot: boolean,
  nodes: ReattachCatalogNode[],
  nextId: { n: number }
): NumberedSubtreeNode {
  const id = `N${nextId.n++}`;
  const path = isRoot ? [node.segment] : [...pathSegments, node.segment];
  nodes.push({
    id,
    path,
    segment: node.segment,
    label: node.label,
    depth: path.length - 1,
    chainIndex: isRoot ? chainIndex : undefined,
    isTopRoot: isRoot,
  });

  const children = node.children.map((child) =>
    numberedSubtree(child, path, chainIndex, false, nodes, nextId)
  );

  return {
    id,
    segment: node.segment,
    label: node.label,
    topicCount: node.topicCount,
    children,
  };
}

/** Assign N1…Nn across all chain roots and subtrees (deterministic DFS). */
export function buildReattachNodeCatalog(
  chains: CatalogChainInput[]
): ReattachNodeCatalog {
  const nodes: ReattachCatalogNode[] = [];
  const nextId = { n: 1 };

  const numberedChains: NumberedReparentChain[] = chains.map((chain) => {
    const tree = numberedSubtree(
      chain.subtree,
      [],
      chain.chainIndex,
      true,
      nodes,
      nextId
    );

    const childSegmentIds = chain.childSegments
      .map((seg) => {
        const child = tree.children.find((c) => c.segment === seg);
        return child?.id;
      })
      .filter((id): id is string => Boolean(id));

    return {
      chainIndex: chain.chainIndex,
      rootNodeId: tree.id,
      from: chain.from,
      label: chain.label,
      topicCount: chain.topicCount,
      childSegmentIds,
      pathSamples: chain.pathSamples,
      keywords: chain.keywords,
      tree,
    };
  });

  return {
    nodes,
    byId: new Map(nodes.map((n) => [n.id, n])),
    numberedChains,
  };
}

function pathFromNodeIds(
  ids: string[],
  byId: Map<string, ReattachCatalogNode>
): string[] | undefined {
  const segments: string[] = [];
  for (const id of ids) {
    const node = byId.get(id);
    if (!node) {
      return undefined;
    }
    segments.push(node.segment);
  }
  return segments;
}

/**
 * Resolve LLM step node ids → sourceFrom / targetPath for the apply pipeline.
 * Legacy steps that already set sourceFrom + targetPath pass through unchanged.
 */
export function resolveReattachStepWithCatalog(
  step: ReattachStep,
  catalog: ReattachNodeCatalog
): ReattachStep | undefined {
  const { byId } = catalog;
  const hasIds =
    Boolean(step.sourceNodeId) ||
    Boolean(step.targetNodeId) ||
    Boolean(step.targetNodeIds?.length);

  if (!hasIds) {
    if (!step.sourceFrom || !step.targetPath?.length) {
      return undefined;
    }
    return step;
  }

  let sourceFrom = step.sourceFrom;
  let targetPath = step.targetPath;

  if (step.sourceNodeId) {
    const src = byId.get(step.sourceNodeId);
    if (!src?.isTopRoot) {
      return undefined;
    }
    sourceFrom = src.segment;
  }

  if (step.kind === "merge_synonym") {
    const targetId = step.targetNodeId ?? step.targetNodeIds?.[0];
    if (targetId) {
      const tgt = byId.get(targetId);
      if (!tgt?.isTopRoot) {
        return undefined;
      }
      targetPath = [tgt.segment];
    }
  } else if (step.kind === "attach_under") {
    if (step.targetNodeIds?.length) {
      const resolved = pathFromNodeIds(step.targetNodeIds, byId);
      if (!resolved?.length) {
        return undefined;
      }
      targetPath = resolved;
    } else if (step.targetNodeId) {
      const tgt = byId.get(step.targetNodeId);
      if (!tgt) {
        return undefined;
      }
      targetPath = tgt.path;
    }
  }

  if (!sourceFrom || !targetPath?.length) {
    return undefined;
  }

  if (step.kind === "merge_synonym" && targetPath.length !== 1) {
    return undefined;
  }
  if (step.kind === "attach_under" && targetPath.length < 2) {
    return undefined;
  }

  const lastSeg = targetPath[targetPath.length - 1];
  if (step.kind === "attach_under" && lastSeg !== sourceFrom) {
    return undefined;
  }

  return {
    ...step,
    sourceFrom,
    targetPath,
  };
}

export function resolveReattachStepsWithCatalog(
  steps: ReattachStep[],
  catalog: ReattachNodeCatalog
): ReattachStep[] {
  const resolved: ReattachStep[] = [];
  for (const step of steps) {
    const next = resolveReattachStepWithCatalog(step, catalog);
    if (next) {
      resolved.push(next);
    }
  }
  return resolved;
}
