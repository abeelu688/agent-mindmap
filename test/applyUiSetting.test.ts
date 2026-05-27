import { describe, expect, it } from "vitest";
import { parseUiSettingUpdate } from "../extension/src/ui/applyUiSetting";
import {
  directionFromSetting,
  presetFromSetting,
} from "../extension/src/ui/mindMapUiTypes";

describe("parseUiSettingUpdate", () => {
  it("accepts valid preset values", () => {
    expect(parseUiSettingUpdate("preset", "auto")).toEqual({
      configKey: "ui.preset",
      value: "auto",
    });
    expect(parseUiSettingUpdate("preset", "dark")).toEqual({
      configKey: "ui.preset",
      value: "dark",
    });
    expect(parseUiSettingUpdate("preset", "light")).toEqual({
      configKey: "ui.preset",
      value: "light",
    });
  });

  it("accepts valid direction values", () => {
    expect(parseUiSettingUpdate("direction", "right")).toEqual({
      configKey: "ui.direction",
      value: "right",
    });
    expect(parseUiSettingUpdate("direction", "left")).toEqual({
      configKey: "ui.direction",
      value: "left",
    });
    expect(parseUiSettingUpdate("direction", "side")).toEqual({
      configKey: "ui.direction",
      value: "side",
    });
  });

  it("rejects unknown key or value", () => {
    expect(parseUiSettingUpdate("themeFile", "x.json")).toBeUndefined();
    expect(parseUiSettingUpdate("preset", "neon")).toBeUndefined();
    expect(parseUiSettingUpdate("direction", "up")).toBeUndefined();
  });

  it("parsed values round-trip through setting parsers", () => {
    const preset = parseUiSettingUpdate("preset", "light");
    expect(preset).toBeDefined();
    expect(presetFromSetting(preset!.value)).toBe("light");

    const dir = parseUiSettingUpdate("direction", "left");
    expect(dir).toBeDefined();
    expect(directionFromSetting(dir!.value)).toBe(0);
  });
});
