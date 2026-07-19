/**
 * Virtual session storage and identification helpers.
 *
 * A virtual session is an independent {@link SessionRecord} whose id has the
 * form `<parentSessionId>#v<N>` (1-based). Its `meta.parentSessionId` points
 * back to the original session, and `meta.startTurnIndex` / `endTurnIndex`
 * record which slice of the original transcript it covers. The original
 * session's record is never mutated; virtual sessions enter the batch merge
 * pipeline as if they were ordinary new sessions.
 *
 * See `plans/virtual-session-incremental-analysis.md` (D2 = B) for the design
 * rationale.
 */
import { mergeOutlinesForDisplay, outlineToTopicGraph } from "@agent-mindmap/shared";
import { groupTurns, type Turn } from "../llm/prompt";
import { sha256Hex } from "./sessionStore";
import type { OutlineNode, SessionAnalysis, SessionRecord, Store } from "@agent-mindmap/shared";
import type { ChatEvent } from "../transcript/types";

// ── ID helpers ─────────────────────────────────────────────────────────────

const VIRTUAL_SUFFIX_SEP = "#v";

export function isVirtualSessionId(sessionId: string): boolean {
  return parseVirtualSessionId(sessionId) !== undefined;
}

/**
 * Build a virtual session id `<parentSessionId>#v<index>` (1-based).
 * Throws if `index < 1` - the original session is `<parentSessionId>` (no suffix).
 */
export function virtualSessionId(parentSessionId: string, index: number): string {
  if (index < 1) {
    throw new Error(`virtualSessionIndex must be >= 1, got ${index}`);
  }
  return `${parentSessionId}${VIRTUAL_SUFFIX_SEP}${index}`;
}

/**
 * Parse `<parentSessionId>#v<index>` into its parts. Returns `undefined` for
 * original session ids (no `#v` suffix) or malformed suffixes.
 */
export function parseVirtualSessionId(
  sessionId: string
): { parentSessionId: string; index: number } | undefined {
  const idx = sessionId.lastIndexOf(VIRTUAL_SUFFIX_SEP);
  if (idx < 0) return undefined;
  const parent = sessionId.slice(0, idx);
  if (!parent) return undefined;
  const num = sessionId.slice(idx + VIRTUAL_SUFFIX_SEP.length);
  const parsed = Number.parseInt(num, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== num) {
    return undefined;
  }
  return { parentSessionId: parent, index: parsed };
}

// ── Turn hashing ───────────────────────────────────────────────────────────

/**
 * Hash a single turn's content. Excludes the positional `index` field so the
 * hash stays stable when content is unchanged but turns shift position (e.g.
 * when a new turn is inserted at the start).
 *
 * The hash covers user query, tool labels, file paths, and assistant summary -
 * everything {@link groupTurns} collects per turn. If any of these change,
 * the hash changes and delta detection treats the turn as "needs re-analysis".
 */
function hashTurn(turn: Turn): string {
  return sha256Hex(
    JSON.stringify({
      query: turn.query ?? "",
      tools: turn.tools,
      filePaths: turn.filePaths,
      summary: turn.summary ?? "",
    })
  );
}

/**
 * Compute per-turn sha256 hashes for a transcript. Used as the freshness
 * signal for delta detection: when stored hashes match the current
 * transcript's first N turns, those turns are "frozen" and the next virtual
 * session starts at turn N.
 */
export function computeTurnHashes(events: ChatEvent[]): string[] {
  return groupTurns(events).map(hashTurn);
}

// ── Virtual session listing ────────────────────────────────────────────────

/**
 * List all virtual sessions (`<sid>#v*`) of `parentSessionId` in `projectSlug`,
 * sorted by `virtualSessionIndex` ascending.
 *
 * Returns an empty array if there are no virtual sessions yet (i.e. the
 * session has only been analyzed once, as the original record).
 */
export async function listVirtualSessions(
  store: Store,
  projectSlug: string,
  parentSessionId: string
): Promise<SessionRecord[]> {
  const all = await store.listRecordsForProject(projectSlug);
  const virtuals = all.filter((r) => r.meta.parentSessionId === parentSessionId);
  virtuals.sort((a, b) => (a.meta.virtualSessionIndex ?? 0) - (b.meta.virtualSessionIndex ?? 0));
  return virtuals;
}

