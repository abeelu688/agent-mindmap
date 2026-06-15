import * as vscode from "vscode";
import deL10n from "../../l10n/bundle.l10n.de.json";
import esL10n from "../../l10n/bundle.l10n.es.json";
import frL10n from "../../l10n/bundle.l10n.fr.json";
import hiL10n from "../../l10n/bundle.l10n.hi.json";
import idL10n from "../../l10n/bundle.l10n.id.json";
import jaL10n from "../../l10n/bundle.l10n.ja.json";
import koL10n from "../../l10n/bundle.l10n.ko.json";
import ptBrL10n from "../../l10n/bundle.l10n.pt-br.json";
import zhL10n from "../../l10n/bundle.l10n.zh-cn.json";

/** Supported UI locales. To add a new one: see CONTRIBUTING.md → "Adding a new language". */
export type UiLocale = "en" | "zh-cn" | "ja" | "ko" | "pt-br" | "es" | "de" | "fr" | "hi" | "id";

export type UiLocaleSetting = "auto" | UiLocale;

/**
 * Bundle map. Each non-English entry must mirror every key in
 * `bundle.l10n.json`. Translations land here when contributors add
 * `bundle.l10n.<locale>.json`. Empty bundle means "fall back to English".
 */
const BUNDLES: Partial<Record<UiLocale, Record<string, string>>> = {
  de: deL10n as Record<string, string>,
  es: esL10n as Record<string, string>,
  fr: frL10n as Record<string, string>,
  hi: hiL10n as Record<string, string>,
  id: idL10n as Record<string, string>,
  ja: jaL10n as Record<string, string>,
  ko: koL10n as Record<string, string>,
  "pt-br": ptBrL10n as Record<string, string>,
  "zh-cn": zhL10n as Record<string, string>,
};

const UI_LOCALES = new Set<UiLocale>([
  "en",
  "zh-cn",
  "ja",
  "ko",
  "pt-br",
  "es",
  "de",
  "fr",
  "hi",
  "id",
]);

export function format(message: string, args: Array<string | number | boolean>): string {
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
export function t(key: string, message: string, ...args: Array<string | number | boolean>): string {
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
  const raw = vscode.workspace.getConfiguration("agentMindmap").get<string>("ui.locale", "auto");
  if (UI_LOCALES.has(raw as UiLocale)) {
    return raw as UiLocale;
  }
  return "auto";
}

/**
 * Resolve the active UI locale.
 *
 * 1. If `ui.locale` is set to a specific locale, honor it.
 * 2. If `auto`, fall back to VS Code's display language (`vscode.env.language`).
 * 3. If the resolved locale has no bundle, return `"en"`.
 */
export function resolveUiLocale(): UiLocale {
  const setting = readUiLocaleSetting();
  if (setting !== "auto") {
    return setting;
  }
  const lang = (vscode.env.language ?? "").toLowerCase();
  if (lang.startsWith("zh")) return "zh-cn";
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("ko")) return "ko";
  if (lang.startsWith("pt")) return "pt-br";
  if (lang.startsWith("es")) return "es";
  if (lang.startsWith("de")) return "de";
  if (lang.startsWith("fr")) return "fr";
  if (lang.startsWith("hi")) return "hi";
  if (lang.startsWith("id")) return "id";
  return "en";
}

/**
 * @deprecated — use {@link resolveUiLocale} instead. Kept for tests and
 * legacy call sites that only need a "is the user reading Chinese?" check.
 */
export function isChineseUiLanguage(): boolean {
  return resolveUiLocale() === "zh-cn";
}

/**
 * UI strings for extension notifications.
 *
 * Resolution order:
 * 1. Active locale from {@link resolveUiLocale} → look up in `BUNDLES`.
 * 2. VS Code's `l10n.t()` (which honors `agentMindmap.ui.locale` via
 *    `bundle.l10n.<locale>.json` files in the extension manifest).
 * 3. The English `enMessage` argument.
 */
export function uiTranslate(
  key: string,
  enMessage: string,
  ...args: Array<string | number | boolean>
): string {
  const locale = resolveUiLocale();
  if (locale !== "en") {
    const bundle = BUNDLES[locale];
    const localized = bundle?.[key];
    if (typeof localized === "string") {
      return format(localized, args);
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
