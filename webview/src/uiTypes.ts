export type MindMapUiPreset = "auto" | "dark" | "light";

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
