import type { OutlineDetail, OutlineNode, SessionOutline } from "./types";

function sanitizeDetail(
  detail: OutlineDetail,
  userQueryCount: number
): OutlineDetail {
  if (!detail.sourceTurnIndices?.length || userQueryCount <= 0) {
    if (!detail.sourceTurnIndices?.length) {
      return detail;
    }
    const { sourceTurnIndices: _drop, ...rest } = detail;
    return rest;
  }
  const next = detail.sourceTurnIndices.filter((n) => n < userQueryCount);
  if (
    next.length === detail.sourceTurnIndices.length &&
    next.every((v, i) => v === detail.sourceTurnIndices![i])
  ) {
    return detail;
  }
  return {
    ...detail,
    sourceTurnIndices: next.length ? next : undefined,
  };
}

function sanitizeNode(node: OutlineNode, userQueryCount: number): OutlineNode {
  if (node.details?.length) {
    const details = node.details.map((d) => sanitizeDetail(d, userQueryCount));
    if (details.every((d, i) => d === node.details![i])) {
      return node;
    }
    return { ...node, details };
  }
  if (!node.children?.length) {
    return node;
  }
  let changed = false;
  const children = node.children.map((c) => {
    const next = sanitizeNode(c, userQueryCount);
    if (next !== c) {
      changed = true;
    }
    return next;
  });
  return changed ? { ...node, children } : node;
}

export function sanitizeSessionOutline(
  outline: SessionOutline,
  userQueryCount: number
): SessionOutline {
  let changed = false;
  const nextOutline = outline.outline.map((n) => {
    const next = sanitizeNode(n, userQueryCount);
    if (next !== n) {
      changed = true;
    }
    return next;
  });
  if (!changed) {
    return outline;
  }
  return { ...outline, outline: nextOutline };
}
