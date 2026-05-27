import type { MindMapUiDirectionName, MindMapUiPreset } from "./mindMapUiTypes";

export type UiSettingKey = "preset" | "direction";

const PRESETS: readonly MindMapUiPreset[] = ["auto", "dark", "light"];
const DIRECTIONS: readonly MindMapUiDirectionName[] = [
  "side",
  "left",
  "right",
];

export type ParsedUiSettingUpdate = {
  configKey: "ui.preset" | "ui.direction";
  value: string;
};

export function parseUiSettingUpdate(
  key: string,
  value: string
): ParsedUiSettingUpdate | undefined {
  if (key === "preset") {
    if (!PRESETS.includes(value as MindMapUiPreset)) {
      return undefined;
    }
    return { configKey: "ui.preset", value };
  }
  if (key === "direction") {
    if (!DIRECTIONS.includes(value as MindMapUiDirectionName)) {
      return undefined;
    }
    return { configKey: "ui.direction", value };
  }
  return undefined;
}

export type ApplyUiSettingResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "no_workspace" };
