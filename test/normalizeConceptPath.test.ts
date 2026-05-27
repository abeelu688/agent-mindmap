import { describe, expect, it } from "vitest";
import { normalizeConceptPath } from "../extension/src/llm/normalizeConceptPath";

describe("normalizeConceptPath", () => {
  it("folds android → runtime → art to android → art", () => {
    expect(
      normalizeConceptPath(["android", "runtime", "art", "jit"])
    ).toEqual(["android", "art", "jit"]);
  });

  it("leaves android → art paths unchanged", () => {
    expect(
      normalizeConceptPath([
        "android",
        "art",
        "instrumentation",
        "method entry hook",
      ])
    ).toEqual(["android", "art", "instrumentation", "method entry hook"]);
  });

  it("drops consecutive duplicate segments", () => {
    expect(normalizeConceptPath(["android", "art", "art", "jit"])).toEqual([
      "android",
      "art",
      "jit",
    ]);
  });

  it("caps length at six segments", () => {
    const long = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(normalizeConceptPath(long).length).toBe(6);
  });
});
