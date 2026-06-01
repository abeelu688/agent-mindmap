import type { ReparentChain } from "./trieReparentInput";
import { segmentKeyForMerge } from "./topicGraphValidate";
import type { ReattachMove } from "./types";
import type { SessionRecord } from "../store/storeTypes";

const DEFAULT_MIN_CONFIDENCE = 0.55;

/** Domain-agnostic: drop consecutive segments that normalize to the same key. */
export function collapseConsecutiveDuplicateSegments(
  segments: string[]
): string[] {
  const trimmed = segments.map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const seg of trimmed) {
    const key = segmentKeyForMerge(seg);
    if (
      out.length &&
      segmentKeyForMerge(out[out.length - 1]!) === key
    ) {
      continue;
    }
    out.push(seg);
  }
  return out;
}

type HubAttachGroup = {
  hubKey: string;
  hubLabel: string;
  hubTopicCount: number;
  entries: { move: ReattachMove; fromKey: string; chain?: ReparentChain }[];
};

function isSubordinateAttachShape(move: ReattachMove): boolean {
  const dest = move.toPath.map((s) => s.trim()).filter(Boolean);
  if (dest.length < 2) {
    return false;
  }
  const fromKey = segmentKeyForMerge(move.from);
  const lastKey = segmentKeyForMerge(dest[dest.length - 1]!);
  return fromKey.length > 0 && fromKey === lastKey;
}

function isSpecialistBranch(
  chain: ReparentChain | undefined,
  hubChain: ReparentChain | undefined
): boolean {
  if (!chain || !hubChain) {
    return false;
  }
  const chainKey = segmentKeyForMerge(chain.from);
  const hubKey = segmentKeyForMerge(hubChain.from);
  if (chainKey === hubKey) {
    return false;
  }
  if (chain.topicCount >= hubChain.topicCount + 3) {
    return true;
  }
  if (
    chain.topicCount >= 4 &&
    chain.childSegments.length >= 3
  ) {
    return true;
  }
  return false;
}

/**
 * When LLM emits multiple (B)-shaped moves to the same hub [H, X], thin duplicate
 * facets of H are promoted to (A) single-segment merges; substantive branches stay (B).
 * Domain-agnostic (uses topicCount / subtree size only).
 */
export function normalizeHubAttachMoves(
  moves: ReattachMove[],
  chains?: ReparentChain[]
): ReattachMove[] {
  if (!chains?.length || moves.length < 2) {
    return moves;
  }

  const chainByKey = new Map(
    chains.map((c) => [segmentKeyForMerge(c.from), c])
  );
  const hubGroups = new Map<string, HubAttachGroup>();
  const passthrough: ReattachMove[] = [];

  for (const move of moves) {
    if (!isSubordinateAttachShape(move)) {
      passthrough.push(move);
      continue;
    }
    const dest = move.toPath.map((s) => s.trim()).filter(Boolean);
    const hubKey = segmentKeyForMerge(dest[0]!);
    const fromKey = segmentKeyForMerge(move.from);
    const hubChain = chainByKey.get(hubKey);
    const hubLabel = hubChain?.from ?? dest[0]!;
    let group = hubGroups.get(hubKey);
    if (!group) {
      group = {
        hubKey,
        hubLabel,
        hubTopicCount: hubChain?.topicCount ?? 0,
        entries: [],
      };
      hubGroups.set(hubKey, group);
    }
    group.entries.push({
      move,
      fromKey,
      chain: chainByKey.get(fromKey),
    });
  }

  const normalized: ReattachMove[] = [...passthrough];
  for (const group of hubGroups.values()) {
    if (group.entries.length < 2) {
      normalized.push(...group.entries.map((e) => e.move));
      continue;
    }
    const hubChain = chainByKey.get(group.hubKey);
    for (const entry of group.entries) {
      if (entry.fromKey === group.hubKey) {
        normalized.push(entry.move);
        continue;
      }
      if (isSpecialistBranch(entry.chain, hubChain)) {
        normalized.push(entry.move);
        continue;
      }
      normalized.push({
        ...entry.move,
        toPath: [group.hubLabel],
        evidence: [
          ...(entry.move.evidence ?? []),
          "normalized: thin branch sharing hub with other attaches → synonym merge",
        ],
      });
    }
  }

  return normalized;
}

/** Apply (A) synonym moves before (B) attach moves when resolving chains. */
export function sortMovesForApplyOrder(moves: ReattachMove[]): ReattachMove[] {
  return [...moves].sort((a, b) => {
    const alen = a.toPath.map((s) => s.trim()).filter(Boolean).length;
    const blen = b.toPath.map((s) => s.trim()).filter(Boolean).length;
    if (alen !== blen) {
      return alen - blen;
    }
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}

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

/**
 * Rewrite toPath when an earlier move retargets a root (e.g. X→Y then Z→X/…).
 * Mechanical only — semantic synonym/subordinate decisions come from the LLM.
 */
export function resolveChainedReattachMoves(moves: ReattachMove[]): ReattachMove[] {
  const consolidated = consolidateReattachMoves(sortMovesForApplyOrder(moves));
  if (consolidated.length < 2) {
    return consolidated.map((move) => ({
      ...move,
      toPath: collapseConsecutiveDuplicateSegments(move.toPath),
    }));
  }

  const byFrom = new Map<string, ReattachMove>();
  for (const move of consolidated) {
    byFrom.set(segmentKeyForMerge(move.from), move);
  }

  const resolveSegments = (segments: string[]): string[] => {
    const trimmed = segments.map((s) => s.trim()).filter(Boolean);
    if (!trimmed.length) {
      return trimmed;
    }
    const firstKey = segmentKeyForMerge(trimmed[0]);
    const redirect = byFrom.get(firstKey);
    if (!redirect) {
      return trimmed;
    }
    const dest = redirect.toPath.map((s) => s.trim()).filter(Boolean);
    const resolvedDest = resolveSegments(dest);
    return collapseConsecutiveDuplicateSegments([
      ...resolvedDest,
      ...trimmed.slice(1),
    ]);
  };

  return consolidated.map((move) => ({
    ...move,
    toPath: collapseConsecutiveDuplicateSegments(resolveSegments(move.toPath)),
  }));
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
  return collapseConsecutiveDuplicateSegments([...dest, ...path.slice(1)]);
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
  const consolidated = resolveChainedReattachMoves(moves ?? []);
  if (!consolidated.length) {
    return records;
  }

  return records.map((record) => {
    let changed = false;
    const topics = record.graph.topics.map((topic) => {
      if (!topic.conceptPath?.length) {
        return topic;
      }
      const prev = topic.conceptPath;
      const next = applyReattachMovesToPath(
        prev,
        consolidated,
        minConfidence
      );
      if (
        next.length !== prev.length ||
        next.some((s, i) => s !== prev[i])
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
