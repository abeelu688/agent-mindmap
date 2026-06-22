/**
 * `agent-mindmap model` — manage model selection.
 */
import { Command } from "commander";
import { selectModel } from "@agent-mindmap/core";
import { CliConfigStore } from "../config/configStore";
import { log, isJsonMode, printJson, buildCliLogger } from "../ui/logger";
import { buildCliPrompter } from "../ui/prompter";

export const modelCommand = new Command("model")
  .description("Manage model selection")
  .addCommand(
    new Command("list").description("List available models").action(async () => {
      const models = [
        { id: "auto", description: "Use the host's default model" },
        { id: "claude-sonnet-4-6", description: "Claude Sonnet 4.6 (via Claude Code CLI)" },
        { id: "claude-opus-4-8", description: "Claude Opus 4.8 (via Claude Code CLI)" },
      ];

      if (isJsonMode()) {
        printJson(models);
      } else {
        for (const m of models) {
          log(`  ${m.id} — ${m.description}`);
        }
      }
    })
  )
  .addCommand(
    new Command("select").description("Interactively select the model").action(async () => {
      const opts = modelCommand.optsWithGlobals();
      const cwd = (opts.cwd as string) ?? process.cwd();
      const config = new CliConfigStore({ cwd, storeDir: opts.storeDir as string | undefined });
      await config.load();

      const result = await selectModel({
        prompter: buildCliPrompter(),
        configStore: config,
        logger: buildCliLogger(),
      });

      if (result) {
        log(`Model set to: ${result.model || "auto"}`);
      } else {
        log("Cancelled");
      }
    })
  );
