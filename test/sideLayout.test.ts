import type { NodeObj } from "mind-elixir";
import { describe, expect, it } from "vitest";
import {
  assignSideDirectionsPreferLeft,
  assignSideDirectionsPreferRight,
} from "../webview/src/sideLayout";

function rootWithChildCount(n: number): NodeObj {
  const children: NodeObj[] = [];
  for (let i = 0; i < n; i++) {
    children.push({ id: `c${i}`, topic: `topic ${i}` });
  }
  return { id: "root", topic: "root", children };
}

describe("assignSideDirectionsPreferRight", () => {
  it("places first root child on the right, second on the left", () => {
    const root = rootWithChildCount(2);
    assignSideDirectionsPreferRight(root);
    expect(root.children![0].direction).toBe(1);
    expect(root.children![1].direction).toBe(0);
  });

  it("alternates right-left for four children", () => {
    const root = rootWithChildCount(4);
    assignSideDirectionsPreferRight(root);
    expect(root.children!.map((c) => c.direction)).toEqual([1, 0, 1, 0]);
  });

  it("keeps explicit direction on a child", () => {
    const root = rootWithChildCount(2);
    root.children![0].direction = 0;
    assignSideDirectionsPreferRight(root);
    expect(root.children![0].direction).toBe(0);
    expect(root.children![1].direction).toBe(1);
  });
});

describe("assignSideDirectionsPreferLeft", () => {
  it("places first root child on the left, second on the right", () => {
    const root = rootWithChildCount(2);
    assignSideDirectionsPreferLeft(root);
    expect(root.children![0].direction).toBe(0);
    expect(root.children![1].direction).toBe(1);
  });

  it("alternates left-right for four children", () => {
    const root = rootWithChildCount(4);
    assignSideDirectionsPreferLeft(root);
    expect(root.children!.map((c) => c.direction)).toEqual([0, 1, 0, 1]);
  });

  it("keeps explicit direction on a child", () => {
    const root = rootWithChildCount(2);
    root.children![0].direction = 1;
    assignSideDirectionsPreferLeft(root);
    expect(root.children![0].direction).toBe(1);
    expect(root.children![1].direction).toBe(0);
  });
});
