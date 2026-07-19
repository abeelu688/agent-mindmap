/**
 * Chunked session analysis — split long sessions into sub-sessions,
 * analyze each independently, then merge the results mechanically.
 *
 * This avoids LLM timeouts on large sessions without changing the prompt,
 * schema, or downstream pipeline stages (S2, merge, etc.).
 */
import { groupTurns } from "../../llm/prompt";
import {
  analyzeSession,
  type AnalyzeSessionOpts,
  type AnalyzeSessionResult,
} from "./analyzeSession";
import type { CodeReference, LlmProvider, SessionAnalysis } from "../../llm/barrel";
import type { ChatEvent } from "../../transcript/types";
import type { ProgressReporter } from "../../ports/ProgressReporter";
import type { OutlineDetail, OutlineNode, SessionOutline } from "@agent-mindmap/shared";

// ── Split logic ─────────────────────────────────────────────────────────────

/** Default max turns per chunk before splitting kicks in. */
const DEFAULT_MAX_TURNS_PER_CHUNK = 12;

/**
 * Split events into chunks at turn boundaries.
 * Each chunk starts with a `user_query` (except possibly the very first events
 * before any user query, which are grouped into the first chunk).
 *
 * @returns Array of event arrays. Length 1 if no split needed.
 */
export function splitEventsByTurns(events: ChatEvent[], maxTurnsPerChunk: number): ChatEvent[][] {
  if (maxTurnsPerChunk <= 0) {
    return [events];
  }

  const turns = groupTurns(events);
  if (turns.length <= maxTurnsPerChunk) {
    return [events];
  }

  // Build a map: turnIndex → first event lineIndex in that turn
  // We split events by finding which turn each event belongs to,
  // then grouping events into chunks of ≤ maxTurnsPerChunk turns.

  // Re-group events by turn index
  const eventsByTurnIndex = new Map<number, ChatEvent[]>();
  let currentTurnIndex = 0;

  for (const ev of events) {
    if (ev.kind === "user_query") {
      // Find the turn index for this query
      const turnIdx = turns.findIndex((t) => t.query === ev.text && t.index >= currentTurnIndex);
      currentTurnIndex = turnIdx >= 0 ? turnIdx : currentTurnIndex;
    }
    const bucket = eventsByTurnIndex.get(currentTurnIndex);
    if (bucket) {
      bucket.push(ev);
    } else {
      eventsByTurnIndex.set(currentTurnIndex, [ev]);
    }
  }

  // Group turn indices into chunks
  const chunks: ChatEvent[][] = [];
  let chunkEvents: ChatEvent[] = [];
  let turnsInChunk = 0;

  for (let i = 0; i < turns.length; i++) {
    const turnEvents = eventsByTurnIndex.get(i) ?? [];
    if (turnsInChunk > 0 && turnsInChunk + 1 > maxTurnsPerChunk) {
      // Flush current chunk
      if (chunkEvents.length > 0) {
        chunks.push(chunkEvents);
      }
      chunkEvents = [];
      turnsInChunk = 0;
    }
    chunkEvents.push(...turnEvents);
    turnsInChunk++;
  }

  if (chunkEvents.length > 0) {
    chunks.push(chunkEvents);
  }

  return chunks.length <= 1 ? [events] : chunks;
}

// ── Merge logic ─────────────────────────────────────────────────────────────

/**
 * Remap `sourceTurnIndices` in outline details by adding `offset`.
 * Each sub-session's prompt starts turns from [Q1] (index 0),
 * but in the original session they start at `offset`.
 *
 * Also used by the virtual-session stage: the virtual session's prompt shows
 * new turns starting from [Q1], but in the parent transcript they start at
 * `startTurnIndex`. Remapping makes `sourceTurnIndices` point to the correct
 * turn in the parent transcript for jump-to-transcript features.
 */
export function remapOutlineTurnIndices(outline: SessionOutline, offset: number): SessionOutline {
  if (offset === 0) return outline;

  function remapNode(node: OutlineNode): OutlineNode {
    const remapped: OutlineNode = { ...node };
    if (node.children?.length) {
      remapped.children = node.children.map(remapNode);
    }
    if (node.details?.length) {
      remapped.details = node.details.map((d: OutlineDetail) => ({
        ...d,
        sourceTurnIndices: d.sourceTurnIndices?.map((i: number) => i + offset),
      }));
    }
    return remapped;
  }

  return {
    ...outline,
    outline: outline.outline.map(remapNode),
  };
}

/**
 * Get the turn offset for a chunk — how many user_query events appear
 * in the events *before* this chunk.
 */
function getTurnOffset(allEvents: ChatEvent[], chunkEvents: ChatEvent[]): number {
  const chunkStart = chunkEvents[0];
  if (!chunkStart) return 0;

  // Count user_query events before the first event of this chunk
  let offset = 0;
  for (const ev of allEvents) {
    if (ev === chunkStart) break;
    if (ev.kind === "user_query") offset++;
  }
  return offset;
}

/**
 * Merge multiple `SessionAnalysis` results into one.
 *
 * Merge rules:
 * - domains: union, dedup
 * - nodes: concat, dedup by key (merge aliases + evidence)
 * - mappings: concat
 * - segmentEquivalences: concat
 * - termAliases: concat
 * - outline: each sub-session's outline becomes a top-level branch
 * - codeReferences: concat, dedup by filePath
 */
