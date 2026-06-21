import * as vscode from "vscode";
import {
  drainPendingJump,
  handleNodeClicked,
  consumeTranscriptDocUriIfAutoReveal,
} from "./jumpToOrigin";
import { loadGlassResumableIds, clearComposerTitleCache } from "./transcript/composerTitles";
import { closeStateDb } from "./transcript/cursorStateDb";
import { mindMapLog } from "./webview/MindMapLog";
import { initLog } from "./log";
import { MindMapPanel } from "./webview/MindMapPanel";
import { MindMapHost } from "./webview/MindMapHost";
import { getActiveHost, getWorkspaceSlug, resetHostCache, resolveHostId } from "./host";
import { checkRepoModeGate, getProjectMode, type RepoGateFailure } from "./host/slugDerivation";
import { t } from "./l10n/uiTranslate";
import { logLlmDumpLocationsOnce } from "./llm/llmIoDump";
import { agentDebugLog } from "./debugLog";
import { LlmProviderError } from "./llm/types";
import { getStore } from "./store/storeClient";
import { resolveLlmProviderId } from "./llmOptions";
import { setActiveSession } from "./commands/openLatest";
import { commandOpenLatest } from "./commands/openLatest";
import { commandPickSession } from "./commands/pickSession";
import { commandDownloadPackage } from "./commands/downloadPackage";
import { commandSelectHost } from "./commands/selectHost";
import { commandSelectModel } from "./commands/selectModel";
import { commandConfigureTeamService } from "./commands/configureTeamService";
import { commandAnalyzeAndMergeCurrentProject } from "./commands/analyzeProject";
import { refreshStaleMcpInstall } from "./mcp/mcpConfig";
import { applyPendingUpdatesToPanel } from "./batch/applyPendingUpdates";
import { wrapCommand } from "./commands/commandWrapper";
import { markModelSelected } from "./llmOptions";
import { affectsMcpLocale, syncMcpLocaleFile } from "./mcpLocaleSync";
import { affectsPathsMap, writePathsMaps } from "./store/pathsMap";
import { isStoreRekeyedToRepo, runRekeyMigration } from "./store/rekeyMigration";
import { setExtensionContext } from "./store/storeClient";

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  initLog(context);
  setExtensionContext(context);
  agentDebugLog(
    "extension.ts:activate",
    "extension activated",
    {
      extensionPath: context.extensionPath,
      workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
      dumpFolder: "agent-mindmap-llm-dumps",
    },
    "E"
  );
  logLlmDumpLocationsOnce();

  // ── Configuration change listeners ─────────────────────────────────────

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (
        e.affectsConfiguration("agentMindmap.host") ||
        e.affectsConfiguration("agentMindmap.projectsDir") ||
        e.affectsConfiguration("agentMindmap.claudeProjectsDir")
      ) {
        resetHostCache();
      }
      if (
        e.affectsConfiguration("agentMindmap.llm.provider") ||
        e.affectsConfiguration("agentMindmap.host")
      ) {
        const host = await getActiveHost(context);
        const config = vscode.workspace.getConfiguration("agentMindmap");
        const providerSetting = config.get<string>("llm.provider", "auto");
        const providerId = resolveLlmProviderId(providerSetting, host.defaultLlmProvider);
        MindMapHost.setProviderId(providerId);
      }
      if (e.affectsConfiguration("agentMindmap.project.mode")) {
        const newMode = getProjectMode();
        if (newMode === "repo") {
          // workspace → repo: run the one-way re-key migration (idempotent —
          // an already-re-keyed store no-ops; a store with no sessions under
          // workspace slugs no-ops per folder). Surfaces progress + result.
          void runRekeyMigrationWithProgress();
        } else {
          // repo → workspace: refuse on a re-keyed store (one-way, rule 5).
          void enforceOneWayRekeyGuard();
        }
        resetHostCache();
        void runRepoModeGate();
      }
      if (affectsPathsMap(e)) {
        void writePathsMaps();
      }
      if (affectsMcpLocale(e)) {
        void syncMcpLocaleFile();
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      resetHostCache();
      void runRepoModeGate();
      void writePathsMaps();
    })
  );

  // ── Claude Code empty transcript warning ───────────────────────────────

  void maybeWarnEmptyClaudeTranscripts(context);

  // ── Refresh stale MCP install path after extension upgrade ─────────────

  const upgradeWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (upgradeWorkspace) {
    void refreshStaleMcpInstall(context.extensionPath, upgradeWorkspace).catch(() => {
      // Silent: this is best-effort.
    });
  }

  // ── Sync MCP locale file so stdio server can localize tool examples ────

  void syncMcpLocaleFile();

  // ── Bootstrap the store (opens / migrates store.db) at activation so the
  //    first command invocation doesn't pay the open + migration cost. Fire
  //    and forget: the first real `getStore()` call awaits the same promise.

  void getStore().then(
    () => mindMapLog("[activate] store bootstrap complete"),
    (err) =>
      mindMapLog(
        `[activate] store bootstrap failed: ${err instanceof Error ? err.message : String(err)}`
      )
  );

  // ── Repo-mode prerequisite gate ─────────────────────────────────────────
  //  In repo mode every workspace folder must be a git repo with `origin` and
  //  be the repo root. On any failure, surface an error notification naming
  //  the failing folders; `getWorkspaceSlug` then returns `undefined` for
  //  those folders and analysis bails. Best-effort: never blocks activation.

  void runRepoModeGate();

  // ── Paths map files (workspace-paths.json / repo-paths.json / mcp-mode.json)
  //  Written at activation + on workspace-folder / mode change so the MCP
  //  server can resolve CodeReference.path against the local clone. Mirrors
  //  the Q2 locale-file pattern. Best-effort.

  void writePathsMaps();

  // ── Document close listener (auto-reveal mind map) ────────────────────

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (!consumeTranscriptDocUriIfAutoReveal(doc)) {
        return;
      }
      MindMapPanel.getCurrent()?.reveal();
    })
  );

  // ── WebView event handlers ─────────────────────────────────────────────

  MindMapPanel.onNodeClicked(
    (payload) =>
      void handleNodeClicked(payload, {
        context,
        listSessionRecords: async () => {
          return (await getStore()).listAllRecords();
        },
      })
  );

  MindMapPanel.onDownloadRequested(() => {
    void commandDownloadPackage(context.extensionUri);
  });

  MindMapPanel.onApplyPendingUpdateRequested(() => {
    const panel = MindMapPanel.getCurrent();
    if (!panel) {
      return;
    }
    void applyPendingUpdatesToPanel(panel);
  });

  MindMapPanel.onSelectModelRequested(() => {
    void vscode.commands.executeCommand("agent-mindmap.selectModel");
  });

  MindMapPanel.onModelUpdated(() => {
    void markModelSelected(context);
  });

  // ── Initial provider resolution ────────────────────────────────────────

  void resolveHostId(context).then(async () => {
    const host = await getActiveHost(context);
    const config = vscode.workspace.getConfiguration("agentMindmap");
    const providerSetting = config.get<string>("llm.provider", "auto");
    const providerId = resolveLlmProviderId(providerSetting, host.defaultLlmProvider);
    MindMapHost.setProviderId(providerId);
  });

  // ── Register commands ──────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "agent-mindmap.openLatest",
      wrapCommand(() => commandOpenLatest(context))
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.pickSession",
      wrapCommand(() => commandPickSession(context))
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.analyzeAndMergeCurrentProject",
      wrapCommand(() => commandAnalyzeAndMergeCurrentProject(context))
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.selectHost",
      wrapCommand(() => commandSelectHost(context))
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.selectModel",
      wrapCommand(() => commandSelectModel(context))
    ),
    vscode.commands.registerCommand("agent-mindmap.refreshRepoPaths", async () => {
      await writePathsMaps();
      void vscode.window.showInformationMessage(
        t("ui.info.repoPathsRefreshed", "Agent Mind Map: Refreshed repo/workspace paths map.")
      );
    }),
    vscode.commands.registerCommand(
      "agent-mindmap.configureTeamService",
      wrapCommand(() => commandConfigureTeamService(context))
    )
  );

  // ── Post-activation setup ──────────────────────────────────────────────

  void LlmProviderError;

  // Drain any cross-window "pending jump" the previous window persisted
  // when the user picked "open in new/current window". Runs once per
  // activation; ignores expired or wrong-workspace records.
  void drainPendingJump({ context });

  void resolveHostId(context).then((hostId) => {
    if (hostId !== "cursor") {
      return;
    }
    void loadGlassResumableIds().then(
      (ids) => mindMapLog(`[activate] pre-warmed glass registry: ${ids.size} resumable ids`),
      (err) => mindMapLog(`[activate] glass registry preload failed: ${err}`)
    );
  });
}

