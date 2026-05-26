import * as vscode from "vscode";
import { MindMapPanel } from "./webview/MindMapPanel";
import {
  loadLatestSession,
  loadSession,
  pickSession,
  type LoadedSession,
} from "./sessionLoader";
import {
  getStoreDir,
  getTranscriptsDir,
  getWorkspaceSlug,
  slugToWorkspacePath,
} from "./paths";
import {
  conceptTrieMergePath,
  deterministicMergePath,
  ensureStore,
  listRecords,
  readMergeRecord,
  rebuildIndex,
  writeMergeRecord,
} from "./store/sessionStore";
import { buildDeterministicMergeRecord } from "./store/mergeDeterministic";
import {
  buildConceptMergeRecord,
  buildConceptTrieMindMap,
} from "./store/mergeConceptTrie";
import { mergeWithLlm } from "./store/mergeLlm";
import { buildTopicMindMap } from "./mindmap/buildTopicMindMap";
import { getProvider } from "./llm";
import { LlmProviderError, type LlmProviderOptions } from "./llm/types";
import type { SessionRecord } from "./store/storeTypes";

let activeSession: LoadedSession | undefined;
let extensionContext: vscode.ExtensionContext;

function progressTitle(): string {
  return "Agent Mind Map: 正在分析会话…";
}

async function withCancellableProgress<T>(
  run: (signal: AbortSignal) => Promise<T>,
  title: string = progressTitle()
): Promise<T | undefined> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (_progress, token) => {
      const controller = new AbortController();
      const sub = token.onCancellationRequested(() => controller.abort());
      try {
        return await run(controller.signal);
      } catch (err) {
        if (controller.signal.aborted) {
          return undefined;
        }
        throw err;
      } finally {
        sub.dispose();
      }
    }
  );
}

async function showMindMap(loaded: LoadedSession): Promise<void> {
  activeSession = loaded;

  const panel = MindMapPanel.createOrShow(extensionContext.extensionUri);
  panel.setMindMapData(loaded.mindMap);
  panel.watchTranscript(loaded.session.filePath, async () => {
    if (!activeSession) {
      return;
    }
    const refreshed = await withCancellableProgress((signal) =>
      loadSession(activeSession!.session, {
        context: extensionContext,
        signal,
      })
    );
    if (refreshed) {
      activeSession = refreshed;
      MindMapPanel.getCurrent()?.setMindMapData(refreshed.mindMap);
    }
  });
}

function showMindMapStandalone(
  title: string,
  data: import("./transcript/types").MindMapRoot
): void {
  const panel = MindMapPanel.createOrShow(extensionContext.extensionUri);
  panel.setMindMapData(data);
  panel.setTitle(title);
}

function readLlmOptions(): LlmProviderOptions {
  const config = vscode.workspace.getConfiguration("agentMindmap");
  return {
    provider: "cursor-cli",
    cliPath: config.get<string>("llm.cliPath", "").trim(),
    model: config.get<string>("llm.model", "").trim(),
    timeoutMs: Math.max(
      1000,
      config.get<number>("llm.timeoutMs", 90000) ?? 90000
    ),
    maxAttempts: Math.max(
      1,
      Math.min(10, config.get<number>("llm.maxAttempts", 3) ?? 3)
    ),
    retryBackoffMs: Math.max(
      0,
      Math.min(30000, config.get<number>("llm.retryBackoffMs", 1000) ?? 1000)
    ),
    maxTopics: Math.max(2, config.get<number>("merge.llm.maxTopics", 8) ?? 8),
    maxItemsPerTopic: Math.max(
      1,
      config.get<number>("merge.llm.maxItemsPerTopic", 6) ?? 6
    ),
  };
}

async function loadLibraryRecords(): Promise<SessionRecord[]> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  return listRecords(storeDir);
}

async function ensureDeterministicMerge(
  projectSlug?: string
): Promise<import("./store/storeTypes").MergeRecord> {
  const storeDir = getStoreDir();
  const records = await loadLibraryRecords();
  const merge = buildDeterministicMergeRecord(records, { projectSlug });
  if (!projectSlug) {
    // Persist the canonical "全部" merge for cheap subsequent opens.
    await writeMergeRecord(deterministicMergePath(storeDir), merge);
    await rebuildIndex(storeDir, records);
  }
  return merge;
}

async function commandOpenLatest(): Promise<void> {
  const loaded = await withCancellableProgress((signal) =>
    loadLatestSession({ context: extensionContext, signal })
  );
  if (loaded) {
    await showMindMap(loaded);
  }
}

async function commandPickSession(): Promise<void> {
  const loaded = await withCancellableProgress((signal) =>
    pickSession({ context: extensionContext, signal })
  );
  if (loaded) {
    await showMindMap(loaded);
  }
}

