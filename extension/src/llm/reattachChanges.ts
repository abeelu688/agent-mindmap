import { segmentKeyForMerge } from "./topicGraphValidate";
import type { ReattachStep } from "./types";

/** LLM-facing delta merge change (segment keys / labels, not node ids). */
export type ReattachTreeChange =
  | {
      kind: "attach";
      hub: string;
      node: string;
      note?: string;
    }
  | {
      kind: "merge";
      keep: string;
      remove: string;
      note?: string;
    };

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function pickSegment(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (typeof v !== "string") {
    return undefined;
  }
  const t = v.replace(/\s+/g, " ").trim();
  return t || undefined;
}

/** Parse `changes[]` from delta M-merge LLM JSON. */
export function parseReattachChangesList(raw: unknown): ReattachTreeChange[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ReattachTreeChange[] = [];
  for (const item of raw) {
    const obj = asObject(item);
    if (!obj) {
      continue;
    }
    const kind = pickSegment(obj, "kind")?.toLowerCase();
    if (kind === "attach") {
      const hub = pickSegment(obj, "hub") ?? pickSegment(obj, "parent");
      const node = pickSegment(obj, "node") ?? pickSegment(obj, "child");
      if (!hub || !node) {
        continue;
      }
      out.push({
        kind: "attach",
        hub,
        node,
        note: pickSegment(obj, "note"),
      });
    } else if (kind === "merge") {
      const keep = pickSegment(obj, "keep") ?? pickSegment(obj, "into");
      const remove = pickSegment(obj, "remove") ?? pickSegment(obj, "from");
      if (!keep || !remove) {
        continue;
      }
      out.push({
        kind: "merge",
        keep,
        remove,
        note: pickSegment(obj, "note"),
      });
    }
    if (out.length >= 200) {
      break;
    }
  }
  return out;
}

/** Convert human-readable tree changes → internal reattach steps (segment paths only). */
export function reattachChangesToSteps(changes: ReattachTreeChange[]): ReattachStep[] {
  const steps: ReattachStep[] = [];
  let n = 1;
  for (const change of changes) {
    if (change.kind === "attach") {
      const hub = change.hub.trim();
      const node = change.node.trim();
      if (!hub || !node) {
        continue;
      }
      if (segmentKeyForMerge(hub) === segmentKeyForMerge(node)) {
        continue;
      }
      steps.push({
        step: n++,
        kind: "attach_under",
        sourceFrom: node,
        targetPath: [hub, node],
        action: `${hub}->${node}（${node} 顶根去除，挂到 ${hub} 下）`,
        result: `${hub}->${node}`,
        confidence: 0.88,
        evidence: change.note ? [change.note] : [`change:attach ${hub}->${node}`],
      });
    } else {
      const keep = change.keep.trim();
      const remove = change.remove.trim();
      if (!keep || !remove) {
        continue;
      }
      if (segmentKeyForMerge(keep) === segmentKeyForMerge(remove)) {
        continue;
      }
      steps.push({
        step: n++,
        kind: "merge_synonym",
        sourceFrom: remove,
        targetPath: [keep],
        action: `${remove} 并进 ${keep}（${remove} 子节点归 ${keep}，${remove} 顶根去除）`,
        result: `merge ${remove}->${keep}`,
        confidence: 0.88,
        evidence: change.note ? [change.note] : [`change:merge ${remove}->${keep}`],
      });
    }
  }
  return steps;
}

export function tryParseReattachChangesResponse(value: unknown): ReattachStep[] {
  const root = asObject(value);
  if (!root || !Array.isArray(root.changes)) {
    return [];
  }
  return reattachChangesToSteps(parseReattachChangesList(root.changes));
}
