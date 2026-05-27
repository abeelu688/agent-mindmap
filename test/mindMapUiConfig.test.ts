import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  directionFromSetting,
  presetFromSetting,
} from "../extension/src/ui/mindMapUiTypes";
import { parseThemeFileJson } from "../extension/src/ui/themeMerge";
import { resolveThemeFilePath } from "../extension/src/ui/themePath";

describe("parseThemeFileJson", () => {
  it("parses cssVar and palette", () => {
    const result = parseThemeFileJson(
      JSON.stringify({
        cssVar: { "--main-gap-x": "28px" },
        palette: ["#112233", "#445566"],
      })
    );
    expect(result?.cssVar?.["--main-gap-x"]).toBe("28px");
    expect(result?.palette).toEqual(["#112233", "#445566"]);
  });

  it("rejects invalid json", () => {
    expect(parseThemeFileJson("{")).toBeUndefined();
    expect(parseThemeFileJson("[]")).toBeUndefined();
  });

  it("rejects non-string cssVar values", () => {
    expect(
      parseThemeFileJson(JSON.stringify({ cssVar: { "--x": 1 } }))
    ).toBeUndefined();
  });

  it("rejects invalid palette entries", () => {
    expect(
      parseThemeFileJson(JSON.stringify({ palette: ["#abc", 2] }))
    ).toBeUndefined();
  });
});

describe("presetFromSetting", () => {
  it("defaults to auto", () => {
    expect(presetFromSetting(undefined)).toBe("auto");
    expect(presetFromSetting("nope")).toBe("auto");
  });

  it("accepts dark and light", () => {
    expect(presetFromSetting("dark")).toBe("dark");
    expect(presetFromSetting("light")).toBe("light");
  });
});

describe("directionFromSetting", () => {
  it("maps layout names to mind-elixir direction", () => {
    expect(directionFromSetting("left")).toBe(0);
    expect(directionFromSetting("right")).toBe(1);
    expect(directionFromSetting("side")).toBe(2);
    expect(directionFromSetting(undefined)).toBe(2);
  });
});

describe("resolveThemeFilePath", () => {
  it("expands home paths", () => {
    const resolved = resolveThemeFilePath("~/.agent-mindmap/theme.json");
    expect(resolved).toContain(".agent-mindmap/theme.json");
    expect(resolved?.startsWith("~")).toBe(false);
  });

  it("resolves absolute paths unchanged", () => {
    const abs = join(tmpdir(), "theme.json");
    expect(resolveThemeFilePath(abs)).toBe(abs);
  });

  it("reads theme file from disk via parseThemeFileJson", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-mindmap-theme-"));
    try {
      const file = join(dir, "theme.json");
      writeFileSync(
        file,
        JSON.stringify({ palette: ["#aabbcc"] }),
        "utf8"
      );
      const raw = readFileSync(file, "utf8");
      const overrides = parseThemeFileJson(raw);
      expect(overrides?.palette).toEqual(["#aabbcc"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