async function commandRefresh(): Promise<void> {
  if (!activeSession) {
    const loaded = await withCancellableProgress((signal) =>
      loadLatestSession({ context: extensionContext, signal })
    );
    if (loaded) {
      await showMindMap(loaded);
    }
    return;
  }
  const refreshed = await withCancellableProgress((signal) =>
    loadSession(
      activeSession!.session,
      { context: extensionContext, signal },
      { forceRefresh: true }
    )
  );
  if (refreshed) {
    activeSession = refreshed;
    MindMapPanel.getCurrent()?.setMindMapData(refreshed.mindMap);
    vscode.window.showInformationMessage("Agent Mind Map refreshed.");
  }
}

async function commandExportJson(): Promise<void> {
  if (!activeSession) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: Open a mind map first."
    );
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage("Agent Mind Map: No workspace folder.");
    return;
  }

  const outDir = vscode.Uri.joinPath(folder.uri, "docs", "agent-mindmaps");
  await vscode.workspace.fs.createDirectory(outDir);
  const fileName = `${activeSession.session.id}.json`;
  const fileUri = vscode.Uri.joinPath(outDir, fileName);
  const content = JSON.stringify(activeSession.mindMap, null, 2);
  await vscode.workspace.fs.writeFile(
    fileUri,
    Buffer.from(content, "utf8")
  );
  const doc = await vscode.workspace.openTextDocument(fileUri);
  await vscode.window.showTextDocument(doc, { preview: false });
  vscode.window.showInformationMessage(
    `Exported mind map to docs/agent-mindmaps/${fileName}`
  );
}

async function commandOpenMerged(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  // Try cached deterministic.json first; if missing or stale, rebuild.
  let merge = await readMergeRecord(deterministicMergePath(storeDir));
  if (!merge) {
    merge = await ensureDeterministicMerge();
  }
  if (!merge.meta.sessionIds.length) {
    vscode.window.showInformationMessage(
      "Agent Mind Map: 库为空。先用『Open Latest Session』等命令分析至少一个会话。"
    );
  }
  showMindMapStandalone(`Agent Mind Map · 全部`, merge.mindMap);
}

async function ensureConceptMerge(
  projectSlug?: string
): Promise<import("./store/storeTypes").MergeRecord> {
  const storeDir = getStoreDir();
  const records = await loadLibraryRecords();
  const merge = buildConceptMergeRecord(records, { projectSlug });
  if (!projectSlug) {
    await writeMergeRecord(conceptTrieMergePath(storeDir), merge);
  }
  return merge;
}

async function commandOpenConceptMerged(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  let merge = await readMergeRecord(conceptTrieMergePath(storeDir));
  if (!merge) {
    merge = await ensureConceptMerge();
  }
  // Show a hint when many records still lack conceptPath (e.g. produced
  // before the prompt v2 upgrade) so users know why the trie looks sparse.
  const records = await loadLibraryRecords();
  const { stats } = buildConceptTrieMindMap(records);
  if (stats.topicsWithoutPath > 0 && stats.topicsWithPath === 0) {
    vscode.window.showInformationMessage(
      "Agent Mind Map: 库里所有核心都没有 conceptPath（可能是升级前分析的）。对每个会话执行 Refresh 即可重新分析并填上概念路径。"
    );
  } else if (stats.topicsWithoutPath > 0) {
    vscode.window.showInformationMessage(
      `Agent Mind Map: ${stats.topicsWithoutPath} 个核心缺少 conceptPath，被放在「未分类」分支下。`
    );
  }
  showMindMapStandalone("Concept Mind Map · 全部", merge.mindMap);
}

async function commandOpenConceptMergedCurrentProject(): Promise<void> {
  const slug = getWorkspaceSlug();
  if (!slug) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: Open a workspace folder first."
    );
    return;
  }
  const merge = await ensureConceptMerge(slug);
  showMindMapStandalone(`Concept Mind Map · ${slug}`, merge.mindMap);
}

async function commandOpenMergedCurrentProject(): Promise<void> {
  const slug = getWorkspaceSlug();
  if (!slug) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: Open a workspace folder first."
    );
    return;
  }
  const merge = await ensureDeterministicMerge(slug);
  if (!merge.meta.sessionIds.length) {
    vscode.window.showInformationMessage(
      `Agent Mind Map: 当前项目 (${slug}) 库中暂无已分析的会话。`
    );
  }
  showMindMapStandalone(`Agent Mind Map · ${slug}`, merge.mindMap);
}

type PickScope =
  | { kind: "all" }
  | { kind: "current"; slug: string }
  | { kind: "select" };

