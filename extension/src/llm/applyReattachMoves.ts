import { segmentKeyForMerge } from "./topicGraphValidate";
import type { ReattachMove } from "./types";
import type { SessionRecord } from "../store/storeTypes";

const DEFAULT_MIN_CONFIDENCE = 0.55;

/** Keep the highest-confidence move per root segment. */
export function consolidateReattachMoves(moves: ReattachMove[]): ReattachMove[] {
  const byFrom = new Map<string, ReattachMove>();
  for (const move of moves) {
    const key = segmentKeyForMerge(move.from);
    if (!key) {
      continue;
    }
    const prev = byFrom.get(key);
    if (!prev || (move.confidence ?? 0) > (prev.confidence ?? 0)) {
      byFrom.set(key, move);
    }
  }
  return [...byFrom.values()];
}

export function applyReattachMoveToPath(
  path: string[],
  move: ReattachMove
): string[] | undefined {
  if (!path.length) {
    return undefined;
  }
  const fromKey = segmentKeyForMerge(move.from);
  if (!fromKey || segmentKeyForMerge(path[0]) !== fromKey) {
    return undefined;
  }
  const dest = move.toPath.map((s) => s.trim()).filter(Boolean);
  if (!dest.length) {
    return undefined;
  }
  return [...dest, ...path.slice(1)];
}

export function applyReattachMovesToPath(
  path: string[],
  moves: ReattachMove[],
  minConfidence = DEFAULT_MIN_CONFIDENCE
): string[] {
  const fromKey = segmentKeyForMerge(path[0] ?? "");
  if (!fromKey) {
    return path;
  }
  for (const move of moves) {
    if (move.confidence !== undefined && move.confidence < minConfidence) {
      continue;
    }
    if (segmentKeyForMerge(move.from) !== fromKey) {
      continue;
    }
    const next = applyReattachMoveToPath(path, move);
    if (next) {
      return next;
    }
  }
  return path;
}

/** Rewrite topic conceptPaths on a shallow copy of records. */
export function applyReattachMovesToRecords(
  records: SessionRecord[],
  moves: ReattachMove[] | undefined,
  minConfidence = DEFAULT_MIN_CONFIDENCE
): SessionRecord[] {
  const consolidated = consolidateReattachMoves(moves ?? []);
  if (!consolidated.length) {
    return records;
  }
  return records.map((record) => {
    let changed = false;
    const topics = record.graph.topics.map((topic) => {
      if (!topic.conceptPath?.length) {
        return topic;
      }
      const next = applyReattachMovesToPath(
        topic.conceptPath,
        consolidated,
        minConfidence
      );
      if (
        next.length !== topic.conceptPath.length ||
        next.some((s, i) => s !== topic.conceptPath![i])
      ) {
        changed = true;
        return { ...topic, conceptPath: next };
      }
      return topic;
    });
    if (!changed) {
      return record;
    }
    return {
      ...record,
      graph: { ...record.graph, topics },
    };
  });
}
