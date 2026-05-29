import * as vscode from "vscode";
import type { AgentHostId } from "../host/types";
import { uiTranslate } from "../l10n/uiTranslate";

export const CLI_SETTINGS_KEY = "agentMindmap.llm.cliPath";

export const CURSOR_CLI_DOCS_URL = "https://cursor.com/docs/cli/overview";
export const CLAUDE_CLI_DOCS_URL = "https://code.claude.com/docs/en/headless";

export const CURSOR_INSTALL_UNIX =
  "curl https://cursor.com/install -fsS | bash";
export const CURSOR_INSTALL_WIN32 =
  "irm 'https://cursor.com/install?win32=true' | iex";

export type CliInstallGuide = {
  summary: string;
  detail: string;
  installCommand?: string;
  verifyCommand: string;
  docsUrl: string;
  settingsKey: string;
};

export type TranslateFn = (
  key: string,
  message: string,
  ...args: Array<string | number | boolean>
) => string;

export function defaultTranslate(
  key: string,
  message: string,
  ...args: Array<string | number | boolean>
): string {
  return uiTranslate(key, message, ...args);
}

export function buildCliInstallGuide(
  hostId: AgentHostId,
  platform: NodeJS.Platform = process.platform,
  t: TranslateFn = uiTranslate
): CliInstallGuide {
  const settingsKey = CLI_SETTINGS_KEY;
  const isWin = platform === "win32";

  if (hostId === "claude-code") {
    const verifyCommand = "claude --version";
    const summary = t(
      "ui.cliInstall.summary.claude",
      "Agent Mind Map: Claude Code CLI not found — sessions cannot be saved to the library."
    );
    const detail = [
      t("ui.cliInstall.step.install", "1. Install the Claude Code CLI"),
      t(
        "ui.cliInstall.claude.installBody",
        "   Follow the official guide: {0}",
        CLAUDE_CLI_DOCS_URL
      ),
      t(
        "ui.cliInstall.step.verify",
        "2. Verify in a terminal: {0}",
        verifyCommand
      ),
      t(
        "ui.cliInstall.step.auth",
        "3. Sign in if prompted (see the install guide for headless / CI auth)."
      ),
      t(
        "ui.cliInstall.step.cliPath",
        "4. If auto-detect still fails, set Settings → {0} to the full path of the claude executable.",
        settingsKey
      ),
      t(
        "ui.cliInstall.step.libraryNote",
        "5. Turn-only (chronological) views are not saved. Re-run batch analyze after the CLI works to build Concept Mind Map."
      ),
    ].join("\n");
    return {
      summary,
      detail,
      verifyCommand,
      docsUrl: CLAUDE_CLI_DOCS_URL,
      settingsKey,
    };
  }

  const installCommand = isWin ? CURSOR_INSTALL_WIN32 : CURSOR_INSTALL_UNIX;
  const verifyCommand = "agent --version";
  const summary = t(
    "ui.cliInstall.summary.cursor",
    "Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library."
  );
  const installStep = isWin
    ? t(
        "ui.cliInstall.cursor.installWin",
        "   In PowerShell: {0}",
        installCommand
      )
    : t(
        "ui.cliInstall.cursor.installUnix",
        "   In a terminal: {0}",
        installCommand
      );
  const detail = [
    t("ui.cliInstall.step.install", "1. Install the Cursor CLI (agent)"),
    installStep,
    t(
      "ui.cliInstall.step.verify",
      "2. Verify in a terminal: {0}",
      verifyCommand
    ),
    t(
      "ui.cliInstall.cursor.auth",
      "3. First run may require sign-in: agent login (or follow the browser link)."
    ),
    t(
      "ui.cliInstall.step.cliPath",
      "4. If auto-detect still fails, set Settings → {0} to the full path of agent or cursor-agent.",
      settingsKey
    ),
    t(
      "ui.cliInstall.step.libraryNote",
      "5. Turn-only (chronological) views are not saved. Re-run batch analyze after the CLI works to build Concept Mind Map."
    ),
  ].join("\n");

  return {
    summary,
    detail,
    installCommand,
    verifyCommand,
    docsUrl: CURSOR_CLI_DOCS_URL,
    settingsKey,
  };
}

export function cliMissingHintSummary(
  hostId: AgentHostId,
  platform: NodeJS.Platform = process.platform
): string {
  return buildCliInstallGuide(hostId, platform, uiTranslate).summary;
}

export async function showCliInstallGuide(
  hostId: AgentHostId,
  options: { modal?: boolean; t?: TranslateFn } = {}
): Promise<void> {
  const t = options.t ?? uiTranslate;
  const guide = buildCliInstallGuide(hostId, process.platform, t);
  const modal = options.modal ?? true;

  const openSettingsLabel = t(
    "ui.cliInstall.action.openSettings",
    "Open CLI settings"
  );
  const copyLabel = t("ui.cliInstall.action.copyCommand", "Copy install command");
  const docsLabel = t("ui.cliInstall.action.openDocs", "Open install docs");

  const actions: string[] = [openSettingsLabel, docsLabel];
  if (guide.installCommand) {
    actions.splice(1, 0, copyLabel);
  }

  const choice = await vscode.window.showWarningMessage(
    guide.summary,
    { modal, detail: guide.detail },
    ...actions
  );

  if (choice === openSettingsLabel) {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      guide.settingsKey
    );
    return;
  }
  if (choice === copyLabel && guide.installCommand) {
    await vscode.env.clipboard.writeText(guide.installCommand);
    void vscode.window.showInformationMessage(
      t(
        "ui.cliInstall.copied",
        "Agent Mind Map: Install command copied to clipboard."
      )
    );
    return;
  }
  if (choice === docsLabel) {
    await vscode.env.openExternal(vscode.Uri.parse(guide.docsUrl));
  }
}
