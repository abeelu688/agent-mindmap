import { describe, expect, it } from "vitest";
import {
  decodeClaudeProjectPath,
  encodeClaudeProjectPath,
} from "../extension/src/host/claudePath";

describe("encodeClaudeProjectPath", () => {
  it("encodes unix absolute paths with a leading dash", () => {
    expect(encodeClaudeProjectPath("/home/welde/cursor/airecorder")).toBe(
      "-home-welde-cursor-airecorder"
    );
  });

  it("replaces spaces and underscores", () => {
    expect(encodeClaudeProjectPath("/home/foo/Open Source/my_project")).toBe(
      "-home-foo-Open-Source-my-project"
    );
  });

  it("encodes windows paths with drive letter", () => {
    expect(encodeClaudeProjectPath("C:\\Users\\me\\repo")).toBe(
      "C--Users-me-repo"
    );
  });
});

describe("decodeClaudeProjectPath", () => {
  it("round-trips simple unix paths", () => {
    const enc = encodeClaudeProjectPath("/home/welde/proj");
    expect(decodeClaudeProjectPath(enc)).toBe("/home/welde/proj");
  });
});
