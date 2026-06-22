/**
 * `agent-mindmap config` — manage CLI configuration.
 */
import { Command } from "commander";
import { CliConfigStore } from "../config/configStore";
import { log, logSuccess, isJsonMode, printJson } from "../ui/logger";

export const configCommand = new Command("config")
  .description("Manage CLI configuration")
  .addCommand(
    new Command("get")
      .description("Get a config value")
      .argument("<key>", "Config key (e.g. llm.provider)")
      .action(async (key: string) => {
        const opts = configCommand.optsWithGlobals();
        const config = new CliConfigStore({ cwd: opts.cwd, storeDir: opts.storeDir });
        await config.load();
        const value = config.get(key);
        if (isJsonMode()) {
          printJson({ key, value });
        } else {
          log(value !== undefined ? String(value) : "(not set)");
        }
      })
  )
  .addCommand(
    new Command("set")
      .description("Set a config value")
      .argument("<key>", "Config key")
      .argument("<value>", "Config value (JSON strings are parsed)")
      .action(async (key: string, rawValue: string) => {
        const opts = configCommand.optsWithGlobals();
        const config = new CliConfigStore({ cwd: opts.cwd, storeDir: opts.storeDir });
        await config.load();
        // Try to parse as JSON, fall back to string
        let value: unknown;
        try {
          value = JSON.parse(rawValue);
        } catch {
          value = rawValue;
        }
        await config.set(key, value);
        logSuccess(`Set ${key} = ${JSON.stringify(value)}`);
      })
  )
  .addCommand(
    new Command("list").description("List all config values").action(async () => {
      const opts = configCommand.optsWithGlobals();
      const config = new CliConfigStore({ cwd: opts.cwd, storeDir: opts.storeDir });
      await config.load();
      const all = config.list();
      if (isJsonMode()) {
        printJson(all);
      } else {
        const entries = Object.entries(all);
        if (entries.length === 0) {
          log("(no config set)");
        } else {
          for (const [k, v] of entries) {
            log(`  ${k} = ${JSON.stringify(v)}`);
          }
        }
      }
    })
  )
  .addCommand(
    new Command("path").description("Print the config file path").action(async () => {
      const opts = configCommand.optsWithGlobals();
      const config = new CliConfigStore({ cwd: opts.cwd, storeDir: opts.storeDir });
      log(config.userConfigFilePath);
    })
  );
