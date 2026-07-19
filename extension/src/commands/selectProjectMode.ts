/**
 * `agent-mindmap.selectProjectMode` - QuickPick-based project mode switcher.
 *
 * Top-level shortcut for `agentMindmap.project.mode` so users don't have to
 * hunt for the config key in Settings. Switching to repo mode runs the
 * prerequisite gate (git repo + origin + cwd is repo root) up front; the
 * existing config-change listener then runs the one-way re-key migration.
 */
import * as vscode from "vscode";
import { checkRepoPrerequisites } from "@agent-mindmap/core";
import { getProjectMode, type ProjectMode } from "../host/slugDerivation";
import { isStoreRekeyedToRepo } from "../store/rekeyMigration";
import { notifyInfo, notifyWarning, notifyError } from "../notify";
import { t } from "../l10n/uiTranslate";

type ModePickItem = vscode.QuickPickItem & { mode: ProjectMode };

const MODE_ITEMS: ModePickItem[] = [
  {
    label: "Workspace",
    description: "$(folder) Slug from workspace folder path (default)",
    mode: "workspace",
  },
  {
    label: "Repo",
    description: "$(git_branch) Slug from git origin URI (same repo aggregates across clones)",
    mode: "repo",
  },
];

export async function commandSelectProjectMode(): Promise<void> {
  const currentMode = getProjectMode();
  const items = MODE_ITEMS.map((item) => ({
    ...item,
    picked: item.mode === currentMode,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t(
      "ui.selectProjectMode.placeholder",
      "Select project mode (current: {0})",
      currentMode
    ),
    title: t("ui.selectProjectMode.title", "Agent Mind Map: Select Project Mode"),
  });

  if (!picked || picked.mode === currentMode) {
    return;
  }

  if (picked.mode === "repo") {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      notifyWarning(
        t(
          "ui.warning.selectProjectMode.noFolder",
          "Agent Mind Map: open a workspace folder before switching to repo mode."
        )
      );
      return;
    }

    const failures: { folder: string; reason: string }[] = [];
    for (const folder of folders) {
      const res = await checkRepoPrerequisites(folder.uri.fsPath);
      if (!res.ok) {
        failures.push({ folder: folder.uri.fsPath, reason: res.reason });
      }
    }
    if (failures.length > 0) {
      const lines = failures.map((f) => `• ${f.folder} - ${f.reason}`).join("\n");
      notifyError(
        t(
          "ui.warning.selectProjectMode.prereqFailed",
          "Agent Mind Map: repo mode requires every workspace folder to be a git repo with origin at the repo root. Fix or stay in workspace mode.\n{0}",
          lines
        )
      );
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      t(
        "ui.warning.selectProjectMode.rekeyConfirm",
        "Switching to repo mode re-keys existing sessions to git origin slugs. This is one-way - you cannot revert to workspace mode for this store. Continue?"
      ),
      { modal: true },
      t("ui.selectProjectMode.confirm", "Switch to repo mode")
    );
    if (confirm !== t("ui.selectProjectMode.confirm", "Switch to repo mode")) {
      return;
    }
  } else {
    // workspace: refuse on a re-keyed store (one-way, rule 5).
    if (await isStoreRekeyedToRepo()) {
      notifyWarning(
        t(
          "ui.warning.storeAlreadyRekeyed",
          "Agent Mind Map: this store has already been migrated to repo mode and cannot revert to workspace mode."
        )
      );
      return;
    }
  }

  await vscode.workspace
    .getConfiguration("agentMindmap")
    .update("project.mode", picked.mode, vscode.ConfigurationTarget.Workspace);

  // The config-change listener handles re-key migration + paths-map refresh.
  notifyInfo(
    t("ui.info.selectProjectMode.applied", "Agent Mind Map: project mode set to {0}.", picked.mode)
  );
}
