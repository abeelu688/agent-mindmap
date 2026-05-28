import type { NodeObj } from "mind-elixir";

/**
 * mind-elixir SIDE layout assigns the first unmarked child to the left (o <= s).
 * Pre-assign root-level children so the first branch goes right, then alternates.
 */
export function assignSideDirectionsPreferRight(root: NodeObj): void {
  const children = root.children;
  if (!children?.length) {
    return;
  }
  let leftCount = 0;
  let rightCount = 0;
  for (const child of children) {
    if (child.direction === 0) {
      leftCount += 1;
      continue;
    }
    if (child.direction === 1) {
      rightCount += 1;
      continue;
    }
    if (rightCount <= leftCount) {
      child.direction = 1;
      rightCount += 1;
    } else {
      child.direction = 0;
      leftCount += 1;
    }
  }
}

/**
 * SIDE layout with the first unmarked root child on the left, then alternates.
 */
export function assignSideDirectionsPreferLeft(root: NodeObj): void {
  const children = root.children;
  if (!children?.length) {
    return;
  }
  let leftCount = 0;
  let rightCount = 0;
  for (const child of children) {
    if (child.direction === 0) {
      leftCount += 1;
      continue;
    }
    if (child.direction === 1) {
      rightCount += 1;
      continue;
    }
    if (leftCount <= rightCount) {
      child.direction = 0;
      leftCount += 1;
    } else {
      child.direction = 1;
      rightCount += 1;
    }
  }
}
