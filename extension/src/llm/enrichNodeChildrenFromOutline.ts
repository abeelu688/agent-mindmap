import type {
  ConceptOntologyNode,
  OutlineNode,
  SessionAnalysis,
  SessionOutline,
} from "./types";

export function normalizeConceptKey(key: string): string {
  return key.toLowerCase().trim();
}

function addChildEdge(
  childKeysByParent: Map<string, Set<string>>,
  parentKey: string,
  childKey: string
): void {
  const pk = normalizeConceptKey(parentKey);
  const ck = normalizeConceptKey(childKey);
  if (!pk || !ck || pk === ck) {
    return;
  }
  let set = childKeysByParent.get(pk);
  if (!set) {
    set = new Set();
    childKeysByParent.set(pk, set);
  }
  set.add(ck);
}

/** Collect parent→child edges from outline conceptPath segments. */
export function collectChildEdgesFromOutline(
  outline: SessionOutline
): Map<string, Set<string>> {
  const childKeysByParent = new Map<string, Set<string>>();

  const walk = (nodes: OutlineNode[]): void => {
    for (const node of nodes) {
      const path = node.conceptPath;
      if (path?.length && path.length >= 2) {
        for (let i = 0; i < path.length - 1; i++) {
          addChildEdge(childKeysByParent, path[i]!, path[i + 1]!);
        }
      }
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };

  walk(outline.outline ?? []);
  return childKeysByParent;
}

/** Collect parent→child edges from nodes[].parentKeys. */
export function collectChildEdgesFromParentKeys(
  nodes: ConceptOntologyNode[]
): Map<string, Set<string>> {
  const childKeysByParent = new Map<string, Set<string>>();
  for (const node of nodes) {
    const childKey = normalizeConceptKey(node.key);
    if (!childKey) {
      continue;
    }
    for (const p of node.parentKeys ?? []) {
      addChildEdge(childKeysByParent, p, childKey);
    }
  }
  return childKeysByParent;
}

function mergeChildEdgeMaps(
  ...maps: Map<string, Set<string>>[]
): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>();
  for (const map of maps) {
    for (const [parent, children] of map) {
      let set = merged.get(parent);
      if (!set) {
        set = new Set();
        merged.set(parent, set);
      }
      for (const c of children) {
        set.add(c);
      }
    }
  }
  return merged;
}

function sortedChildKeys(set: Set<string> | undefined): string[] {
  return set ? [...set].sort() : [];
}

/**
 * S2 DET: merge outline conceptPath + parentKeys inverse (+ existing childKeys)
 * into nodes[].childKeys; fill missing parentKeys when outline implies a parent.
 */
export function enrichAnalysisNodesFromOutline(
  analysis: SessionAnalysis
): SessionAnalysis {
  const nodes = analysis.nodes ?? [];
  const outline = analysis.outline;
  const fromParents = collectChildEdgesFromParentKeys(nodes);
  const fromOutline = outline
    ? collectChildEdgesFromOutline(outline)
    : new Map<string, Set<string>>();
  const merged = mergeChildEdgeMaps(fromParents, fromOutline);

  const nodesByKey = new Map<string, ConceptOntologyNode>();
  for (const node of nodes) {
    const k = normalizeConceptKey(node.key);
    if (k) {
      nodesByKey.set(k, node);
    }
  }

  for (const node of nodes) {
    for (const ck of node.childKeys ?? []) {
      const child = normalizeConceptKey(ck);
      const parent = normalizeConceptKey(node.key);
      if (parent && child) {
        addChildEdge(merged, parent, child);
      }
    }
  }

  const enrichedNodes: ConceptOntologyNode[] = nodes.map((node) => {
    const key = normalizeConceptKey(node.key);
    const childKeys = sortedChildKeys(merged.get(key));

    const parentKeysFromNode = (node.parentKeys ?? [])
      .map(normalizeConceptKey)
      .filter((p) => p && p !== key);
    let parentKeys = parentKeysFromNode;

    if (!parentKeys.length) {
      for (const [parent, children] of merged) {
        if (children.has(key)) {
          parentKeys = [parent];
          break;
        }
      }
    }

    return {
      ...node,
      parentKeys: parentKeys.length ? parentKeys : node.parentKeys,
      childKeys: childKeys.length ? childKeys : undefined,
    };
  });

  return {
    ...analysis,
    nodes: enrichedNodes,
  };
}
