import { DARK_THEME, THEME, type Theme } from "mind-elixir";
import type { MindMapUiOptions } from "./uiTypes";

function readVsCodeVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  const trimmed = value.trim();
  return trimmed || fallback;
}

type ThemeWithCssVar = Theme & { cssVar: NonNullable<Theme["cssVar"]> };

function cloneTheme(base: Theme): ThemeWithCssVar {
  return {
    ...base,
    palette: [...base.palette],
    cssVar: { ...base.cssVar },
  };
}

function mergeThemeOverrides(theme: Theme, overrides: MindMapUiOptions["themeOverrides"]): Theme {
  if (!overrides) {
    return theme;
  }
  if (overrides.palette?.length) {
    theme.palette = [...overrides.palette];
  }
  if (overrides.cssVar) {
    theme.cssVar = { ...theme.cssVar, ...overrides.cssVar };
  }
  return theme;
}

export function buildAutoTheme(): Theme {
  const theme = cloneTheme(DARK_THEME);
  const bg = readVsCodeVar("--vscode-editor-background", "#1e1e1e");
  const fg = readVsCodeVar("--vscode-editor-foreground", "#cccccc");
  const accent = readVsCodeVar("--vscode-focusBorder", "#007fd4");
  const buttonBg = readVsCodeVar("--vscode-button-background", accent);
  const panelBg = readVsCodeVar(
    "--vscode-sideBar-background",
    readVsCodeVar("--vscode-panel-background", bg)
  );
  const panelFg = readVsCodeVar("--vscode-sideBar-foreground", fg);
  const border = readVsCodeVar("--vscode-panel-border", "#696969");

  theme.cssVar["--bgcolor"] = bg;
  theme.cssVar["--color"] = fg;
  theme.cssVar["--selected"] = accent;
  theme.cssVar["--accent-color"] = buttonBg;
  theme.cssVar["--root-color"] = fg;
  theme.cssVar["--root-bgcolor"] = panelBg;
  theme.cssVar["--root-border-color"] = border;
  theme.cssVar["--main-color"] = fg;
  theme.cssVar["--main-bgcolor"] = panelBg;
  theme.cssVar["--main-bgcolor-transparent"] = panelBg;
  theme.cssVar["--panel-color"] = panelFg;
  theme.cssVar["--panel-bgcolor"] = panelBg;
  theme.cssVar["--panel-border-color"] = border;
  return theme;
}

export function resolveTheme(ui: MindMapUiOptions): Theme {
  let base: Theme;
  switch (ui.preset) {
    case "light":
      base = cloneTheme(THEME);
      break;
    case "dark":
      base = cloneTheme(DARK_THEME);
      break;
    case "auto":
    default:
      base = buildAutoTheme();
      break;
  }
  return mergeThemeOverrides(base, ui.themeOverrides);
}

export function directionFromUi(ui: MindMapUiOptions): 0 | 1 | 2 {
  return ui.direction;
}
