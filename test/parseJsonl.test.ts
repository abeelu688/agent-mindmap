import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractUserQuery, parseJsonl } from "../extension/src/transcript/parseJsonl";

describe("extractUserQuery", () => {
  it("parses user_query tags", () => {
    expect(
      extractUserQuery("<user_query>\nHello world\n</user_query>")
    ).toBe("Hello world");
  });
});

describe("parseJsonl", () => {
  it("parses fixture into events", () => {
    const content = readFileSync(
      join(__dirname, "fixtures/sample.jsonl"),
      "utf8"
    );
    const events = parseJsonl(content);
    expect(events.some((e) => e.kind === "user_query")).toBe(true);
    expect(events.some((e) => e.kind === "tool")).toBe(true);
    expect(events.some((e) => e.kind === "assistant_summary")).toBe(true);
  });

  it("extracts tool label with path basename", () => {
    const content = readFileSync(
      join(__dirname, "fixtures/sample.jsonl"),
      "utf8"
    );
    const events = parseJsonl(content);
    const tool = events.find((e) => e.kind === "tool");
    expect(tool && tool.kind === "tool" && tool.label).toContain("binder.c");
  });
});
