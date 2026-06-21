import { describe, expect, it } from "vitest";
import { computeStaleness } from "../shared/src/staleness";
import { __testing as extractTesting } from "../extension/src/llm/extractCodeReferences";

const { buildMarkCode } = extractTesting;

describe("buildMarkCode", () => {
  it("returns empty array for undefined/empty input", () => {
    expect(buildMarkCode(undefined)).toEqual([]);
    expect(buildMarkCode("")).toEqual([]);
    expect(buildMarkCode("   \n  \n  ")).toEqual([]);
  });

  it("splits on newlines, trims, and keeps effective lines", () => {
    const raw = [
      "function foo() {",
      "  const x = 1;",
      "}", // length 1 — discarded (< 3)
      "",
      "  // comment  ",
    ].join("\n");
    expect(buildMarkCode(raw)).toEqual(["function foo() {", "const x = 1;", "// comment"]);
  });

  it("discards lines shorter than 3 chars", () => {
    const raw = "ab\ncd\nef\nfunction foo() {}";
    const result = buildMarkCode(raw);
    expect(result).toEqual(["function foo() {}"]);
  });

  it("discards lines with no Unicode letter or digit", () => {
    const raw = "{{{}}}\n;;;\n---\nfunction foo() {}";
    const result = buildMarkCode(raw);
    expect(result).toEqual(["function foo() {}"]);
  });

  it("keeps lines with Unicode letters (CJK)", () => {
    const raw = "你好世界\nfunction foo() {}";
    expect(buildMarkCode(raw)).toEqual(["你好世界", "function foo() {}"]);
  });

  it("caps at 2000 chars on a complete-line boundary (trim back to previous newline)", () => {
    const longLine = "x".repeat(1500);
    const nextLine = "y".repeat(800);
    const raw = `${longLine}\n${nextLine}\nfinal line`;
    const result = buildMarkCode(raw);
    // The 2000-char cut falls inside `nextLine`, so trim back to the previous
    // newline — only `longLine` survives (nextLine is incomplete and discarded).
    expect(result).toEqual([longLine]);
  });

  it("extends to end of line when first line exceeds 2000 chars", () => {
    const longLine = "a".repeat(2500);
    const raw = `${longLine}\nsecond line`;
    const result = buildMarkCode(raw);
    // The first line itself exceeds 2000 — extend to its end (all 2500 chars).
    expect(result).toEqual([longLine]);
  });

  it("captures markCode from a realistic Write snippet", () => {
    const raw = [
      "import { useState } from 'react';",
      "",
      "export function Counter() {",
      "  const [count, setCount] = useState(0);",
      "  return <button onClick={() => setCount(count + 1)}>+</button>;",
      "}", // length 1 — discarded
    ].join("\n");
    const result = buildMarkCode(raw);
    expect(result).toHaveLength(4);
    expect(result[0]).toBe("import { useState } from 'react';");
    expect(result[2]).toBe("const [count, setCount] = useState(0);");
  });
});

describe("computeStaleness", () => {
  it("returns unknown when markCode is empty or missing", () => {
    expect(computeStaleness(undefined, "some content")).toBe("unknown");
    expect(computeStaleness([], "some content")).toBe("unknown");
  });

  it("returns stale when file content is undefined (file missing)", () => {
    expect(computeStaleness(["foo"], undefined)).toBe("stale");
  });

  it("returns fresh when every markCode line is a substring of file content", () => {
    const markCode = ["function foo() {", "  return 42;"];
    const file = [
      "import { bar } from './bar';",
      "",
      "function foo() {",
      "  return 42;",
      "}",
      "",
      "export default foo;",
    ].join("\n");
    expect(computeStaleness(markCode, file)).toBe("fresh");
  });

  it("returns stale when any markCode line is NOT a substring", () => {
    const markCode = ["function foo() {", "  return 99;"];
    const file = [
      "function foo() {",
      "  return 42;", // different return value
      "}",
    ].join("\n");
    expect(computeStaleness(markCode, file)).toBe("stale");
  });

  it("tolerates indentation differences (trimmed line is substring of indented file line)", () => {
    const markCode = ["const x = 1;"];
    const file = "    const x = 1;  // indented";
    expect(computeStaleness(markCode, file)).toBe("fresh");
  });

  it("tolerates CRLF in file content (markCode lines carry no newlines)", () => {
    const markCode = ["line one", "line two"];
    const file = "line one\r\nline two\r\n";
    expect(computeStaleness(markCode, file)).toBe("fresh");
  });

  it("returns fresh when markCode has a single effective line present in file", () => {
    expect(computeStaleness(["export default foo;"], "export default foo;\n")).toBe("fresh");
  });

  it("returns stale when file exists but is empty and markCode is non-empty", () => {
    expect(computeStaleness(["some line"], "")).toBe("stale");
  });
});
