import * as vscode from "vscode";
import {
  diagnoseJumpCommands,
  drainPendingJump,
  handleNodeClicked,
  tryOpenAgentShapes,
  consumeTranscriptDocUriIfAutoReveal,
} from "./jumpToOrigin";
import {
  findKeysReferencingComposer,
  inspectComposerHeader,
  listAgentRelatedKeys,
  loadGlassResumableIds,
  readStateDbKey,
} from "./transcript/composerTitles";
import { mindMapLog } from "./webview/MindMapLog";
import { MindMapPanel } from "./webview/MindMapPanel";
import {
  loadLatestSession,
  loadSession,
  pickSession,
  type LoadedSession,
} from "./sessionLoader";
import {
  getActiveHost,
  getHostById,
  getWorkspaceSlug,
  resetHostCache,
  resolveHostId,
} from "./host";
import { getStoreDir } from "./paths";
import type { LlmProviderId } from "./llm/types";
import {
  conceptTrieMergePath,
  deterministicMergePath,
  ensureStore,
  listRecords,
  readMergeRecord,
  rebuildIndex,
  writeMergeRecord,
} from "./store/sessionStore";
import { buildDeterministicMergeRecordAsync } from "./store/mergeDeterministic";
import {
  buildConceptMergeRecordAsync,
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

function createOrShowMindMap(): MindMapPanel {
  return MindMapPanel.createOrShow(extensionContext.extensionUri);
}

function showMindMap(loaded: LoadedSession): void {
  activeSession = loaded;

  const panel = createOrShowMindMap();
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
  const panel = createOrShowMindMap();
  panel.setMindMapData(data);
  panel.setTitle(title);
}

function resolveLlmProviderId(
  setting: string,
  hostDefault: LlmProviderId
): LlmProviderId {
  if (setting === "auto") {
    return hostDefault;
  }
  if (setting === "cursor-cli" || setting === "claude-cli") {
    return setting;
  }
  return hostDefault;
}

async function readLlmOptions(
  context: vscode.ExtensionContext
): Promise<LlmProviderOptions> {
  const host = await getActiveHost(context);
  const config = vscode.workspace.getConfiguration("agentMindmap");
  const providerSetting = config.get<string>("llm.provider", "auto");
  return {
    provider: resolveLlmProviderId(providerSetting, host.defaultLlmProvider),
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
    hostId: host.id,
  };
}

function metaProjectPath(meta: SessionRecord["meta"]): string {
  if (meta.projectPath) {
    return meta.projectPath;
  }
  const host = getHostById(meta.hostId ?? "cursor");
  return host.slugToWorkspacePath(meta.projectSlug);
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
  const merge = await buildDeterministicMergeRecordAsync(records, { projectSlug });
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

function hasAnyOrigin(
  node: import("./transcript/types").MindMapRoot
): boolean {
  if (node.data.origin?.refs?.length) {
    return true;
  }
  if (node.children) {
    for (const c of node.children) {
      if (hasAnyOrigin(c)) {
        return true;
      }
    }
  }
  return false;
}

async function commandOpenMerged(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const merge = await ensureDeterministicMerge();
  if (!merge.meta.sessionIds.length) {
    vscode.window.showInformationMessage(
      "Agent Mind Map: 库为空。先用『Open Latest Session』等命令分析至少一个会话。"
    );
  }
  await showMindMapStandalone(`Agent Mind Map · 全部`, merge.mindMap);
}

async function ensureConceptMerge(
  projectSlug?: string
): Promise<import("./store/storeTypes").MergeRecord> {
  const storeDir = getStoreDir();
  const records = await loadLibraryRecords();
  const merge = await buildConceptMergeRecordAsync(records, { projectSlug });
  if (!projectSlug) {
    await writeMergeRecord(conceptTrieMergePath(storeDir), merge);
  }
  return merge;
}

async function commandOpenConceptMerged(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const merge = await ensureConceptMerge();
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
  await showMindMapStandalone("Concept Mind Map · 全部", merge.mindMap);
}

async function commandOpenConceptMergedCurrentProject(): Promise<void> {
  const host = await getActiveHost(extensionContext);
  const slug = getWorkspaceSlug(host);
  if (!slug) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: Open a workspace folder first."
    );
    return;
  }
  const merge = await ensureConceptMerge(slug);
  await showMindMapStandalone(`Concept Mind Map · ${slug}`, merge.mindMap);
}

