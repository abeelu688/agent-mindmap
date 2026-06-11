import { describe, expect, it } from "vitest";
import { buildOutlineFromConceptTrie } from "../extension/src/store/mergeConceptTrie";

describe("buildOutlineFromConceptTrie", () => {
  it("builds outline from domains and nodes", () => {
    const result = buildOutlineFromConceptTrie(
      ["frontend", "backend"],
      [
        { key: "frontend", label: "Frontend", parentKeys: [], evidence: ["UI layer"] },
        { key: "react", label: "React", parentKeys: ["frontend"], evidence: ["React framework"] },
        { key: "hooks", label: "Hooks", parentKeys: ["react"], evidence: ["React hooks"] },
        { key: "backend", label: "Backend", parentKeys: [], evidence: ["Server side"] },
        { key: "api", label: "API", parentKeys: ["backend"], evidence: ["API design"] },
      ]
    );
    expect(result.outline.length).toBe(2);
    expect(result.outline[0]?.title).toBe("Frontend");
    expect(result.outline[0]?.children?.length).toBe(1);
    expect(result.outline[0]?.children?.[0]?.title).toBe("React");
    expect(result.outline[0]?.children?.[0]?.children?.[0]?.title).toBe("Hooks");
    expect(result.outline[1]?.title).toBe("Backend");
  });

  it("handles empty domains and nodes", () => {
    const result = buildOutlineFromConceptTrie([], []);
    expect(result.outline).toEqual([]);
  });

  it("handles root nodes not covered by any domain", () => {
    const result = buildOutlineFromConceptTrie(
      ["frontend"],
      [
        { key: "frontend", label: "Frontend", parentKeys: [], evidence: ["UI"] },
        { key: "devops", label: "DevOps", parentKeys: [], evidence: ["CI/CD"] },
      ]
    );
    expect(result.outline.length).toBe(2);
    expect(result.outline[0]?.title).toBe("Frontend");
    expect(result.outline[1]?.title).toBe("DevOps");
  });

  it("sets conceptPath on leaf nodes", () => {
    const result = buildOutlineFromConceptTrie(
      ["frontend"],
      [
        { key: "frontend", label: "Frontend", parentKeys: [], evidence: ["UI"] },
        { key: "react", label: "React", parentKeys: ["frontend"], evidence: ["React"] },
      ]
    );
    const reactNode = result.outline[0]?.children?.[0];
    expect(reactNode?.conceptPath).toEqual(["frontend", "react"]);
  });
});
