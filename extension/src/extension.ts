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
import { getStoreDir } from "./paths";
import { logLlmDumpLocationsOnce } from "./llm/llmIoDump";
import { agentDebugLog } from "./debugLog";
import { LlmProviderError } from "./llm/types";
import { ensureStore, listRecords } from "./store/sessionStore";
import { resolveLlmProviderId } from "./llmOptions";
import { setActiveSession } from "./commands/openLatest";
import { commandOpenLatest } from "./commands/openLatest";
import { commandPickSession } from "./commands/pickSession";
import { commandDownloadPackage } from "./commands/downloadPackage";
import { commandSelectHost } from "./commands/selectHost";
import { commandSelectModel } from "./commands/selectModel";
import { commandAnalyzeAndMergeCurrentProject } from "./commands/analyzeProject";
import { applyPendingMergeToPanel } from "./batch/batchStatus";
import { wrapCommand } from "./commands/commandWrapper";
import { markModelSelected } from "./llmOptions";

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  initLog(context);
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
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      resetHostCache();
    })
  );

  // ── Claude Code empty transcript warning ───────────────────────────────

  void maybeWarnEmptyClaudeTranscripts(context);

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
          const storeDir = getStoreDir();
          await ensureStore(storeDir);
          return listRecords(storeDir);
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
    applyPendingMergeToPanel(panel);
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
