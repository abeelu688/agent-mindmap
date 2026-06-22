/**
 * Core prompter — abstracts user interaction (quick picks, input boxes, messages).
 *
 * The extension wraps `vscode.window.showQuickPick` etc.; the CLI wraps
 * `@inquirer/prompts`; tests use a stub or `noopPrompter`.
 */

/** Generic quick-pick item — surface layer adds its own fields. */
export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  /** Pre-selected state (for canPickMany mode). */
  picked?: boolean;
}

export interface Prompter {
  /**
   * Show a quick-pick selector. Returns `undefined` when cancelled.
   * When `canPickMany` is true, returns an array; otherwise a single item.
   */
  showQuickPick<T extends QuickPickItem>(
    items: T[],
    options?: { placeHolder?: string; canPickMany?: boolean; title?: string }
  ): Promise<T[] | T | undefined>;

  /** Show an input box. Returns `undefined` when cancelled. */
  showInputBox(options: {
    prompt?: string;
    value?: string;
    password?: boolean;
  }): Promise<string | undefined>;

  /** Show a warning message with optional action buttons. */
  showWarningMessage(message: string, ...actions: string[]): Promise<string | undefined>;

  /** Show an informational message with optional action buttons. */
  showInformationMessage(message: string, ...actions: string[]): Promise<string | undefined>;
}

/** No-op prompter that always returns undefined (cancelled). */
export const noopPrompter: Prompter = {
  showQuickPick: async () => undefined,
  showInputBox: async () => undefined,
  showWarningMessage: async () => undefined,
  showInformationMessage: async () => undefined,
};
