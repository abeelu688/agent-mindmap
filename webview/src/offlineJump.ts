import type { NodeOrigin, NodeOriginRef } from "./toMindElixir";

/** Minimal turn-matching from node label `(Q1)` / `(Q1/Q3)` tags (1-based display Q). */
function parseQTagsFromNodeLabel(label: string): number[] {
  const paren = /\(([^)]*Q\d[^)]*)\)/i.exec(label);
  if (!paren) {
    return [];
  }
  const out: number[] = [];
  const re = /Q(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paren[1]))) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1) {
      out.push(n - 1);
    }
  }
  return out;
}

function refKey(ref: NodeOriginRef): string {
  return `${ref.sessionId}#${ref.turnIndex ?? ""}`;
}

function hasOfflineJumpHref(href: string | undefined): boolean {
  if (!href) {
    return false;
  }
  // Legacy viewer: transcript path in hash (transcript-viewer.html#f=...)
  if (href.includes("file=") || href.includes("#f=")) {
    return true;
  }
  // Current export: pre-rendered static HTML (transcripts/foo.html#q-N)
  return href.includes("transcripts/") && href.includes(".html");
}

function pickRef(
  refs: NodeOriginRef[],
  nodeLabel?: string
): NodeOriginRef | undefined {
  if (refs.length === 1) {
    return refs[0];
  }
  const qTags = nodeLabel ? parseQTagsFromNodeLabel(nodeLabel) : [];
  if (qTags.length) {
    const match = refs.find(
      (r) => r.turnIndex !== undefined && qTags.includes(r.turnIndex)
    );
    if (hasOfflineJumpHref(match?.jumpHref)) {
      return match;
    }
  }
  return refs.find((r) => hasOfflineJumpHref(r.jumpHref)) ?? refs[0];
}

/** Resolve offline jump href from node origin (export bundles only). */
export function resolveOfflineJumpHref(
  origin: NodeOrigin,
  nodeLabel?: string
): string | undefined {
  const refs = origin.refs.filter((r) => hasOfflineJumpHref(r.jumpHref));
  if (!refs.length) {
    return undefined;
  }
  const seen = new Set<string>();
  const deduped: NodeOriginRef[] = [];
  for (const r of refs) {
    const k = refKey(r);
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    deduped.push(r);
  }
  return pickRef(deduped, nodeLabel)?.jumpHref;
}