/**
 * Pick the next available 1-based virtual session index for `parentSessionId`.
 * Returns 1 if no virtual sessions exist yet.
 */
export function nextVirtualSessionIndex(virtuals: SessionRecord[]): number {
  if (virtuals.length === 0) return 1;
  const maxIndex = virtuals.reduce((max, r) => Math.max(max, r.meta.virtualSessionIndex ?? 0), 0);
  return maxIndex + 1;
}

// ── Delta detection ────────────────────────────────────────────────────────

/**
 * Concatenate the original session's `turnHashes` with all virtual sessions'
 * `turnHashes` (in `virtualSessionIndex` order) to reconstruct the full stored
 * hash sequence covering turns [0, K) of the original transcript.
 *
 * Returns `undefined` if the original session lacks `turnHashes` (legacy record
 * from before virtual-session support) - callers should fall back to full
 * re-analysis in that case.
 */
export function buildStoredTurnHashes(
  original: SessionRecord,
  virtuals: SessionRecord[]
): string[] | undefined {
  if (!original.meta.turnHashes || original.meta.turnHashes.length === 0) {
    return undefined;
  }
  const sorted = [...virtuals].sort(
    (a, b) => (a.meta.virtualSessionIndex ?? 0) - (b.meta.virtualSessionIndex ?? 0)
  );
  const stored = [...original.meta.turnHashes];
  for (const v of sorted) {
    if (!v.meta.turnHashes) {
      // A virtual session without turnHashes is corrupt or legacy; treat the
      // whole stored sequence as unreliable.
      return undefined;
    }
    stored.push(...v.meta.turnHashes);
  }
  return stored;
}

/**
 * Result of delta detection between stored and current turn hashes.
 *
 * - `"fresh"`: all stored hashes match current - no analysis needed (cache hit).
 * - `"append"`: stored hashes are a prefix of current - new turns start at
 *   `startTurnIndex` (== stored.length). Create a new virtual session.
 * - `"edit"`: hashes diverge before stored.length - prior turns were edited
 *   or deleted. Caller should fall back to full re-analysis.
 */
export type DeltaDetectionResult =
  | { kind: "fresh"; startTurnIndex: number }
  | { kind: "append"; startTurnIndex: number }
  | { kind: "edit"; startTurnIndex: number };

/**
 * Compare stored turn hashes against current transcript's turn hashes and
 * decide where the next analysis should start.
 *
 * See {@link DeltaDetectionResult} for the three possible outcomes. The
 * `startTurnIndex` for `"fresh"` is `currentHashes.length` (no work to do);
 * for `"append"` it's `storedHashes.length` (new turns begin there); for
 * `"edit"` it's the first divergence point (for diagnostics - caller falls
 * back to full re-analysis regardless).
 */
export function detectTurnDelta(
  storedHashes: string[],
  currentHashes: string[]
): DeltaDetectionResult {
  if (currentHashes.length < storedHashes.length) {
    // Turns were deleted - treat as edit.
    return { kind: "edit", startTurnIndex: currentHashes.length };
  }
  const minLen = Math.min(storedHashes.length, currentHashes.length);
  for (let i = 0; i < minLen; i++) {
    if (storedHashes[i] !== currentHashes[i]) {
      return { kind: "edit", startTurnIndex: i };
    }
  }
  if (currentHashes.length === storedHashes.length) {
    return { kind: "fresh", startTurnIndex: currentHashes.length };
  }
  return { kind: "append", startTurnIndex: storedHashes.length };
}

// ── Event slicing ──────────────────────────────────────────────────────────

/**
 * Group events into per-turn arrays, mirroring {@link groupTurns} indexing.
 *
 * Turn 0 contains any leading events before the first `user_query` (matches
 * `groupTurns` which creates an empty turn 0 in that case). Each subsequent
 * turn starts at a `user_query` event and contains all events up to (but not
 * including) the next `user_query`.
 */
export function groupEventsByTurn(events: ChatEvent[]): ChatEvent[][] {
  const groups: ChatEvent[][] = [];
  let current: ChatEvent[] | null = null;
  for (const ev of events) {
    if (ev.kind === "user_query") {
      if (current !== null) groups.push(current);
      current = [];
    }
    if (current === null) {
      current = [];
    }
    current.push(ev);
  }
  if (current !== null) groups.push(current);
  return groups;
}

