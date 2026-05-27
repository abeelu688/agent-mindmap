import type { MindMapRoot, NodeOriginRef } from "../transcript/types";

export function sanitizeSessionFileName(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  return safe.length > 0 ? safe : "session";
}

/** Collect unique session refs from a mind map tree (first-seen order). */
export function collectOriginRefs(root: MindMapRoot): NodeOriginRef[] {
  const bySession = new Map<string, NodeOriginRef>();

  const walk = (node: MindMapRoot): void => {
    const refs = node.data.origin?.refs;
    if (refs?.length) {
      for (const ref of refs) {
        if (!bySession.has(ref.sessionId)) {
          bySession.set(ref.sessionId, ref);
        }
      }
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  };

  walk(root);
  return [...bySession.values()];
}