async function pickMergeScope(
  currentSlug: string | undefined
): Promise<PickScope | undefined> {
  const items: (vscode.QuickPickItem & { scope: PickScope })[] = [];
  if (currentSlug) {
    items.push({
      label: `当前项目 (${currentSlug})`,
      description: "合并当前 workspace 的所有已分析会话",
      scope: { kind: "current", slug: currentSlug },
    });
  }
  items.push({
    label: "全部项目",
    description: "合并库中所有项目的所有会话",
    scope: { kind: "all" },
  });
  items.push({
    label: "手动选择会话…",
    description: "多选要参与合并的会话",
    scope: { kind: "select" },
  });
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "选择 LLM 合并范围",
  });
  return picked?.scope;
}

async function pickRecordsManually(
  records: SessionRecord[]
): Promise<SessionRecord[] | undefined> {
  if (!records.length) {
    return undefined;
  }
  const items = records.map((r) => ({
    label: r.meta.sessionLabel,
    description: r.meta.projectPath ?? r.meta.projectSlug,
    detail: r.graph.title
      ? `${r.graph.title} · ${r.graph.topics.length} 个主题`
      : `${r.graph.topics.length} 个主题`,
    record: r,
    picked: true,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: "选择参与合并的会话（默认全选）",
  });
  return picked?.map((p) => p.record);
}

async function commandLlmMergeRefine(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const all = await listRecords(storeDir);
  if (!all.length) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: 库为空，先分析至少一个会话再尝试合并。"
    );
    return;
  }
  const scope = await pickMergeScope(getWorkspaceSlug());
  if (!scope) {
    return;
  }
  let selected: SessionRecord[];
  switch (scope.kind) {
    case "all":
      selected = all;
      break;
    case "current":
      selected = all.filter((r) => r.meta.projectSlug === scope.slug);
      if (!selected.length) {
        vscode.window.showInformationMessage(
          `当前项目 (${scope.slug}) 库中暂无已分析的会话。`
        );
        return;
      }
      break;
    case "select": {
      const picked = await pickRecordsManually(all);
      if (!picked || !picked.length) {
        return;
      }
      selected = picked;
      break;
    }
  }

  const llmOpts = readLlmOptions();
  const config = vscode.workspace.getConfiguration("agentMindmap");
  const maxTopics = Math.max(
    2,
    config.get<number>("merge.llm.maxTopics", 8) ?? 8
  );
  const maxItemsPerTopic = Math.max(
    1,
    config.get<number>("merge.llm.maxItemsPerTopic", 6) ?? 6
  );

  const merge = await withCancellableProgress(async (signal) => {
    const provider = getProvider(llmOpts);
    return mergeWithLlm(
      selected,
      {
        maxTopics,
        maxItemsPerTopic,
        model: llmOpts.model || undefined,
      },
      provider,
      storeDir,
      signal
    );
  }, "Agent Mind Map: 正在合并主题…");

  if (!merge) {
    return;
  }
  showMindMapStandalone("Agent Mind Map · LLM 合并", merge.mindMap);
}

async function commandBrowseLibrary(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const records = await listRecords(storeDir);
  if (!records.length) {
    vscode.window.showInformationMessage(
      "Agent Mind Map: 库为空。先分析至少一个会话。"
    );
    return;
  }
  records.sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
  const items = records.map((r) => ({
    label: r.meta.sessionLabel,
    description:
      r.meta.projectPath ?? slugToWorkspacePath(r.meta.projectSlug),
    detail: r.graph.title
      ? `${r.graph.title} · ${r.graph.topics.length} 个主题`
      : `${r.graph.topics.length} 个主题`,
    record: r,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "选择要打开的已分析会话（来自库）",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) {
    return;
  }
  const root = buildTopicMindMap(
    picked.record.graph,
    picked.record.meta.sessionLabel
  );
  showMindMapStandalone(
    `${picked.record.meta.sessionLabel} (库)`,
    root
  );
}

async function commandOpenStoreDir(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  await vscode.env.openExternal(vscode.Uri.file(storeDir));
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "agent-mindmap.openLatest",
      commandOpenLatest
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.pickSession",
      commandPickSession
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.refresh",
      commandRefresh
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.exportJson",
      commandExportJson
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.openMerged",
      commandOpenMerged
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.openMergedCurrentProject",
      commandOpenMergedCurrentProject
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.openConceptMerged",
      commandOpenConceptMerged
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.openConceptMergedCurrentProject",
      commandOpenConceptMergedCurrentProject
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.llmMergeRefine",
      commandLlmMergeRefine
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.browseLibrary",
      commandBrowseLibrary
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.openStoreDir",
      commandOpenStoreDir
    )
  );

  // Quiet "unused" warning when transcripts dir is invalid in some shells.
  void getTranscriptsDir;
  void LlmProviderError;
}

export function deactivate(): void {
  activeSession = undefined;
}