async function commandOpenMergedCurrentProject(): Promise<void> {
  const host = await getActiveHost(extensionContext);
  const slug = getWorkspaceSlug(host);
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
  await showMindMapStandalone(`Agent Mind Map · ${slug}`, merge.mindMap);
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
  const mergeHost = await getActiveHost(extensionContext);
  const scope = await pickMergeScope(getWorkspaceSlug(mergeHost));
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

  const llmOpts = await readLlmOptions(extensionContext);
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
        hostId: mergeHost.id,
      },
      provider,
      storeDir,
      signal
    );
  }, "Agent Mind Map: 正在合并主题…");

  if (!merge) {
    return;
  }
  await showMindMapStandalone("Agent Mind Map · LLM 合并", merge.mindMap);
}

// ---------------------------------------------------------------------------
// Search library
// ---------------------------------------------------------------------------

type SearchHit = {
  record: SessionRecord;
  /** Highlighted match reason shown in the QuickPick detail line. */
  matchSnippet: string;
  score: number;
};

/**
 * Score a single record against a lower-cased query string.
 * Returns undefined when there is no match at all.
 */
function scoreRecord(record: SessionRecord, queryLc: string): SearchHit | undefined {
  let score = 0;
  const snippets: string[] = [];

  const check = (text: string | undefined, weight: number, label: string) => {
    if (!text) return;
    if (text.toLowerCase().includes(queryLc)) {
      score += weight;
      snippets.push(`${label}: ${text.slice(0, 80).trim()}`);
    }
  };

  check(record.meta.sessionLabel, 4, "会话");
  check(record.graph.title, 3, "标题");
  check(record.graph.summary, 2, "摘要");
  for (const topic of record.graph.topics ?? []) {
    check(topic.title, 2, "主题");
    check(topic.summary, 1, "主题摘要");
    for (const item of topic.items ?? []) {
      check(item.text, 1, "要点");
    }
  }

  if (score === 0) return undefined;
  return { record, score, matchSnippet: snippets[0] ?? "" };
}

async function commandSearchLibrary(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const records = await listRecords(storeDir);
  if (!records.length) {
    vscode.window.showInformationMessage(
      "Agent Mind Map: 库为空。先分析至少一个会话。"
    );
    return;
  }

  type PickItem = vscode.QuickPickItem & { record: SessionRecord };

  const qp = vscode.window.createQuickPick<PickItem>();
  qp.placeholder = "搜索主题、标题、要点关键词…";
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;

  const buildItems = (query: string): PickItem[] => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // No query — show all, sorted by recency
      return records
        .slice()
        .sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt)
        .map((r) => ({
          label: r.meta.sessionLabel,
          description: metaProjectPath(r.meta),
          detail: r.graph.title
            ? `${r.graph.title} · ${r.graph.topics.length} 个主题`
            : `${r.graph.topics.length} 个主题`,
          record: r,
        }));
    }
    const hits: SearchHit[] = [];
    for (const r of records) {
      const hit = scoreRecord(r, q);
      if (hit) hits.push(hit);
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.map((h) => ({
      label: h.record.meta.sessionLabel,
      description:
        h.record.meta.projectPath ??
        metaProjectPath(h.record.meta),
      detail: h.matchSnippet,
      record: h.record,
    }));
  };

  qp.items = buildItems("");

  qp.onDidChangeValue((value) => {
    qp.items = buildItems(value);
  });

  qp.onDidAccept(() => {
    const picked = qp.selectedItems[0];
    qp.hide();
    if (!picked) return;
    const meta = picked.record.meta;
    const root = buildTopicMindMap(picked.record.graph, meta.sessionLabel, {
      sessionId: meta.sessionId,
      projectSlug: meta.projectSlug,
      projectPath: meta.projectPath,
      sessionLabel: meta.sessionLabel,
      transcriptPath: meta.transcriptPath,
    });
    void showMindMapStandalone(`${meta.sessionLabel} (搜索结果)`, root);
  });

  qp.onDidHide(() => qp.dispose());
  qp.show();
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
      metaProjectPath(r.meta),
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
  const meta = picked.record.meta;
  const root = buildTopicMindMap(
    picked.record.graph,
    meta.sessionLabel,
    {
      sessionId: meta.sessionId,
      projectSlug: meta.projectSlug,
      projectPath: meta.projectPath,
      sessionLabel: meta.sessionLabel,
      transcriptPath: meta.transcriptPath,
    }
  );
  await showMindMapStandalone(
    `${meta.sessionLabel} (库)`,
    root
  );
}