export function mergeSessionAnalyses(
  results: SessionAnalysis[],
  turnOffsets: number[]
): SessionAnalysis {
  if (results.length === 0) {
    return {
      domains: [],
      nodes: [],
      segmentEquivalences: [],
      termAliases: [],
    };
  }

  if (results.length === 1) {
    const offset = turnOffsets[0] ?? 0;
    if (offset === 0) return results[0]!;
    // Still need to remap turn indices
    return remapAllSourceTurnIndices(results[0]!, offset);
  }

  // Merge domains
  const domainSet = new Set<string>();
  for (const r of results) {
    for (const d of r.domains) {
      domainSet.add(d);
    }
  }

  // Merge nodes (dedup by key)
  const nodeMap = new Map<string, (typeof results)[0]["nodes"][0]>();
  for (const r of results) {
    for (const node of r.nodes) {
      const existing = nodeMap.get(node.key);
      if (existing) {
        // Merge aliases and evidence
        const mergedAliases = [...new Set([...(existing.aliases ?? []), ...(node.aliases ?? [])])];
        const mergedEvidence = [
          ...new Set([...(existing.evidence ?? []), ...(node.evidence ?? [])]),
        ];
        nodeMap.set(node.key, {
          ...existing,
          aliases: mergedAliases.length > 0 ? mergedAliases : undefined,
          evidence: mergedEvidence,
        });
      } else {
        nodeMap.set(node.key, { ...node });
      }
    }
  }

  // Merge outlines: each sub-session's outline becomes a top-level branch
  const outlineParts: OutlineNode[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const offset = turnOffsets[i] ?? 0;
    if (!r.outline) continue;

    const remapped = remapOutlineTurnIndices(r.outline, offset);

    if (remapped.outline.length === 0) continue;

    if (results.length <= 3) {
      // For 2-3 chunks, nest each sub-session's outline under a "Part N" node
      outlineParts.push({
        title: `Part ${i + 1}`,
        children: remapped.outline,
      });
    } else {
      // For many chunks, just concatenate top-level children (avoid deep nesting)
      outlineParts.push(...remapped.outline);
    }
  }

  const firstOutline = results.find((r) => r.outline)?.outline;
  const mergedOutline: SessionOutline | undefined =
    outlineParts.length > 0
      ? {
          title: firstOutline?.title,
          summary: firstOutline?.summary,
          outline: outlineParts,
        }
      : undefined;

  // Merge code references (dedup by path)
  const codeRefMap = new Map<string, CodeReference>();
  for (const r of results) {
    for (const ref of r.codeReferences ?? []) {
      const key = ref.path;
      if (!codeRefMap.has(key)) {
        codeRefMap.set(key, ref);
      }
    }
  }

  return {
    domains: [...domainSet],
    nodes: [...nodeMap.values()],
    mappings: results.flatMap((r) => r.mappings ?? []),
    segmentEquivalences: results.flatMap((r) => r.segmentEquivalences),
    termAliases: results.flatMap((r) => r.termAliases ?? []),
    outline: mergedOutline,
    codeReferences: codeRefMap.size > 0 ? [...codeRefMap.values()] : undefined,
  };
}

/**
 * Remap all sourceTurnIndices in a SessionAnalysis by adding `offset`.
 */
function remapAllSourceTurnIndices(analysis: SessionAnalysis, offset: number): SessionAnalysis {
  if (offset === 0) return analysis;
  return {
    ...analysis,
    outline: analysis.outline ? remapOutlineTurnIndices(analysis.outline, offset) : undefined,
  };
}

// ── Main entry point ────────────────────────────────────────────────────────

export type AnalyzeSessionChunkedOpts = AnalyzeSessionOpts & {
  /** Max turns per chunk. Default: 12. Set to 0 to disable chunking. */
  maxTurnsPerChunk?: number;
};

/**
 * Analyze a session, automatically splitting into chunks if it has too many turns.
 *
 * For sessions within the turn limit, delegates directly to `analyzeSession()`.
 * For larger sessions, splits events, analyzes each chunk, and merges results.
 */
export async function analyzeSessionChunked(
  opts: AnalyzeSessionChunkedOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: ProgressReporter
): Promise<AnalyzeSessionResult> {
  const maxTurns = opts.maxTurnsPerChunk ?? DEFAULT_MAX_TURNS_PER_CHUNK;
  const chunks = splitEventsByTurns(opts.events, maxTurns);

  // No split needed — delegate directly
  if (chunks.length === 1) {
    return analyzeSession(opts, provider, signal, progress);
  }

  // Split and analyze each chunk sequentially
  const analyses: SessionAnalysis[] = [];
  const allCodeRefs: CodeReference[] = [];
  const turnOffsets: number[] = [];

  for (let i = 0; i < chunks.length; i++) {
    if (signal.aborted) break;

    const chunkEvents = chunks[i]!;
    progress?.report(`Analyzing session part ${i + 1}/${chunks.length}…`);

    const offset = getTurnOffset(opts.events, chunkEvents);
    turnOffsets.push(offset);

    const chunkResult = await analyzeSession(
      {
        ...opts,
        events: chunkEvents,
      },
      provider,
      signal,
      progress
    );

    analyses.push(chunkResult.analysis);

    if (chunkResult.initialCodeReferences) {
      allCodeRefs.push(...chunkResult.initialCodeReferences);
    }
  }

  // Merge all sub-session results
  const merged = mergeSessionAnalyses(analyses, turnOffsets);

  return {
    analysis: merged,
    initialCodeReferences: allCodeRefs.length > 0 ? allCodeRefs : undefined,
  };
}
