/**
 * @agent-mindmap/cli — Terminal CLI for Agent Mind Map.
 *
 * Analyze AI agent chat transcripts (Cursor / Claude Code) and dump mind maps
 * from the command line. Reaches feature parity with the VS Code extension
 * on every non-UI capability.
 */
import { Command } from "commander";
import { versionCommand } from "./commands/version";
import { doctorCommand } from "./commands/doctor";
import { configCommand } from "./commands/config";
import { hostCommand } from "./commands/host";
import { modelCommand } from "./commands/model";
import { sessionCommand } from "./commands/session";
import { projectCommand } from "./commands/project";
import { teamCommand } from "./commands/team";
import { mcpCommand } from "./commands/mcp";
import { contextCommand } from "./commands/context";
import { resolveGlobalFlags } from "./ui/flags";
import { applyGlobalFlags, setJsonMode } from "./ui/logger";

const program = new Command();

program
  .name("agent-mindmap")
  .description("Analyze AI agent chat transcripts and dump mind maps")
  .version("0.0.0", "--version") // placeholder — versionCommand overrides
  .option("--quiet", "Suppress all non-essential output")
  .option("--no-progress", "Disable progress spinners")
  .option("--no-color", "Disable colored output")
  .option("--verbose", "Show verbose debug output")
  .option("--cwd <path>", "Working directory (defaults to process.cwd())")
  .option("--host <id>", "Override host detection (cursor|claude-code)")
  .option("--workspace <slug>", "Override workspace slug resolution")
  .option("--locale <lang>", "Override locale detection (e.g. zh, en)")
  .option("--json", "Output structured JSON where applicable")
  .option("--store-dir <path>", "Override store directory path");

// Register commands
program.addCommand(versionCommand);
program.addCommand(doctorCommand);
program.addCommand(configCommand);
program.addCommand(hostCommand);
program.addCommand(modelCommand);
program.addCommand(sessionCommand);
program.addCommand(projectCommand);
program.addCommand(teamCommand);
program.addCommand(mcpCommand);
program.addCommand(contextCommand);

// Global flag handling
program.hook("preAction", () => {
  const flags = resolveGlobalFlags(program);
  applyGlobalFlags(flags);
  setJsonMode(flags.json);
});

program.parse();
