import type { MindMapThemeOverrides } from "./mindMapUiTypes";

export type ThemeFileJson = {
  name?: string;
  cssVar?: Record<string, unknown>;
  palette?: unknown;
};

export function parseThemeFileJson(raw: string): MindMapThemeOverrides | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as ThemeFileJson;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const obj = parsed as ThemeFileJson;
  const overrides: MindMapThemeOverrides = {};

  if (obj.cssVar !== undefined) {
    if (!obj.cssVar || typeof obj.cssVar !== "object" || Array.isArray(obj.cssVar)) {
      return undefined;
    }
    const cssVar: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj.cssVar)) {
      if (typeof value !== "string") {
        return undefined;
      }
      cssVar[key] = value;
    }
    if (Object.keys(cssVar).length > 0) {
      overrides.cssVar = cssVar;
    }
  }

  if (obj.palette !== undefined) {
    if (!Array.isArray(obj.palette)) {
      return undefined;
    }
    const palette: string[] = [];
    for (const color of obj.palette) {
      if (typeof color !== "string" || !color.trim()) {
        return undefined;
      }
      palette.push(color.trim());
    }
    if (palette.length > 0) {
      overrides.palette = palette;
    }
  }

  if (!overrides.cssVar && !overrides.palette) {
    return undefined;
  }
  return overrides;
}
