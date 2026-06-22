import type { TranscriptSession } from "@agent-mindmap/core";
import type { SessionRecord, SnapshotManifest } from "../store/storeTypes";

/** Bump when canonical leaf slot rules change (requires hierarchy rebuild). */
export const SNAPSHOT_ASSIGNMENT_VERSION = 1;

export type SessionOrderingKey = {
  sessionId: string;
  mtimeMs: number;
};

export type LeafSlotAssignment = {
  leafId: string;
  slotIndex: number;
  memberIds: string[];
};

export type AffectedLeaf = {
  leafId: string;
  memberIds: string[];
  isNewLeaf: boolean;
};

export function leafSnapshotIdFromSlot(slotIndex: number): string {
  return `l1-${String(slotIndex + 1).padStart(4, "0")}`;
}

export function batchNoFromLeafId(leafId: string): number {
  const match = /^l1-(\d+)$/.exec(leafId);
  return match ? parseInt(match[1]!, 10) : 1;
}

export function sortSessionsForMerge(sessions: SessionOrderingKey[]): SessionOrderingKey[] {
  return [...sessions].sort((a, b) => {
    if (a.mtimeMs !== b.mtimeMs) {
      return a.mtimeMs - b.mtimeMs;
    }
    return a.sessionId.localeCompare(b.sessionId);
  });
}

export function sortTranscriptSessionsForMerge(sessions: TranscriptSession[]): TranscriptSession[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return sortSessionsForMerge(orderingKeysFromTranscriptSessions(sessions)).map(
    (key) => byId.get(key.sessionId)!
  );
}

export function orderingKeysFromTranscriptSessions(
  sessions: TranscriptSession[]
): SessionOrderingKey[] {
  return sessions.map((s) => ({ sessionId: s.id, mtimeMs: s.mtimeMs }));
}

export function orderingKeysFromRecords(records: SessionRecord[]): SessionOrderingKey[] {
  return records.map((r) => ({
    sessionId: r.meta.sessionId,
    mtimeMs: r.meta.transcriptMtimeMs ?? 0,
  }));
}

export function computeLeafSlots(
  sessions: SessionOrderingKey[],
  groupSize: number
): Map<string, LeafSlotAssignment> {
  const sorted = sortSessionsForMerge(sessions);
  const size = Math.max(1, Math.floor(groupSize));
  const map = new Map<string, LeafSlotAssignment>();

  for (let i = 0; i < sorted.length; i++) {
    const slotIndex = Math.floor(i / size);
    const leafId = leafSnapshotIdFromSlot(slotIndex);
    const slotStart = slotIndex * size;
    const memberIds = sorted.slice(slotStart, slotStart + size).map((s) => s.sessionId);
    map.set(sorted[i]!.sessionId, { leafId, slotIndex, memberIds });
  }
  return map;
}

export function getLeafMembersById(
  sessions: SessionOrderingKey[],
  leafId: string,
  groupSize: number
): string[] {
  for (const assignment of computeLeafSlots(sessions, groupSize).values()) {
    if (assignment.leafId === leafId) {
      return assignment.memberIds;
    }
  }
  return [];
}

export function leavesAffectedByFreshSessions(
  allSessions: SessionOrderingKey[],
  freshSessionIds: string[],
  manifest: SnapshotManifest | undefined,
  groupSize: number
): AffectedLeaf[] {
  const slots = computeLeafSlots(allSessions, groupSize);
  const affectedLeafIds = new Set<string>();

  for (const sid of freshSessionIds) {
    const assignment = slots.get(sid);
    if (assignment) {
      affectedLeafIds.add(assignment.leafId);
    }
  }

  const result: AffectedLeaf[] = [];
  for (const leafId of [...affectedLeafIds].sort()) {
    const memberIds = getLeafMembersById(allSessions, leafId, groupSize);
    const existingLeaf = manifest?.nodes.find((n) => n.id === leafId && n.level === 1);
    result.push({
      leafId,
      memberIds,
      isNewLeaf: !existingLeaf,
    });
  }
  return result;
}

export function manifestNeedsAssignmentRebuild(manifest: SnapshotManifest | undefined): boolean {
  if (!manifest) {
    return false;
  }
  return manifest.assignmentVersion !== SNAPSHOT_ASSIGNMENT_VERSION;
}

export function validateManifestAssignments(
  manifest: SnapshotManifest,
  allSessions: SessionOrderingKey[]
): boolean {
  const slots = computeLeafSlots(allSessions, manifest.groupSize);
  for (const [sid, expected] of slots) {
    if (manifest.sessionToLeafId[sid] !== expected.leafId) {
      return false;
    }
  }
  for (const sid of Object.keys(manifest.sessionToLeafId)) {
    if (!slots.has(sid)) {
      return false;
    }
  }
  return true;
}

export function leafAssignmentForSession(
  allSessions: SessionOrderingKey[],
  sessionId: string,
  groupSize: number
): LeafSlotAssignment | undefined {
  return computeLeafSlots(allSessions, groupSize).get(sessionId);
}

export const __testing = {
  leafSnapshotIdFromSlot,
  batchNoFromLeafId,
  sortSessionsForMerge,
  computeLeafSlots,
  leavesAffectedByFreshSessions,
  validateManifestAssignments,
};
