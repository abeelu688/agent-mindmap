/**
 * Localized string resolver — decouples core from `vscode.l10n.t()` / `uiTranslate.t()`.
 *
 * The extension provides a VS Code-backed implementation; the CLI provides a
 * JSON-bundle implementation; core defaults to the English passthrough.
 */
export interface LocalizedStringResolver {
  /**
   * Resolve a localized string. If no resolver is set, the fallback (English)
   * is returned as-is.
   */
  t(key: string, fallback: string, ...args: unknown[]): string;
}

/** Passthrough English resolver — used when no locale is configured. */
export const passthroughLocaleResolver: LocalizedStringResolver = {
  t(_key: string, fallback: string, ...args: unknown[]): string {
    if (args.length === 0) return fallback;
    // Simple positional {0}, {1}, … substitution
    return fallback.replace(/\{(\d+)\}/g, (match, idx: string) => {
      const i = parseInt(idx, 10);
      return i < args.length ? String(args[i]) : match;
    });
  },
};

/**
 * Set the global locale resolver. Call once at startup from the surface layer.
 * Not set = passthrough English.
 */
let _resolver: LocalizedStringResolver | undefined;

export function setCoreLocaleResolver(resolver: LocalizedStringResolver): void {
  _resolver = resolver;
}

export function getCoreLocaleResolver(): LocalizedStringResolver {
  return _resolver ?? passthroughLocaleResolver;
}
