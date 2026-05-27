import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import {
  extractCitedSessionIds,
  findBestTurnIndex,
  flattenCandidates,
  formatPickerLabel,
  isMetaSearchUserQuery,
  parseQTagsFromNodeLabel,
  type JumpCandidate,
  type PendingJump,
  PENDING_JUMP_KEY,
} from "./jumpToOriginCore";
import type { SessionRecord } from "./store/storeTypes";
import { getActiveHost } from "./host";
import { getHostById } from "./host/registry";
import type { AgentHostId } from "./host/types";
import { slugToWorkspacePath } from "./paths";
import type { ChatEvent, NodeOrigin } from "./transcript/types";
import { mindMapLog } from "./webview/MindMapLog";
import { MindMapPanel } from "./webview/MindMapPanel";

// Untitled markdown docs created via `vscode.workspace.openTextDocument({ content })`.
// When the user closes one, reveal the mind map editor tab again.
const transcriptDocUrisToAutoReveal = new Set<string>();

const MARKDOWN_PREVIEW_EDITOR = "vscode.markdown.preview.editor";

type OpenPreviewOpts = {
  viewColumn: vscode.ViewColumn;
  selection?: vscode.Range;
};

/** Cursor's extension host may lack `vscode.openWith`; use command fallbacks. */
async function openMarkdownPreviewEditor(
  uri: vscode.Uri,
  opts: OpenPreviewOpts
): Promise<{ ok: boolean; method: string; error?: string }> {
  const openOpts = {
    viewColumn: opts.viewColumn,
    selection: opts.selection,
  };

  if (typeof vscode.openWith === "function") {
    try {
      await vscode.openWith(uri, MARKDOWN_PREVIEW_EDITOR, openOpts);
      return { ok: true, method: "api.openWith" };
    } catch (err) {
      return {
        ok: false,
        method: "api.openWith",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  try {
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      MARKDOWN_PREVIEW_EDITOR,
      openOpts
    );
    return { ok: true, method: "command.vscode.openWith" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await vscode.commands.executeCommand("markdown.showPreview", uri);
      return { ok: true, method: "command.markdown.showPreview" };
    } catch (err2) {
      return {
        ok: false,
        method: "command.markdown.showPreview",
        error: `${msg}; ${err2 instanceof Error ? err2.message : String(err2)}`,
      };
    }
  }
}

export {
  flattenCandidates,
  formatPickerLabel,
  type JumpCandidate,
  type PendingJump,
  PENDING_JUMP_KEY,
};

export function consumeTranscriptDocUriIfAutoReveal(
  doc: vscode.TextDocument
): boolean {
  return transcriptDocUrisToAutoReveal.delete(doc.uri.toString());
}

function hostForTranscriptPath(transcriptPath: string): import("./host/types").AgentHost {
  if (transcriptPath.includes(`${path.sep}agent-transcripts${path.sep}`)) {
    return getHostById("cursor");
  }
  return getHostById("claude-code");
}

async function resolveTurnEvents(
  transcriptPath: string,
  cache: Map<string, ChatEvent[]>,
  context?: vscode.ExtensionContext
): Promise<ChatEvent[]> {
  const cached = cache.get(transcriptPath);
  if (cached) {
    return cached;
  }
  try {
    const content = await fs.readFile(transcriptPath, "utf8");
    const host = context
      ? await getActiveHost(context)
      : hostForTranscriptPath(transcriptPath);
    const events = host.parseTranscript(content);
    cache.set(transcriptPath, events);
    return events;
  } catch (err) {
    console.warn(
      `[agent-mindmap] failed to read transcript for jump: ${transcriptPath}`,
      err
    );
    cache.set(transcriptPath, []);
    return [];
  }
}

async function enrichWithTurnData(
  candidates: JumpCandidate[],
  context?: vscode.ExtensionContext
): Promise<JumpCandidate[]> {
  const cache = new Map<string, ChatEvent[]>();
  // Pre-resolve transcripts once per file.
  const transcriptPaths = new Set(
    candidates
      .filter((c) => c.turnIndex !== undefined)
      .map((c) => c.transcriptPath)
  );
  for (const p of transcriptPaths) {
    await resolveTurnEvents(p, cache, context);
  }
  return candidates.map((c) => {
    if (c.turnIndex === undefined) {
      return c;
    }
    const events = cache.get(c.transcriptPath) ?? [];
    const userQueries = events.filter((e) => e.kind === "user_query") as Array<
      Extract<ChatEvent, { kind: "user_query" }>
    >;
    const ev = userQueries[c.turnIndex];
    if (!ev) {
      return c;
    }
    return { ...c, question: ev.text };
  });
}

type CandidateRow = vscode.QuickPickItem & { candidate: JumpCandidate };

async function pickCandidate(
  candidates: JumpCandidate[]
): Promise<JumpCandidate | undefined> {
  if (candidates.length === 1) {
    return candidates[0];
  }

  // Group by session for legibility: branch entry first, then Q# entries.
  // Within each session, preserve the order produced by flattenCandidates
  // (which mirrors first-seen ref order in the mind map).
  const bySession = new Map<string, JumpCandidate[]>();
  const sessionOrder: string[] = [];
  for (const c of candidates) {
    const arr = bySession.get(c.sessionId);
    if (arr) {
      arr.push(c);
    } else {
      bySession.set(c.sessionId, [c]);
      sessionOrder.push(c.sessionId);
    }
  }

  const items: CandidateRow[] = [];
  for (const sid of sessionOrder) {
    const rows = bySession.get(sid)!;
    rows.sort((a, b) => {
      if (a.turnIndex === undefined && b.turnIndex !== undefined) return -1;
      if (a.turnIndex !== undefined && b.turnIndex === undefined) return 1;
      return (a.turnIndex ?? 0) - (b.turnIndex ?? 0);
    });
    for (const c of rows) {
      items.push({
        label: formatPickerLabel(c),
        description: c.sessionLabel,
        detail: c.projectPath ?? slugToWorkspacePath(c.projectSlug),
        candidate: c,
      });
    }
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "选择要打开的会话 / 问题",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return picked?.candidate;
}

/**
 * Keywords used to filter vscode.commands.getCommands() when diagnosing
 * which agent-open commands are available in the current Cursor build.
 */
const AGENT_CMD_KEYWORDS = [
  "glass",
  "composer",
  "agent",
  "chat",
  "claude",
  "anthropic",
];

/** Cached result of probing which open-by-id command actually works. */
let _openByIdCmd:
  | { hostId: AgentHostId; cmd: string | null }
  | undefined = undefined;

async function probeOpenByIdCommand(
  context?: vscode.ExtensionContext
): Promise<string | null> {
  const host = await getActiveHost(context);
  if (_openByIdCmd?.hostId === host.id) {
    return _openByIdCmd.cmd;
  }
  const candidates = host.jumpCommandCandidates;
  const all = await vscode.commands.getCommands(true);
  const allSet = new Set(all);
  for (const cmd of candidates) {
    if (allSet.has(cmd)) {
      mindMapLog(`[openAgentById] will use command: ${cmd}`);
      _openByIdCmd = { hostId: host.id, cmd };
      return cmd;
    }
  }
  mindMapLog(
    `[openAgentById] none of ${candidates.join(", ")} found. Available agent-related: ` +
      all
        .filter((c) => AGENT_CMD_KEYWORDS.some((k) => c.toLowerCase().includes(k)))
        .join(", ")
  );
  _openByIdCmd = { hostId: host.id, cmd: null };
  return null;
}

/**
 * Try a single invocation shape against `glass.openAgentById`.
 * Returns true if the call appeared to succeed *and* returned a value
 * that suggests it did something (commands that silently no-op tend to
 * return undefined; commands that found+opened the target tend to
 * return a truthy value, but this isn't guaranteed across versions).
 *
 * We don't actually rely on the return value to stop — we just log it
 * so we can debug from the user's log.
 */
async function tryOpenById(
  cmd: string,
  arg: unknown,
  shapeLabel: string
): Promise<unknown> {
  try {
    const ret = await vscode.commands.executeCommand(cmd, arg);
    mindMapLog(
      `[openAgentById] ${cmd} ${shapeLabel} → ${JSON.stringify(ret) ?? "undefined"}`
    );
    return ret;
  } catch (err) {
    mindMapLog(`[openAgentById] ${cmd} ${shapeLabel} threw: ${err}`);
    return undefined;
  }
}

async function ensureAgentsViewVisible(): Promise<void> {
  const candidates = [
    "workbench.action.openAgentsView",
    "workbench.action.toggleAgents",
  ];
  const all = new Set(await vscode.commands.getCommands(true));
  for (const cmd of candidates) {
    if (all.has(cmd)) {
      try {
        await vscode.commands.executeCommand(cmd);
        mindMapLog(`[openAgentById] ensured agents view via ${cmd}`);
        return;
      } catch (err) {
        mindMapLog(`[openAgentById] ${cmd} threw: ${err}`);
      }
    }
  }
}

/** Column where the mind map tab lives (same group → markdown covers the map). */
function transcriptViewColumn(): vscode.ViewColumn {
  const map = MindMapPanel.getCurrent();
  const col = map?.viewColumn ?? vscode.ViewColumn.Active;
  mindMapLog(`openTranscript: using editor column ${col}`);
  return col;
}

async function openChosenTranscript(
  candidate: JumpCandidate,
  context?: vscode.ExtensionContext
): Promise<void> {
  if (!candidate.transcriptPath) {
    vscode.window.showErrorMessage(
      "Agent Mind Map: 无法打开对话记录（缺少 transcript 路径）。"
    );
    return;
  }
  const cache = new Map<string, ChatEvent[]>();
  const events = await resolveTurnEvents(
    candidate.transcriptPath,
    cache,
    context
  );
  const userQueryCount = events.filter((e) => e.kind === "user_query").length;
  let focusTurnIndex = candidate.turnIndex;
  if (
    focusTurnIndex !== undefined &&
    focusTurnIndex >= userQueryCount
  ) {
    vscode.window.showWarningMessage(
      `Agent Mind Map: 该节点标注的 Q${focusTurnIndex + 1} 在当前 transcript 中不存在（共 ${userQueryCount} 轮用户提问）。已打开整段会话。`
    );
    focusTurnIndex = undefined;
  }
  await openTranscriptAsMarkdown(candidate.transcriptPath, {
    label: candidate.sessionLabel,
    focusTurnIndex,
    context,
  });
}

/**
 * Render a composer .jsonl as Markdown in the same editor column as the mind
 * map tab (map stays open behind until the user closes the markdown tab).
 */
async function openTranscriptAsMarkdown(
  transcriptPath: string,
  opts: {
    label?: string;
    focusTurnIndex?: number;
    context?: vscode.ExtensionContext;
  } = {}
): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(transcriptPath, "utf8");
  } catch (err) {
    vscode.window.showErrorMessage(
      `Agent Mind Map: 读取 transcript 失败: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  const host = opts.context
    ? await getActiveHost(opts.context)
    : hostForTranscriptPath(transcriptPath);
  const events = host.parseTranscript(content);
  const lines: string[] = [];
  const title = opts.label ?? path.basename(transcriptPath);
  lines.push(`# ${title}`);
  lines.push("");

  let userQueryOrdinal = -1;
  let displayQ = 0;
  let focusLine = -1;
  let skipNextAssistant = false;
  for (const ev of events) {
    if (ev.kind === "user_query") {
      userQueryOrdinal += 1;
      if (isMetaSearchUserQuery(ev.text)) {
        skipNextAssistant = true;
        continue;
      }
      skipNextAssistant = false;
      displayQ += 1;
      if (opts.focusTurnIndex === userQueryOrdinal) {
        focusLine = lines.length;
      }
      lines.push(`## Q${displayQ}`);
      lines.push("");
      for (const t of ev.text.split(/\r?\n/)) {
        lines.push(`> ${t}`);
      }
      lines.push("");
    } else if (ev.kind === "assistant_summary") {
      if (skipNextAssistant) {
        skipNextAssistant = false;
        continue;
      }
      if (displayQ === 0) {
        continue;
      }
      lines.push(`### A${displayQ}`);
      lines.push("");
      lines.push(ev.text);
      lines.push("");
    }
  }

  const editorColumn = transcriptViewColumn();

  const doc = await vscode.workspace.openTextDocument({
    content: lines.join("\n"),
    language: "markdown",
  });

  // Mark this doc so `onDidCloseTextDocument` can auto-reveal the map.
  transcriptDocUrisToAutoReveal.add(doc.uri.toString());

  const selection =
    focusLine >= 0
      ? new vscode.Range(
          new vscode.Position(focusLine, 0),
          new vscode.Position(focusLine, 0)
        )
      : undefined;

  const previewResult = await openMarkdownPreviewEditor(doc.uri, {
    viewColumn: editorColumn,
    selection,
  });
  if (previewResult.ok) {
    return;
  }
  mindMapLog(
    `openTranscriptAsMarkdown: preview failed (${previewResult.method}): ${previewResult.error ?? "unknown"}`
  );

  const editor = await vscode.window.showTextDocument(doc, {
    viewColumn: editorColumn,
    preview: false,
  });
  if (selection) {
    editor.selections = [new vscode.Selection(selection.start, selection.end)];
    editor.revealRange(selection, vscode.TextEditorRevealType.AtTop);
  }
}

/**
 * Debug helper: try every known argument shape for `glass.openAgentById`
 * against a session id chosen from the library, with a confirmation
 * between each so the user can spot which shape actually focused the
 * intended agent. Designed for the case where the default (string)
 * form fails silently.
 */
export async function tryOpenAgentShapes(
  sessionId: string,
  context?: vscode.ExtensionContext
): Promise<void> {
  const host = await getActiveHost(context);
  const cmd = await probeOpenByIdCommand(context);
  if (!cmd) {
    vscode.window.showWarningMessage(
      `Agent Mind Map: 当前 ${host.displayName} 环境不支持按 ID 打开原生 Agent 面板。`
    );
    return;
  }
  await ensureAgentsViewVisible();
  const shapes: Array<{ arg: unknown; label: string }> = [
    { arg: sessionId, label: "(string)" },
    { arg: { id: sessionId }, label: "({id})" },
    { arg: { composerId: sessionId }, label: "({composerId})" },
    { arg: { agentId: sessionId }, label: "({agentId})" },
    { arg: { sessionId }, label: "({sessionId})" },
  ];
  for (const { arg, label } of shapes) {
    const ret = await tryOpenById(cmd, arg, label);
    const choice = await vscode.window.showInformationMessage(
      `Agent Mind Map · 调用 ${cmd} ${label} → ${JSON.stringify(ret) ?? "undefined"}。是否打开了正确的 Agent？`,
      "✅ 是，停止",
      "❌ 否，继续下一个"
    );
    if (choice === "✅ 是，停止") {
      mindMapLog(`[openAgentById] user confirmed working shape: ${label}`);
      vscode.window.showInformationMessage(
        `Agent Mind Map: 已记住 shape ${label}（请将这条信息发回开发者）。`
      );
      return;
    }
    if (!choice) {
      return;
    }
  }
  vscode.window.showWarningMessage(
    "Agent Mind Map: 尝试了所有 shape 都未生效。请检查日志面板。"
  );
}

/**
 * Diagnostic: list all agent/composer/glass commands available in this
 * Cursor build and show them in a quick-pick for easy inspection.
 */
export async function diagnoseJumpCommands(): Promise<void> {
  _openByIdCmd = undefined; // force re-probe next time
  const all = await vscode.commands.getCommands(true);
  const relevant = all.filter((c) =>
    AGENT_CMD_KEYWORDS.some((k) => c.toLowerCase().includes(k))
  );
  relevant.sort();
  mindMapLog("[diagnose] agent-related commands:\n" + relevant.join("\n"));
  const items = relevant.map((c) => ({ label: c }));
  await vscode.window.showQuickPick(items, {
    placeHolder: `发现 ${relevant.length} 个命令（已记录到 Mind Map 日志）`,
    canPickMany: false,
  });
}

export type JumpDeps = {
  context: vscode.ExtensionContext;
  listSessionRecords?: () => Promise<SessionRecord[]>;
};

export type NodeClickPayload = {
  origin: NodeOrigin;
  /** Mind-map node label (used to resolve cross-session jumps). */
  nodeLabel?: string;
};

function normalizeClick(
  payload: NodeOrigin | NodeClickPayload
): NodeClickPayload {
  if ("origin" in payload) {
    return payload;
  }
  return { origin: payload };
}

function recordToJumpCandidate(
  meta: SessionRecord["meta"],
  turnIndex?: number
): JumpCandidate {
  return {
    sessionId: meta.sessionId,
    projectSlug: meta.projectSlug,
    projectPath: meta.projectPath,
    sessionLabel: meta.sessionLabel,
    transcriptPath: meta.transcriptPath,
    turnIndex,
  };
}

async function resolveJumpCandidate(
  candidate: JumpCandidate,
  opts: {
    nodeLabel?: string;
    context?: vscode.ExtensionContext;
    listSessionRecords?: () => Promise<SessionRecord[]>;
    eventCache: Map<string, ChatEvent[]>;
  }
): Promise<JumpCandidate> {
  const qTags = opts.nodeLabel ? parseQTagsFromNodeLabel(opts.nodeLabel) : [];
  const hintText = opts.nodeLabel ?? "";
  const desiredTurn = candidate.turnIndex ?? qTags[0];

  const events = await resolveTurnEvents(
    candidate.transcriptPath,
    opts.eventCache,
    opts.context
  );
  const userQueries = events.filter(
    (e): e is Extract<ChatEvent, { kind: "user_query" }> => e.kind === "user_query"
  );

  const turnValid =
    desiredTurn !== undefined &&
    desiredTurn < userQueries.length &&
    !isMetaSearchUserQuery(userQueries[desiredTurn].text);

  if (turnValid) {
    return { ...candidate, turnIndex: desiredTurn };
  }

  const onlyMetaSearch =
    userQueries.length > 0 &&
    userQueries.every((q) => isMetaSearchUserQuery(q.text));

  const needsCrossSession =
    Boolean(opts.listSessionRecords) &&
    Boolean(hintText) &&
    !hintText.startsWith("概述") &&
    (onlyMetaSearch ||
      (desiredTurn !== undefined && desiredTurn >= userQueries.length));

  if (!needsCrossSession) {
    if (desiredTurn !== undefined && desiredTurn >= userQueries.length) {
      return { ...candidate, turnIndex: undefined };
    }
    return candidate;
  }

  const citedIds = new Set<string>();
  for (const ev of events) {
    const blob =
      ev.kind === "assistant_summary"
        ? ev.text
        : ev.kind === "tool"
          ? ev.label
          : "";
    for (const id of extractCitedSessionIds(blob)) {
      if (id !== candidate.sessionId.toLowerCase()) {
        citedIds.add(id);
      }
    }
  }

  const records = await opts.listSessionRecords!();
  const tryRecords: SessionRecord[] = [];
  for (const id of citedIds) {
    const rec = records.find((r) => r.meta.sessionId.toLowerCase() === id);
    if (rec) {
      tryRecords.push(rec);
    }
  }

  let best: { rec: SessionRecord; turn: number } | undefined;
  for (const rec of tryRecords) {
    const citedEvents = await resolveTurnEvents(
      rec.meta.transcriptPath,
      opts.eventCache,
      opts.context
    );
    const queries = citedEvents
      .filter((e) => e.kind === "user_query")
      .map((e) => e.text);
    let turn = findBestTurnIndex(queries, hintText);
    if (
      turn === undefined &&
      qTags[0] !== undefined &&
      qTags[0] < queries.length &&
      !isMetaSearchUserQuery(queries[qTags[0]])
    ) {
      turn = qTags[0];
    }
    if (turn !== undefined) {
      best = { rec, turn };
      break;
    }
  }

  if (best) {
    mindMapLog(
      `resolveJump: redirect ${candidate.sessionId} → ${best.rec.meta.sessionId} Q${best.turn + 1}`
    );
    return recordToJumpCandidate(best.rec.meta, best.turn);
  }

  return { ...candidate, turnIndex: undefined };
}

export async function handleNodeClicked(
  payload: NodeOrigin | NodeClickPayload,
  _deps?: JumpDeps
): Promise<void> {
  const { origin, nodeLabel } = normalizeClick(payload);
  if (!origin?.refs?.length) {
    mindMapLog("handleNodeClicked: empty origin, nothing to do");
    return;
  }
  mindMapLog(
    `handleNodeClicked: ${origin.refs.length} ref(s) → flattening + enriching`
  );
  const candidates = await enrichWithTurnData(
    flattenCandidates(origin.refs),
    _deps?.context
  );
  if (!candidates.length) {
    mindMapLog("handleNodeClicked: no candidates after flatten");
    return;
  }
  mindMapLog(
    `handleNodeClicked: ${candidates.length} candidate row(s) ready for picker`
  );
  const chosen = await pickCandidate(candidates);
  if (!chosen) {
    mindMapLog("handleNodeClicked: user dismissed picker");
    return;
  }
  const eventCache = new Map<string, ChatEvent[]>();
  const resolved = await resolveJumpCandidate(chosen, {
    nodeLabel,
    context: _deps?.context,
    listSessionRecords: _deps?.listSessionRecords,
    eventCache,
  });
  mindMapLog(
    `handleNodeClicked: open session=${resolved.sessionId} turnIndex=${resolved.turnIndex ?? "<branch>"}`
  );
  await openChosenTranscript(resolved, _deps?.context);
}

/**
 * Drain a pending transcript open from a previous extension version that
 * used workspace switching. Clears the record and opens markdown when a
 * transcript path is still available.
 */
export async function drainPendingJump(
  deps: JumpDeps
): Promise<void> {
  const pending = deps.context.globalState.get<PendingJump>(PENDING_JUMP_KEY);
  if (!pending) {
    return;
  }
  await deps.context.globalState.update(PENDING_JUMP_KEY, undefined);
  if (pending.expiresAt < Date.now() || !pending.transcriptPath) {
    return;
  }
  await openTranscriptAsMarkdown(pending.transcriptPath, {
    focusTurnIndex: pending.turnIndex,
    context: deps.context,
  });
}
