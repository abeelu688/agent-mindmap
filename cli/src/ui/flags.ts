/**
 * Resolve global CLI flags from the Commander program.
 */
import type { Command } from "commander";
import type { GlobalFlags } from "./logger";

export function resolveGlobalFlags(program: Command): GlobalFlags {
  const opts = program.opts();
  return {
    quiet: opts.quiet === true,
    noProgress: opts.progress === false,
    noColor: opts.color === false,
    verbose: opts.verbose === true,
    json: opts.json === true,
  };
}