async function commandOpenStoreDir(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  await vscode.env.openExternal(vscode.Uri.file(storeDir));
}

/**
 * Run the click-to-jump flow without clicking a node. Useful for verifying
 * that the picker / agent-open / clipboard / line-reveal pipeline works
 * when the user reports "the leaf doesn't respond" — the most common
 * cause of that is a stale webview bundle, and this command bypasses the
 * webview entirely.
 */
async function commandDumpStateDbKey(): Promise<void> {
  if (!(await requireCursorHostForDebug())) {
    return;
  }
  const candidates = [
    "glass.localAgentProjects.v1",
    "glass.localAgentProjectMembership.v1",
    "composer.composerHeaders",
    "agentLayout.shared.v6",
  ];
  const picked = await vscode.window.showQuickPick(
    candidates.map((k) => ({ label: k })),
    {
      placeHolder: "选择一个 state.vscdb key 查看完整 value",
    }
  );
  if (!picked) return;
  const value = await readStateDbKey(picked.label);
  if (value === undefined) {
    vscode.window.showWarningMessage(`Agent Mind Map: key ${picked.label} 不存在或读取失败。`);
    return;
  }
  let pretty = value;
  try {
    pretty = JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    // not JSON
  }
  const doc = await vscode.workspace.openTextDocument({
    content: `// state.vscdb key: ${picked.label}\n// raw size: ${value.length} chars\n\n${pretty}`,
    language: "json",
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function commandInspectComposerHeader(): Promise<void> {
  if (!(await requireCursorHostForDebug())) {
    return;
  }
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const records = await listRecords(storeDir);
  if (!records.length) {
    vscode.window.showWarningMessage("Agent Mind Map: 库为空。");
    return;
  }
  records.sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
  const picked = await vscode.window.showQuickPick(
    records.map((r) => ({
      label: r.meta.sessionLabel,
      description: r.meta.sessionId,
      detail: r.meta.projectPath ?? r.meta.projectSlug,
      sessionId: r.meta.sessionId,
    })),
    { placeHolder: "选择一个 session 检查它在 composer.composerHeaders 里的条目" }
  );
  if (!picked) return;

  const info = await inspectComposerHeader(picked.sessionId);
  const lines: string[] = [];
  lines.push(`=== composer.composerHeaders 概览 ===`);
  lines.push(`总数: ${info.totalComposers}`);
  lines.push(`按 type 统计:`);
  for (const [t, n] of Object.entries(info.typeCounts).sort(
    (a, b) => b[1] - a[1]
  )) {
    lines.push(`  ${t}: ${n}`);
  }
  lines.push("");
  lines.push(`=== 你选的 session 在 allComposers 里的条目 ===`);
  lines.push(`composerId: ${picked.sessionId}`);
  if (info.ourEntry === undefined) {
    lines.push(`<不在 allComposers 里>`);
  } else {
    lines.push(JSON.stringify(info.ourEntry, null, 2));
  }
  const dump = lines.join("\n");
  mindMapLog("inspectComposerHeader:\n" + dump);
  const doc = await vscode.workspace.openTextDocument({
    content: dump,
    language: "log",
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function requireCursorHostForDebug(): Promise<boolean> {
  const host = await getActiveHost(extensionContext);
  if (host.id !== "cursor") {
    vscode.window.showInformationMessage(
      "Agent Mind Map: 此调试命令仅在 agentMindmap.host 为 Cursor 时可用。"
    );
    return false;
  }
  return true;
}

async function commandDumpGlassState(): Promise<void> {
  if (!(await requireCursorHostForDebug())) {
    return;
  }
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const records = await listRecords(storeDir);
  records.sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);

  const allRelated = await listAgentRelatedKeys();
  const lines: string[] = [];
  lines.push(`==== All agent/composer/glass keys in state.vscdb ====`);
  lines.push(`(${allRelated.length} rows)`);
  for (const row of allRelated) {
    lines.push(`  [${row.table}] ${row.key}  (${row.valueSize} bytes)`);
  }
  lines.push("");

  if (records.length > 0) {
    const newest = records[0]!;
    lines.push(
      `==== Keys referencing newest analyzed session ${newest.meta.sessionId} (${newest.meta.sessionLabel}) ====`
    );
    const hits = await findKeysReferencingComposer(newest.meta.sessionId);
    lines.push(`(${hits.length} hits)`);
    for (const hit of hits) {
      lines.push(`  [${hit.table}] ${hit.key}`);
      lines.push(`      preview: ${hit.valuePreview}`);
    }
  }

  const dump = lines.join("\n");
  mindMapLog("Glass state dump:\n" + dump);
  // Show in a new untitled doc so the user can easily inspect/share.
  const doc = await vscode.workspace.openTextDocument({
    content: dump,
    language: "log",
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function commandTryOpenAgentShapes(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const records = await listRecords(storeDir);
  if (!records.length) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: 库为空，先用 Open Latest Session 等命令分析至少一个会话。"
    );
    return;
  }
  records.sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
  const picked = await vscode.window.showQuickPick(
    records.map((r) => ({
      label: r.meta.sessionLabel,
      description: r.meta.sessionId,
      detail: r.meta.projectPath ?? r.meta.projectSlug,
      sessionId: r.meta.sessionId,
    })),
    { placeHolder: "选择一个 session 来调试 glass.openAgentById 的参数形态" }
  );
  if (!picked) return;
  await tryOpenAgentShapes(picked.sessionId);
}

async function commandTestJump(): Promise<void> {
  const storeDir = getStoreDir();
  await ensureStore(storeDir);
  const records = await listRecords(storeDir);
  if (!records.length) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: 库为空，先用 Open Latest Session 等命令分析至少一个会话。"
    );
    return;
  }
  records.sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
  const pickedRecord = await vscode.window.showQuickPick(
    records.map((r) => ({
      label: r.meta.sessionLabel,
      description: r.meta.projectPath ?? r.meta.projectSlug,
      record: r,
    })),
    { placeHolder: "选择一个 session 作为模拟点击的目标" }
  );
  if (!pickedRecord) {
    return;
  }
  const meta = pickedRecord.record.meta;
  await handleNodeClicked(
    {
      refs: [
        {
          sessionId: meta.sessionId,
          projectSlug: meta.projectSlug,
          projectPath: meta.projectPath,
          sessionLabel: meta.sessionLabel,
          transcriptPath: meta.transcriptPath,
        },
      ],
    },
    { context: extensionContext }
  );
}

async function maybeWarnEmptyClaudeTranscripts(
  context: vscode.ExtensionContext
): Promise<void> {
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

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("agentMindmap.host") ||
        e.affectsConfiguration("agentMindmap.projectsDir") ||
        e.affectsConfiguration("agentMindmap.claudeProjectsDir")
      ) {
        resetHostCache();
      }
    })
  );

  void maybeWarnEmptyClaudeTranscripts(context);

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (!consumeTranscriptDocUriIfAutoReveal(doc)) {
        return;
      }
      MindMapPanel.getCurrent()?.reveal();
    })
  );

  MindMapPanel.onNodeClicked((payload) =>
    void handleNodeClicked(payload, {
      context: extensionContext,
      listSessionRecords: async () => {
        const storeDir = getStoreDir();
        await ensureStore(storeDir);
        return listRecords(storeDir);
      },
    })
  );

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
      "agent-mindmap.searchLibrary",
      commandSearchLibrary
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.browseLibrary",
      commandBrowseLibrary
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.openStoreDir",
      commandOpenStoreDir
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.testJump",
      commandTestJump
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.diagnoseJump",
      diagnoseJumpCommands
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.tryOpenAgentShapes",
      commandTryOpenAgentShapes
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.dumpGlassState",
      commandDumpGlassState
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.inspectComposerHeader",
      commandInspectComposerHeader
    ),
    vscode.commands.registerCommand(
      "agent-mindmap.dumpStateDbKey",
      commandDumpStateDbKey
    )
  );

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
      (ids) =>
        mindMapLog(
          `[activate] pre-warmed glass registry: ${ids.size} resumable ids`
        ),
      (err) => mindMapLog(`[activate] glass registry preload failed: ${err}`)
    );
  });
}

export function deactivate(): void {
  activeSession = undefined;
}
