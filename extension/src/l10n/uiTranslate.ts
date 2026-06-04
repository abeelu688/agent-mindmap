import * as vscode from "vscode";
import zhL10n from "../../l10n/bundle.l10n.zh-cn.json";

export type UiLocaleSetting = "auto" | "en" | "zh-cn";

export function format(
  message: string,
  args: Array<string | number | boolean>
): string {
  return message.replace(/\{(\d+)\}/g, (_m, rawIdx) => {
    const idx = Number(rawIdx);
    const v = args[idx];
    return v === undefined ? "" : String(v);
  });
}

/**
 * Translate a message using VS Code's l10n API, falling back to format().
 * This is the shared t() function — use it instead of duplicating the
 * l10n lookup logic in every file.
 */
export function t(
  key: string,
  message: string,
  ...args: Array<string | number | boolean>
): string {
  const l10n = (vscode as unknown as { l10n?: { t?: Function } }).l10n;
  const fn = l10n?.t as
    | undefined
    | ((opts: { key: string; message: string; args?: unknown[] }) => string);
  if (fn) {
    return fn({ key, message, args });
  }
  return format(message, args);
}

export function readUiLocaleSetting(): UiLocaleSetting {
  const raw = vscode.workspace
    .getConfiguration("agentMindmap")
    .get<string>("ui.locale", "auto");
  if (raw === "en" || raw === "zh-cn") {
    return raw;
  }
  return "auto";
}

/** True when notification strings should use Chinese. */
export function isChineseUiLanguage(): boolean {
  const setting = readUiLocaleSetting();
  if (setting === "zh-cn") {
    return true;
  }
  if (setting === "en") {
    return false;
  }
  const lang = (vscode.env.language ?? "").toLowerCase();
  return lang.startsWith("zh");
}

/**
 * UI strings for extension notifications.
 * - ui.locale=zh-cn → Chinese
 * - ui.locale=en → English
 * - ui.locale=auto (default) → follow Configure Display Language (zh-* → Chinese, else English)
 */
export function uiTranslate(
  key: string,
  enMessage: string,
  ...args: Array<string | number | boolean>
): string {
  if (isChineseUiLanguage()) {
    const zh = (zhL10n as Record<string, string>)[key];
    if (typeof zh === "string") {
      return format(zh, args);
    }
  }
  const l10n = (vscode as unknown as { l10n?: { t?: Function } }).l10n;
  const fn = l10n?.t as
    | undefined
    | ((opts: { key: string; message: string; args?: unknown[] }) => string);
  if (fn) {
    return fn({ key, message: enMessage, args });
  }
  return format(enMessage, args);
}
