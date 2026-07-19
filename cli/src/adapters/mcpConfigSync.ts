/**
 * CLI helper - sync MCP config files (`mcp-mode.json`, `workspace-paths.json`,
 * `repo-paths.json`, `mcp-locale.json`) to the store dir so the stdio MCP
 * server can resolve slugs and localize tool examples.
 *
 * Equivalent to the extension's `writePathsMaps()` + `syncMcpLocaleFile()`.
 * The extension calls these on activate / config change / analyze; the CLI
 * calls them on `config set`, `project analyze`, `context sync`, and
 * `mcp refresh-paths`.
 */
import { writeMcpConfigFiles, writeMcpLocaleFile, type ProjectMode } from "@agent-mindmap/core";
import { logWarn } from "../ui/logger";
import { buildCliHost } from "./cliHostAccess";
import type { CliConfigStore } from "../config/configStore";

export async function syncMcpConfigFiles(cwd: string, config: CliConfigStore): Promise<void> {
  const mode: ProjectMode = config.get<string>("project.mode") === "repo" ? "repo" : "workspace";
  const hostId = config.get<string>("host") ?? "auto";
  // For slug encoding we need a concrete host. Auto-detection here would
  // duplicate detectHost's fs.access logic; use cursor as the encoding
  // fallback since workspace slugs are host-derived but both hosts produce
  // the same path-based slug for the same cwd (the slug is path-only).
  const host = buildCliHost(cwd, hostId === "claude-code" ? "claude-code" : "cursor");

  await writeMcpConfigFiles({
    storeDir: config.storeDir,
    mode,
    folderPaths: [cwd],
    encodeWorkspacePath: (fsPath) => host.encodeWorkspacePath(fsPath),
    onError: (err) => {
      logWarn(`Failed to sync MCP paths map: ${err.message}`);
    },
  });

  const locale = config.get<string>("ui.locale");
  if (locale && locale !== "auto") {
    await writeMcpLocaleFile({
      storeDir: config.storeDir,
      locale,
      onError: (err) => {
        logWarn(`Failed to sync MCP locale file: ${err.message}`);
      },
    });
  }
}