/**
 * Extract events covering turns `[startTurn, endTurn)` (0-based, endTurn
 * exclusive). Returns an empty array if the range is empty or out of bounds.
 *
 * Turn indices match {@link groupTurns} / {@link groupEventsByTurn} output.
 */
export function sliceEventsByTurns(
  events: ChatEvent[],
  startTurn: number,
  endTurn: number
): ChatEvent[] {
  if (startTurn >= endTurn || startTurn < 0) return [];
  const groups = groupEventsByTurn(events);
  const sliced: ChatEvent[] = [];
  for (let i = startTurn; i < endTurn && i < groups.length; i++) {
    sliced.push(...groups[i]!);
  }
  return sliced;
}

// ── Context primer construction ─────────────────────────────────────────────

/**
 * Build a {@link VirtualSessionContextPrimer} from the original session and
 * prior virtual sessions. Extracts topic titles + concept paths + key code
 * refs in the compressed format the virtual session prompt expects.
 *
 * Exported for the analyze flow; tests can call it directly to verify shape.
 */
export function buildContextPrimerFromRecords(
  original: SessionRecord,
  virtuals: SessionRecord[]
): {
  originalSessionLabel: string;
  virtualSessionIndex: number;
  priorTopics: { title: string; conceptPath?: string[] }[];
  priorCodeRefs: { path: string; description: string }[];
} {
  const priorTopics: { title: string; conceptPath?: string[] }[] = [];

  const collectTopics = (record: SessionRecord) => {
    const walk = (nodes: OutlineNode[]) => {
      for (const node of nodes) {
        if (node.children?.length) {
          walk(node.children);
        } else {
          priorTopics.push({
            title: node.title,
            conceptPath: node.conceptPath,
          });
        }
      }
    };
    walk(record.outline.outline);
  };

  collectTopics(original);
  for (const v of [...virtuals].sort(
    (a, b) => (a.meta.virtualSessionIndex ?? 0) - (b.meta.virtualSessionIndex ?? 0)
  )) {
    collectTopics(v);
  }

  const priorCodeRefs: { path: string; description: string }[] = [];
  const seenPaths = new Set<string>();
  const collectCodeRefs = (record: SessionRecord) => {
    for (const ref of record.sessionAnalysis?.codeReferences ?? []) {
      if (seenPaths.has(ref.path)) continue;
      seenPaths.add(ref.path);
      priorCodeRefs.push({ path: ref.path, description: ref.description ?? "" });
    }
  };
  collectCodeRefs(original);
  for (const v of virtuals) collectCodeRefs(v);

  return {
    originalSessionLabel: original.meta.sessionLabel,
    virtualSessionIndex: nextVirtualSessionIndex(virtuals),
    priorTopics,
    priorCodeRefs,
  };
}

// ── Read view merge ────────────────────────────────────────────────────────

/**
 * Merge the original session record with all its virtual sessions into a
 * single record view. Used by read paths (`get_session_outline` MCP tool,
 * `analyzeSession` cache hit) so callers see the full outline even though
 * the original session's record only covers turns [0, K).
 *
 * Delegates the actual outline/code-ref merging to
 * {@link mergeOutlinesForDisplay} in `shared/` so the MCP server can use the
 * same logic without depending on `core/`.
 *
 * If there are no virtual sessions, returns `original` unchanged.
 */
export async function readMergedSessionRecord(
  store: Store,
  projectSlug: string,
  sessionId: string
): Promise<SessionRecord | undefined> {
  const original = await store.getRecord(projectSlug, sessionId);
  if (!original) return undefined;
  if (!original.meta.turnHashes) return original;

  const virtuals = await listVirtualSessions(store, projectSlug, sessionId);
  if (virtuals.length === 0) return original;

  const merged = mergeOutlinesForDisplay([original, ...virtuals]);
  if (!merged) return original;

  return {
    ...merged,
    // graph is derived from outline; rebuild from merged outline so the
    // cached graph doesn't show stale (original-only) topics.
    graph: outlineToTopicGraph(merged.outline),
  };
}
