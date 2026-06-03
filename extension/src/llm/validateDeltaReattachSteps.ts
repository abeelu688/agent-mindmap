import type { ReattachStep } from "./types";
import type { TrieReparentInput } from "./trieReparentInput";
import { segmentKeyForMerge } from "./topicGraphValidate";

export class DeltaReattachValidationError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "DeltaReattachValidationError";
    this.issues = issues;
  }
}

function frozenTopSegmentKeys(input: TrieReparentInput): Set<string> {
  const keys = new Set<string>();
  for (const i of input.frozenChainIndices ?? []) {
    const chain = input.chains[i];
    if (!chain) {
      continue;
    }
    const k = segmentKeyForMerge(chain.from);
    if (k) {
      keys.add(k);
    }
  }
  return keys;
}

function editableTopSegmentKeys(input: TrieReparentInput): Set<string> {
  const frozen = new Set(input.frozenChainIndices ?? []);
  const keys = new Set<string>();
  for (let i = 0; i < input.chains.length; i++) {
    if (frozen.has(i)) {
      continue;
    }
    const k = segmentKeyForMerge(input.chains[i]!.from);
    if (k) {
      keys.add(k);
    }
  }
  return keys;
}

/** Detect steps whose targets were merged away by earlier merge_synonym steps. */
export function countReattachStepConflicts(steps: ReattachStep[] | undefined): number {
  if (!steps?.length) {
    return 0;
  }
  const mergedAway = new Set<string>();
  let conflicts = 0;
  for (const step of steps) {
    const src = segmentKeyForMerge(step.sourceFrom);
    const tgt = segmentKeyForMerge(step.targetPath?.[0] ?? "");
    if (step.kind === "merge_synonym" && tgt && mergedAway.has(tgt)) {
      conflicts += 1;
    }
    if (step.kind === "attach_under" && tgt && mergedAway.has(tgt)) {
      conflicts += 1;
    }
    if (src && mergedAway.has(src)) {
      conflicts += 1;
    }
    if (step.kind === "merge_synonym" && src) {
      mergedAway.add(src);
    }
  }
  return conflicts;
}

/**
 * Delta M-merge: reject changes that invent parallel hubs or move frozen tops.
 * Validates segment keys (changes[] format); node ids optional.
 */
export function validateDeltaReattachSteps(
  input: TrieReparentInput,
  steps: ReattachStep[]
): void {
  if (input.mergeMode !== "delta" || !input.frozenChainIndices?.length) {
    return;
  }

  const issues: string[] = [];
  const frozenSegs = frozenTopSegmentKeys(input);
  const editableSegs = editableTopSegmentKeys(input);

  for (const step of steps) {
    const srcSeg = segmentKeyForMerge(step.sourceFrom);
    if (srcSeg && frozenSegs.has(srcSeg)) {
      issues.push(
        `step ${step.step}: cannot move frozen snapshot top "${step.sourceFrom}" in delta`
      );
    }

    if (step.kind === "attach_under") {
      const hubSeg = segmentKeyForMerge(step.targetPath?.[0] ?? "");
      if (!hubSeg) {
        issues.push(`step ${step.step}: attach missing hub segment`);
        continue;
      }
      if (editableSegs.has(hubSeg)) {
        issues.push(
          `step ${step.step}: attach hub "${step.targetPath[0]}" is a new-batch top — use a frozen snapshot top (parallel hub forbidden)`
        );
      } else if (!frozenSegs.has(hubSeg)) {
        issues.push(
          `step ${step.step}: attach hub "${step.targetPath[0]}" is not a frozen snapshot top`
        );
      }
    }

    if (step.kind === "merge_synonym") {
      const keepSeg = segmentKeyForMerge(step.targetPath?.[0] ?? "");
      const removeSeg = segmentKeyForMerge(step.sourceFrom);
      if (!keepSeg || !removeSeg) {
        issues.push(`step ${step.step}: merge missing keep/remove segment`);
        continue;
      }
      const removeEditable = editableSegs.has(removeSeg);
      const keepEditable = editableSegs.has(keepSeg);
      if (removeEditable && keepEditable) {
        continue;
      }
      if (!frozenSegs.has(keepSeg)) {
        issues.push(
          `step ${step.step}: merge keep "${step.targetPath[0]}" must be a frozen snapshot top when folding into stable map`
        );
      }
    }
  }

  const conflicts = countReattachStepConflicts(steps);
  if (conflicts > 0) {
    issues.push(
      `${conflicts} change ordering conflict(s): later changes reference segments merged away earlier`
    );
  }

  if (issues.length) {
    throw new DeltaReattachValidationError(
      `M-merge delta validation failed: ${issues[0]}`,
      issues
    );
  }
}
