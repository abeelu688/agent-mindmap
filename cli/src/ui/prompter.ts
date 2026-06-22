/**
 * CLI Prompter — implements the core Prompter port using @inquirer/prompts.
 */
import { select, input, confirm } from "@inquirer/prompts";
import type { Prompter, QuickPickItem } from "@agent-mindmap/core";

export function buildCliPrompter(): Prompter {
  return {
    async showQuickPick<T extends QuickPickItem>(
      items: T[],
      options?: { placeHolder?: string; canPickMany?: boolean; title?: string }
    ): Promise<T | T[] | undefined> {
      const message = options?.title ?? options?.placeHolder ?? "Select an option";

      if (options?.canPickMany) {
        // @inquirer/prompts select doesn't natively support multi-select
        // Fall back to sequential single-select for now
        const selected: T[] = [];
        for (const item of items) {
          const answer = await confirm({
            message: `${item.label}${item.description ? ` — ${item.description}` : ""}?`,
            default: item.picked ?? false,
          });
          if (answer) {
            selected.push(item);
          }
        }
        return selected.length > 0 ? selected : undefined;
      }

      const choices = items.map((item) => ({
        name: item.label + (item.description ? ` — ${item.description}` : ""),
        value: item,
      }));

      try {
        const answer = await select({
          message,
          choices,
        });
        return answer as T;
      } catch {
        return undefined;
      }
    },

    async showInputBox(opts: {
      prompt?: string;
      value?: string;
      password?: boolean;
    }): Promise<string | undefined> {
      try {
        return await input({
          message: opts.prompt ?? "Enter value",
          default: opts.value,
        });
      } catch {
        return undefined;
      }
    },

    async showWarningMessage(message: string, ...actions: string[]): Promise<string | undefined> {
      if (actions.length === 0) {
        process.stderr.write(`⚠ ${message}\n`);
        return undefined;
      }
      try {
        return await select({
          message: `⚠ ${message}`,
          choices: actions.map((a) => ({ name: a, value: a })),
        });
      } catch {
        return undefined;
      }
    },

    async showInformationMessage(
      message: string,
      ...actions: string[]
    ): Promise<string | undefined> {
      if (actions.length === 0) {
        process.stdout.write(`ℹ ${message}\n`);
        return undefined;
      }
      try {
        return await select({
          message: `ℹ ${message}`,
          choices: actions.map((a) => ({ name: a, value: a })),
        });
      } catch {
        return undefined;
      }
    },
  };
}
