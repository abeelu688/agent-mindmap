import { describe, expect, it } from "vitest";
import { normalizeConceptPath } from "../extension/src/llm/normalizeConceptPath";

describe("normalizeConceptPath", () => {
  it("drops consecutive duplicate segments (case-insensitive via merge key)", () => {
    expect(normalizeConceptPath(["Alpha", "alpha", "beta"])).toEqual([
      "Alpha",
      "beta",
    ]);
    expect(normalizeConceptPath(["foo-bar", "foo_bar", "baz"])).toEqual([
      "foo-bar",
      "baz",
    ]);
  });

  it("caps length at six segments", () => {
    const long = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(normalizeConceptPath(long).length).toBe(6);
  });

  it("trims whitespace and skips empty segments", () => {
    expect(normalizeConceptPath(["  alpha  ", "", "  beta"])).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("does not rewrite domain-specific segment order", () => {
    expect(
      normalizeConceptPath(["domain-a", "alias-b", "domain-a", "leaf"])
    ).toEqual(["domain-a", "alias-b", "domain-a", "leaf"]);
  });
});
