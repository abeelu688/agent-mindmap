import * as fs from "fs";
import * as vscode from "vscode";
import { mindMapLog } from "../webview/MindMapLog";
import type { MindMapUiOptions } from "./mindMapUiTypes";
import {
  directionFromSetting,
  presetFromSetting,
} from "./mindMapUiTypes";
import { parseThemeFileJson } from "./themeMerge";
import { resolveThemeFilePath } from "./themePath";

export type { MindMapUiOptions } from "./mindMapUiTypes";
export { resolveThemeFilePath } from "./themePath";

export function readThemeFileOverrides(
  themeFileSetting: string,
  workspaceRoot?: string
): MindMapUiOptions["themeOverrides"] {
  const resolved = resolveThemeFilePath(themeFileSetting, workspaceRoot);
  if (!resolved) {
    return undefined;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf8");
  } catch (err) {
    mindMapLog(
      `ui.themeFile: could not read ${resolved}: ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
  const overrides = parseThemeFileJson(raw);
  if (!overrides) {
    mindMapLog(`ui.themeFile: invalid theme JSON at ${resolved}`);
    return undefined;
  }
  return overrides;
}

export function readMindMapUiConfig(): MindMapUiOptions {
  const config = vscode.workspace.getConfiguration("agentMindmap");
  const preset = presetFromSetting(config.get<string>("ui.preset"));
  const direction = directionFromSetting(config.get<string>("ui.direction"));
  const themeFile = config.get<string>("ui.themeFile", "");
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const themeOverrides = themeFile.trim()
    ? readThemeFileOverrides(themeFile, workspaceRoot)
    : undefined;
  return { preset, direction, themeOverrides };
}
