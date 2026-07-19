/**
 * `agent-mindmap config` — manage CLI configuration.
 */
import { Command } from "commander";
import { CliConfigStore } from "../config/configStore";
import { log, logSuccess, isJsonMode, printJson } from "../ui/logger";
import { syncMcpConfigFiles } from "../adapters/mcpConfigSync";

// Config keys that affect MCP server resolution / localization. When these
// change, the MCP paths map + locale file must be rewritten so the stdio MCP
// server picks up the new value on its next request.
const MCP_RELEVANT_KEYS = new Set([
  "project.mode",
  "host",
  "ui.locale",
  "projectsDir",
  "claudeProjectsDir",
]);

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

        // If the key affects MCP server resolution / localization, rewrite
        // the MCP config files so the next MCP request uses the new value.
        if (MCP_RELEVANT_KEYS.has(key)) {
          await syncMcpConfigFiles(opts.cwd as string, config);
        }
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
