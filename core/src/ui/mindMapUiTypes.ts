export type MindMapUiPreset = "auto" | "dark" | "light";

export type MindMapUiDirectionName = "side" | "side-lr" | "left" | "right";

export type SideBranchOrder = "right-first" | "left-first";

/** mind-elixir direction: LEFT=0, RIGHT=1, SIDE=2 */
export type MindMapDirection = 0 | 1 | 2;

export type MindMapThemeOverrides = {
  cssVar?: Record<string, string>;
  palette?: string[];
};

export type MindMapUiOptions = {
  preset: MindMapUiPreset;
  direction: MindMapDirection;
  sideBranchOrder?: SideBranchOrder;
  themeOverrides?: MindMapThemeOverrides;
};

export function presetFromSetting(value: string | undefined): MindMapUiPreset {
  if (value === "dark" || value === "light") {
    return value;
  }
  return "auto";
}

export function directionFromSetting(
  value: string | undefined
): MindMapDirection {
  const name = (value ?? "side") as MindMapUiDirectionName;
  switch (name) {
    case "left":
      return 0;
    case "right":
      return 1;
    case "side":
    case "side-lr":
    default:
      return 2;
  }
}

export function sideBranchOrderFromSetting(
  value: string | undefined
): SideBranchOrder {
  return value === "side-lr" ? "left-first" : "right-first";
}
