export type MindMapUiPreset = "auto" | "dark" | "light";

/** mind-elixir direction: LEFT=0, RIGHT=1, SIDE=2 */
export type MindMapDirection = 0 | 1 | 2;

export type MindMapThemeOverrides = {
  cssVar?: Record<string, string>;
  palette?: string[];
};

export type MindMapUiOptions = {
  preset: MindMapUiPreset;
  direction: MindMapDirection;
  themeOverrides?: MindMapThemeOverrides;
};
