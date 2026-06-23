/**
 * `agent-mindmap host` — manage host detection and selection.
 */
import * as os from "os";
import * as path from "path";
import { Command } from "commander";
import {
  selectHost,
  createCursorHost,
  createClaudeHost,
  type AgentHostId,
} from "@agent-mindmap/core";
import { CliConfigStore } from "../config/configStore";
import { log, isJsonMode, printJson } from "../ui/logger";
import { buildCliPrompter } from "../ui/prompter";

function getCursorProjectsRoot(): string {
  return path.join(os.homedir(), ".cursor");
}

function getClaudeProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

export const hostCommand = new Command("host")
  .description("Manage host detection and selection")
  .addCommand(
    new Command("list")
      .description("List available hosts and their scan directories")
      .action(async () => {
        const opts = hostCommand.optsWithGlobals();
        const cwd = (opts.cwd as string) ?? process.cwd();
        const cursorHost = createCursorHost(
          getCursorProjectsRoot,
          () => "Install Cursor CLI from cursor.sh"
        );
        const claudeHost = createClaudeHost(
          getClaudeProjectsRoot,
          () => "Install Claude CLI from claude.ai"
        );

        const hosts = [
          {
            id: "cursor" as AgentHostId,
            displayName: cursorHost.displayName,
            scanDir: cursorHost.getSessionsScanDir(cwd) ?? null,
          },
          {
            id: "claude-code" as AgentHostId,
            displayName: claudeHost.displayName,
            scanDir: claudeHost.getSessionsScanDir(cwd) ?? null,
          },
        ];

        if (isJsonMode()) {
          printJson(hosts);
        } else {
          for (const h of hosts) {
            log(`  ${h.id} (${h.displayName})`);
            log(`    Scan dir: ${h.scanDir ?? "(none)"}`);
          }
        }
      })
  )
  .addCommand(
    new Command("detect")
      .description("Detect the active host for the current workspace")
      .action(async () => {
        const opts = hostCommand.optsWithGlobals();
        const cwd = (opts.cwd as string) ?? process.cwd();
        const config = new CliConfigStore({ cwd, storeDir: opts.storeDir as string | undefined });
        await config.load();

        const hostSetting = config.get<string>("host") ?? "auto";
        log(`Host setting: ${hostSetting}`);

        if (hostSetting !== "auto") {
          log(`Resolved: ${hostSetting}`);
          if (isJsonMode()) {
            printJson({ hostId: hostSetting });
          }
          return;
        }

        // Auto-detect
        const cursorHost = createCursorHost(getCursorProjectsRoot, () => "");
        const claudeHost = createClaudeHost(getClaudeProjectsRoot, () => "");
        const cursorDir = cursorHost.getSessionsScanDir(cwd);
        const claudeDir = claudeHost.getSessionsScanDir(cwd);

        const detected: AgentHostId[] = [];
        if (cursorDir) {
          try {
            const { access } = await import("fs/promises");
            await access(cursorDir);
            detected.push("cursor");
          } catch {
            // Not found
          }
        }
        if (claudeDir) {
          try {
            const { access } = await import("fs/promises");
            await access(claudeDir);
            detected.push("claude-code");
          } catch {
            // Not found
          }
        }

        if (detected.length === 0) {
          log("No hosts detected");
        } else {
          log(`Detected: ${detected.join(", ")}`);
        }

        if (isJsonMode()) {
          printJson({ hostIds: detected });
        }
      })
  )
  .addCommand(
    new Command("select").description("Interactively select the active host").action(async () => {
      const opts = hostCommand.optsWithGlobals();
      const cwd = (opts.cwd as string) ?? process.cwd();
      const config = new CliConfigStore({ cwd, storeDir: opts.storeDir as string | undefined });
      await config.load();

      const hostId = await selectHost({
        prompter: buildCliPrompter(),
        configStore: config,
      });

      if (hostId) {
        log(`Host set to: ${hostId}`);
      } else {
        log("Cancelled");
      }
    })
  );
