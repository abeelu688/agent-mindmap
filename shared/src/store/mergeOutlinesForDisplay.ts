/**
 * Pure outline merge for read views (MCP `get_session_outline`, extension cache
 * hit). Concatenates the original session's outline with all virtual sessions'
 * outlines so the caller sees the full picture even though the original record
 * only covers turns [0, K).
 *
 * Kept in `shared/` (not `core/`) so the MCP server can use it without pulling
 * in the LLM-heavy `core/` bundle. The batch merge pipeline in core uses a
 * more sophisticated merge (`mergeSessionAnalyses` with domain/node dedup);
 * this function only handles the read-view case where the goal is display, not
 * cross-session ontology merge.
 *
 * Merge rules (mirrors `mergeSessionAnalyses` outline branch in core):
 * - outline: each record's outline becomes a top-level branch. For ≤3 records,
 *   wrap each in a `Part N` node so the user sees the boundary. For >3, flat
 *   concat to avoid deep nesting.
 * - codeReferences: dedup by path, first occurrence wins (original first).
 * - conceptContexts / other S2 artifacts: take from the original record.
 *
 * `turnOffsets` are all 0 here because virtual sessions' `sourceTurnIndices`
 * are already absolute (remapped in `analyzeVirtualSession`).
 */
import type { OutlineNode, SessionAnalysis, SessionOutline, SessionRecord } from "../storeTypes";

export function mergeOutlinesForDisplay(records: SessionRecord[]): SessionRecord | undefined {
  if (records.length === 0) return undefined;
  const original = records[0]!;

  const analyses: SessionAnalysis[] = [];
  for (const r of records) {
    if (r.sessionAnalysis) analyses.push(r.sessionAnalysis);
  }

  // Outline merge: each record's outline becomes a top-level branch.
  // For a single record (no virtuals), return its outline unchanged.
  const outlineParts: OutlineNode[] = [];
  if (records.length === 1) {
    outlineParts.push(...(original.outline?.outline ?? []));
  } else {
    for (let i = 0; i < records.length; i++) {
      const r = records[i]!;
      if (!r.outline || r.outline.outline.length === 0) continue;
      if (records.length <= 3) {
        outlineParts.push({
          title: `Part ${i + 1}`,
          children: r.outline.outline,
        });
      } else {
        outlineParts.push(...r.outline.outline);
      }
    }
  }

  const firstOutline = records.find((r) => r.outline)?.outline;
  const mergedOutline: SessionOutline | undefined =
    outlineParts.length > 0
      ? {
          title: firstOutline?.title,
          summary: firstOutline?.summary,
          outline: outlineParts,
        }
      : original.outline;

  // Code refs: dedup by path, original first.
  const codeRefMap = new Map<string, NonNullable<SessionAnalysis["codeReferences"]>[0]>();
  for (const r of records) {
    for (const ref of r.sessionAnalysis?.codeReferences ?? []) {
      if (!codeRefMap.has(ref.path)) codeRefMap.set(ref.path, ref);
    }
  }
  const mergedCodeRefs = [...codeRefMap.values()];

  // merged sessionAnalysis: take original's S2 artifacts, replace outline + codeRefs
  const mergedAnalysis: SessionAnalysis | undefined = original.sessionAnalysis
    ? {
        ...original.sessionAnalysis,
        outline: mergedOutline,
        codeReferences: mergedCodeRefs.length > 0 ? mergedCodeRefs : undefined,
      }
    : undefined;

  return {
    ...original,
    outline: mergedOutline ?? original.outline,
    sessionAnalysis: mergedAnalysis,
  };
}