export function deactivate(): void {
  setActiveSession(undefined);
  closeStateDb();
  clearComposerTitleCache();
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Run the repo-mode gate; in workspace mode it's a no-op. Surfaces a localized error notification on failure. */
async function runRepoModeGate(): Promise<void> {
  if (getProjectMode() !== "repo") {
    return;
  }
  try {
    const result = await checkRepoModeGate();
    if (result.broken) {
      void vscode.window.showErrorMessage(formatRepoGateError(result.failures));
    }
  } catch (err) {
    mindMapLog(
      `[activate] repo mode gate failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function formatRepoGateError(failures: RepoGateFailure[]): string {
  const lines = failures.map((f) => `• ${f.folder} — ${f.reason}`);
  return t(
    "ui.warning.repoModeGateBroken",
    "Agent Mind Map: repo mode requires every workspace folder to be a git repo with origin at the repo root. Fix or switch to workspace mode.",
    lines.join("\n")
  );
}

/**
 * Run the re-key migration inside a VS Code progress notification. Surfaces
 * a summary (folders re-keyed / no-op / aborted) on completion. Best-effort:
 * a thrown error becomes a warning notification, never blocks activation.
 */
async function runRekeyMigrationWithProgress(): Promise<void> {
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t("ui.progress.rekey.title", "Agent Mind Map: Re-keying sessions to repo mode…"),
        cancellable: false,
      },
      () => runRekeyMigration()
    );
    if (result.kind === "ok") {
      void vscode.window.showInformationMessage(
        t(
          "ui.info.rekeyDone",
          "Agent Mind Map: Re-keyed {0} workspace folder(s) to repo slugs. Reload the window to refresh the mind map.",
          String(result.foldersRekeyed)
        )
      );
    } else if (result.kind === "noop") {
      void vscode.window.showInformationMessage(
        t("ui.info.rekeyNoop", "Agent Mind Map: no sessions needed re-keying.")
      );
    } else {
      void vscode.window.showWarningMessage(
        t("ui.info.rekeyAborted", "Agent Mind Map: {0}", result.reason)
      );
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    void vscode.window.showWarningMessage(t("ui.info.rekeyAborted", "Agent Mind Map: {0}", detail));
  }
}

/**
 * One-way enforcement (rule 5): when the user switches `project.mode` back to
 * `workspace` on a store already re-keyed to repo, revert the setting and
 * surface a warning. No-op when the store was never re-keyed.
 */
async function enforceOneWayRekeyGuard(): Promise<void> {
  try {
    if (!(await isStoreRekeyedToRepo())) {
      return;
    }
    await vscode.workspace
      .getConfiguration("agentMindmap")
      .update("project.mode", "repo", vscode.ConfigurationTarget.Global);
    void vscode.window.showWarningMessage(
      t(
        "ui.warning.storeAlreadyRekeyed",
        "Agent Mind Map: this store has already been migrated to repo mode and cannot revert to workspace mode."
      )
    );
  } catch (err) {
    mindMapLog(
      `[activate] one-way rekey guard failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function maybeWarnEmptyClaudeTranscripts(context: vscode.ExtensionContext): Promise<void> {
  const host = await getActiveHost(context);
  if (host.id !== "claude-code") {
    return;
  }
  const key = "agentMindmap.claudeEmptyWarned";
  if (context.globalState.get<boolean>(key)) {
    return;
  }
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) {
    return;
  }
  const scanDir = host.getSessionsScanDir(workspacePath);
  if (!scanDir) {
    return;
  }
  const slug = getWorkspaceSlug(host);
  const sessions = await host.listSessions(scanDir, {
    projectSlug: slug,
    projectPath: workspacePath,
  });
  if (sessions.length) {
    return;
  }
  await context.globalState.update(key, true);
  vscode.window.showInformationMessage(
    "Agent Mind Map: No Claude Code transcripts on disk for this workspace. " +
      "The VS Code extension may not persist main chats — CLI sessions are more reliable."
  );
}
