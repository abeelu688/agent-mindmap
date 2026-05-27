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

  it("folds aosp domain into android and drops redundant aosp segment", () => {
    expect(normalizeConceptPath(["aosp", "art", "jit"])).toEqual([
      "android",
      "art",
      "jit",
    ]);
    expect(normalizeConceptPath(["android", "aosp", "zygote"])).toEqual([
      "android",
      "zygote",
    ]);
  });

  it("inserts art before jni when jni is directly under android", () => {
    expect(normalizeConceptPath(["android", "jni", "startvm"])).toEqual([
      "android",
      "art",
      "jni",
      "startvm",
    ]);
    expect(
      normalizeConceptPath(["aosp", "jni", "libnativehelper"])
    ).toEqual(["android", "art", "jni", "libnativehelper"]);
  });
});
