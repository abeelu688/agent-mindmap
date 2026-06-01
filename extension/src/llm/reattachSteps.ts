import {
  applyReattachMovesToRecords,
  normalizeHubAttachMoves,
} from "./applyReattachMoves";
import { segmentsInSameEquivalenceGroup } from "./reattachStructuralHints";
import type { ReparentChain, TopBranchSynonymHint } from "./trieReparentInput";
import type { ReattachMove, ReattachStep, ReattachStepKind } from "./types";
import type { SegmentEquivalence } from "./types";
import { segmentKeyForMerge } from "./topicGraphValidate";
import type { SessionRecord } from "../store/storeTypes";

export function reattachStepToMove(step: ReattachStep): ReattachMove {
  return {
    from: step.sourceFrom,
    toPath: step.targetPath,
    confidence: step.confidence,
    evidence: [step.action, step.result, ...(step.evidence ?? [])],
  };
}

export function reattachStepsToMoves(steps: ReattachStep[]): ReattachMove[] {
  return sortReattachStepsForApply(steps).map(reattachStepToMove);
}

/** merge_synonym before attach_under; preserve step order within each kind. */
export function sortReattachStepsForApply(steps: ReattachStep[]): ReattachStep[] {
  return [...steps].sort((a, b) => {
    const rank = (k: ReattachStepKind) => (k === "merge_synonym" ? 0 : 1);
    const r = rank(a.kind) - rank(b.kind);
    return r !== 0 ? r : a.step - b.step;
  });
}

/**
 * LLM sometimes uses attach_under [hub, src] for parallel top roots that M2
 * already marked as synonyms — promote to merge_synonym (domain-agnostic via hints).
 */
function shouldPromoteParallelTopSynonym(
  hubKey: string,
  srcKey: string,
  topKeys: Set<string>,
  topBranchSynonymHints: TopBranchSynonymHint[],
  segmentEquivalences: SegmentEquivalence[]
): boolean {
  if (!topKeys.has(hubKey) || !topKeys.has(srcKey)) {
    return false;
  }
  const inHint = topBranchSynonymHints.some((hint) => {
    const branchKeys = new Set(
      hint.branches.map((b) => segmentKeyForMerge(b))
    );
    return branchKeys.has(hubKey) && branchKeys.has(srcKey);
  });
  if (inHint) {
    return true;
  }
  return segmentsInSameEquivalenceGroup(
    hubKey,
    srcKey,
    segmentEquivalences
  );
}

/**
 * LLM often uses attach_under [hub, src] for parallel top roots that M2 marked
 * as synonyms — promote to merge_synonym (topBranch hints or segmentEquivalences).
 */
export function normalizeSynonymAttachSteps(
  steps: ReattachStep[],
  topBranchSynonymHints: TopBranchSynonymHint[],
  segmentEquivalences: SegmentEquivalence[],
  topChainFromKeys: string[]
): ReattachStep[] {
  if (!steps.length) {
    return steps;
  }

  const topKeys = new Set(topChainFromKeys.map((f) => segmentKeyForMerge(f)));
  const promoted: Array<{ from: string; to: string; reason: string }> = [];
  const normalized = steps.map((step) => {
    if (step.kind !== "attach_under" || step.targetPath.length !== 2) {
      return step;
    }
    const hubKey = segmentKeyForMerge(step.targetPath[0] ?? "");
    const srcKey = segmentKeyForMerge(step.sourceFrom);
    const lastKey = segmentKeyForMerge(step.targetPath[1] ?? "");
    if (!hubKey || !srcKey || lastKey !== srcKey) {
      return step;
    }

    if (
      !shouldPromoteParallelTopSynonym(
        hubKey,
        srcKey,
        topKeys,
        topBranchSynonymHints,
        segmentEquivalences
      )
    ) {
      return step;
    }

    promoted.push({
      from: step.sourceFrom,
      to: step.targetPath[0]!,
      reason: topBranchSynonymHints.length
        ? "topBranchSynonymHint"
        : "segmentEquivalences",
    });
    return {
      ...step,
      kind: "merge_synonym" as const,
      targetPath: [step.targetPath[0]!],
      evidence: [
        ...(step.evidence ?? []),
        "normalized: parallel top synonym attach_under → merge_synonym",
      ],
    };
  });

  return sortReattachStepsForApply(normalized);
}

/** Apply each LLM step in order (tree updates after every step). */
export function applyReattachStepsToRecords(
  records: SessionRecord[],
  steps: ReattachStep[] | undefined,
  chains?: ReparentChain[],
  minConfidence = 0.55
): SessionRecord[] {
  if (!steps?.length) {
    return records;
  }

  const sorted = sortReattachStepsForApply(steps);
  let result = records;

  for (const step of sorted) {
    const move = normalizeHubAttachMoves(
      [reattachStepToMove(step)],
      chains
    )[0];
    if (!move) {
      continue;
    }
    result = applyReattachMovesToRecords(result, [move], minConfidence);
  }

  return result;
}

/** Fallback when only moves[] cached: one move per iteration, synonym-length first. */
export function applyReattachMovesSequentially(
  records: SessionRecord[],
  moves: ReattachMove[] | undefined,
  chains?: ReparentChain[],
  minConfidence = 0.55
): SessionRecord[] {
  if (!moves?.length) {
    return records;
  }

  const sorted = [...moves].sort((a, b) => {
    const al = a.toPath.map((s) => s.trim()).filter(Boolean).length;
    const bl = b.toPath.map((s) => s.trim()).filter(Boolean).length;
    return al - bl || (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  let result = records;
  for (const move of sorted) {
    const batch = normalizeHubAttachMoves([move], chains);
    result = applyReattachMovesToRecords(result, batch, minConfidence);
  }
  return result;
}
