import type { MindMapNodeData, NodeOrigin, NodeOriginRef } from "../transcript/types";

/**
 * Shared session-level fields that every leaf / branch ref inherits.
 * `turnIndex` is filled in per-leaf when it's known.
 */
export type SessionMeta = Omit<NodeOriginRef, "turnIndex">;

function refKey(ref: NodeOriginRef): string {
  return `${ref.sessionId}#${ref.turnIndex ?? ""}`;
}

/** Dedup refs by (sessionId, turnIndex), preserving first-seen order. */
export function dedupRefs(refs: NodeOriginRef[]): NodeOriginRef[] {
  const seen = new Set<string>();
  const out: NodeOriginRef[] = [];
  for (const r of refs) {
    const k = refKey(r);
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(r);
  }
  return out;
}

/**
 * Union of refs across child nodes, with `turnIndex` stripped on the result.
 * The parent represents the whole subtree, so it always exposes a
 * session-level (branch / "整段会话") entry per session, plus the union of
 * specific turn refs the children carry.
 */
export function unionChildRefs(children: MindMapNodeData[]): NodeOriginRef[] {
  const all: NodeOriginRef[] = [];
  for (const child of children) {
    const refs = child.data.origin?.refs;
    if (!refs?.length) {
      continue;
    }
    for (const ref of refs) {
      all.push(ref);
    }
  }
  return dedupRefs(all);
}

/**
 * Build refs for a leaf-level node from its `sourceTurnIndices` (0-based
 * turn ids the LLM tagged on the item). Empty / missing falls back to a
 * single branch-level ref so the click flow still has somewhere to jump.
 */
export function leafRefs(
  session: SessionMeta,
  sourceTurnIndices?: number[]
): NodeOriginRef[] {
  if (sourceTurnIndices && sourceTurnIndices.length) {
    return dedupRefs(
      sourceTurnIndices
        .filter((n) => Number.isInteger(n) && n >= 0)
        .map((n) => ({ ...session, turnIndex: n }))
    );
  }
  return [{ ...session }];
}

/**
 * Attach `origin.refs` to a node when there's at least one ref. Empty input
 * yields no `origin` field so unrelated nodes remain inert on click.
 */
export function withOrigin(
  node: MindMapNodeData,
  refs: NodeOriginRef[]
): MindMapNodeData {
  if (!refs.length) {
    return node;
  }
  return {
    ...node,
    data: { ...node.data, origin: { refs: dedupRefs(refs) } },
  };
}

/** Convenience: wrap an existing origin (or empty) into a NodeOrigin. */
export function nodeOrigin(refs: NodeOriginRef[]): NodeOrigin | undefined {
  if (!refs.length) {
    return undefined;
  }
  return { refs: dedupRefs(refs) };
}
