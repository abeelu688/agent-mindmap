/**
 * Minimal reattach-step conversion helpers — no deps on store, mindmap, or
 * pipeline. The full reattachSteps.ts remains in extension (it imports
 * store/webview modules).
 */

import type { ReattachMove, ReattachStep, ReattachStepKind } from "./types";

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