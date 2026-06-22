import * as vscode from "vscode";
import { notifyInfo, notifyWarning } from "../notify";
import { t } from "../l10n/uiTranslate";
import { getTeamServerUrl, setTeamApiKey } from "../store/storeFactory";
import { resetTeamStoreCache } from "../store/storeClient";

/**
 * Command: `agent-mindmap.configureTeamService`.
 *
 * Two-step prompt:
 *   1. Server URL (pre-filled with the current setting; empty disables team mode).
 *   2. API key (stored in SecretStorage; empty when disabling).
 *
 * On success, prompts the user to reload the window — the store is memoized
 * at activation, so a reload is the simplest way to switch stores.
 */
export async function commandConfigureTeamService(context: vscode.ExtensionContext): Promise<void> {
  const currentUrl = getTeamServerUrl();

  const url = await vscode.window.showInputBox({
    title: t("team.config.url.title", "Agent Mind Map: Team Service URL"),
    prompt: t(
      "team.config.url.prompt",
      "Team service URL (e.g. https://team.example.com). Leave empty to disable team mode."
    ),
    value: currentUrl,
    placeHolder: "https://team.example.com",
    ignoreFocusOut: true,
  });
  if (url === undefined) {
    return; // user cancelled
  }
  const trimmedUrl = url.trim();

  // Update the URL setting immediately so the user sees it in settings.json.
  await vscode.workspace
    .getConfiguration("agentMindmap")
    .update("team.serverUrl", trimmedUrl, vscode.ConfigurationTarget.Global);

  if (!trimmedUrl) {
    // Disabling: clear the API key too.
    await setTeamApiKey(context, "");
    resetTeamStoreCache();
    notifyInfo(
      t(
        "team.config.cleared",
        "Agent Mind Map: Team service disabled. Reload the window to switch back to the local store."
      )
    );
    return;
  }

  const key = await vscode.window.showInputBox({
    title: t("team.config.apiKey.title", "Agent Mind Map: Team Service API Key"),
    prompt: t("team.config.apiKey.prompt", "Team service API key (stored in SecretStorage)."),
    password: true,
    placeHolder: "Bearer token",
    ignoreFocusOut: true,
  });
  if (key === undefined) {
    return; // user cancelled — URL is set but key is unset; partially configured.
  }
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    notifyWarning(
      t(
        "team.config.invalid",
        "Agent Mind Map: Invalid team service configuration: {0}",
        "empty-api-key"
      )
    );
    return;
  }
  await setTeamApiKey(context, trimmedKey);
  resetTeamStoreCache();
  notifyInfo(
    t(
      "team.config.applied",
      "Agent Mind Map: Team service configured. Reload the window to switch stores."
    )
  );
}
