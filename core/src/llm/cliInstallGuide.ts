import type { AgentHostId } from "@agent-mindmap/shared";

export const CLI_SETTINGS_KEY = "agentMindmap.llm.cliPath";

export const CURSOR_CLI_DOCS_URL = "https://cursor.com/docs/cli/overview";
export const CLAUDE_CLI_DOCS_URL = "https://code.claude.com/docs/en/headless";

export const CURSOR_INSTALL_UNIX = "curl https://cursor.com/install -fsS | bash";
export const CURSOR_INSTALL_WIN32 = "irm 'https://cursor.com/install?win32=true' | iex";

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

export function buildCliInstallGuide(
  hostId: AgentHostId,
  platform: NodeJS.Platform,
  t: TranslateFn
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
      t("ui.cliInstall.step.verify", "2. Verify in a terminal: {0}", verifyCommand),
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
    ? t("ui.cliInstall.cursor.installWin", "   In PowerShell: {0}", installCommand)
    : t("ui.cliInstall.cursor.installUnix", "   In a terminal: {0}", installCommand);
  const detail = [
    t("ui.cliInstall.step.install", "1. Install the Cursor CLI (agent)"),
    installStep,
    t("ui.cliInstall.step.verify", "2. Verify in a terminal: {0}", verifyCommand),
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
  platform: NodeJS.Platform = process.platform,
  t?: TranslateFn
): string {
  if (t) {
    return buildCliInstallGuide(hostId, platform, t).summary;
  }
  // Fallback: plain English when no translate function is available.
  if (hostId === "claude-code") {
    return "Agent Mind Map: Claude Code CLI not found — sessions cannot be saved to the library.";
  }
  return "Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library.";
}
