import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import {
  flattenCandidates,
  formatPickerLabel,
  type JumpCandidate,
  type PendingJump,
  PENDING_JUMP_KEY,
} from "./jumpToOriginCore";
import { slugToWorkspacePath } from "./paths";
import { parseJsonl } from "./transcript/parseJsonl";
import type { ChatEvent, NodeOrigin } from "./transcript/types";
import { mindMapLog } from "./webview/MindMapLog";
import { MindMapPanel } from "./webview/MindMapPanel";

// Untitled markdown docs created via `vscode.workspace.openTextDocument({ content })`.
// When the user closes one, reveal the mind map editor tab again.
const transcriptDocUrisToAutoReveal = new Set<string>();

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

async function resolveTurnEvents(
  transcriptPath: string,
  cache: Map<string, ChatEvent[]>
): Promise<ChatEvent[]> {
  const cached = cache.get(transcriptPath);
  if (cached) {
    return cached;
  }
  try {
    const content = await fs.readFile(transcriptPath, "utf8");
    const events = parseJsonl(content);
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
  candidates: JumpCandidate[]
): Promise<JumpCandidate[]> {
  const cache = new Map<string, ChatEvent[]>();
  // Pre-resolve transcripts once per file.
  const transcriptPaths = new Set(
    candidates
      .filter((c) => c.turnIndex !== undefined)
      .map((c) => c.transcriptPath)
  );
  for (const p of transcriptPaths) {
    await resolveTurnEvents(p, cache);
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
const AGENT_CMD_KEYWORDS = ["glass", "composer", "agent", "chat"];

/** Cached result of probing which open-by-id command actually works. */
let _openByIdCmd: string | null | undefined = undefined; // undefined = not yet probed

async function probeOpenByIdCommand(): Promise<string | null> {
  if (_openByIdCmd !== undefined) {
    return _openByIdCmd;
  }
  // Priority list: most specific first.
  const candidates = [
    "glass.openAgentById",
    "cursor.openAgentById",
    "composer.openComposerWithSession",
    "composer.openComposer",
  ];
  const all = await vscode.commands.getCommands(true);
  const allSet = new Set(all);
  for (const cmd of candidates) {
    if (allSet.has(cmd)) {
      mindMapLog(`[openAgentById] will use command: ${cmd}`);
      _openByIdCmd = cmd;
      return cmd;
    }
  }
  mindMapLog(
    `[openAgentById] none of ${candidates.join(", ")} found. Available agent-related: ` +
      all
        .filter((c) => AGENT_CMD_KEYWORDS.some((k) => c.toLowerCase().includes(k)))
        .join(", ")
  );
  _openByIdCmd = null;
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

async function openChosenTranscript(candidate: JumpCandidate): Promise<void> {
  if (!candidate.transcriptPath) {
    vscode.window.showErrorMessage(
      "Agent Mind Map: 无法打开对话记录（缺少 transcript 路径）。"
    );
    return;
  }
  await openTranscriptAsMarkdown(candidate.transcriptPath, {
    label: candidate.sessionLabel,
    focusTurnIndex: candidate.turnIndex,
  });
}

/**
 * Render a composer .jsonl as Markdown in the same editor column as the mind
 * map tab (map stays open behind until the user closes the markdown tab).
 */
async function openTranscriptAsMarkdown(
  transcriptPath: string,
  opts: { label?: string; focusTurnIndex?: number } = {}
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

  const events = parseJsonl(content);
  const lines: string[] = [];
  const title = opts.label ?? path.basename(transcriptPath);
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`_transcript: \`${transcriptPath}\`_`);
  lines.push("");

  let turnIdx = 0;
  let focusLine = -1;
  for (const ev of events) {
    if (ev.kind === "user_query") {
      turnIdx += 1;
      if (opts.focusTurnIndex !== undefined && turnIdx === opts.focusTurnIndex + 1) {
        focusLine = lines.length;
      }
      lines.push(`## Q${turnIdx}`);
      lines.push("");
      for (const t of ev.text.split(/\r?\n/)) {
        lines.push(`> ${t}`);
      }
      lines.push("");
    } else if (ev.kind === "assistant_summary") {
      lines.push(`### A${turnIdx}`);
      lines.push("");
      lines.push(ev.text);
      lines.push("");
    } else if (ev.kind === "tool") {
      lines.push(`- *tool:* \`${ev.label}\``);
    }
  }

  const editorColumn = transcriptViewColumn();

  const doc = await vscode.workspace.openTextDocument({
    content: lines.join("\n"),
    language: "markdown",
  });

  // Mark this doc so `onDidCloseTextDocument` can auto-reveal the map.
  transcriptDocUrisToAutoReveal.add(doc.uri.toString());

  const editor = await vscode.window.showTextDocument(doc, {
    viewColumn: editorColumn,
    preview: false,
  });
  if (focusLine >= 0) {
    const pos = new vscode.Position(focusLine, 0);
    editor.selections = [new vscode.Selection(pos, pos)];
    editor.revealRange(
      new vscode.Range(pos, pos),
      vscode.TextEditorRevealType.AtTop
    );
  }
}

/**
 * Debug helper: try every known argument shape for `glass.openAgentById`
 * against a session id chosen from the library, with a confirmation
 * between each so the user can spot which shape actually focused the
 * intended agent. Designed for the case where the default (string)
 * form fails silently.
 */
export async function tryOpenAgentShapes(sessionId: string): Promise<void> {
  const cmd = await probeOpenByIdCommand();
  if (!cmd) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: 当前 Cursor 不支持按 ID 打开 Agent。"
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
};

export async function handleNodeClicked(
  origin: NodeOrigin,
  _deps?: JumpDeps
): Promise<void> {
  if (!origin?.refs?.length) {
    mindMapLog("handleNodeClicked: empty origin, nothing to do");
    return;
  }
  mindMapLog(
    `handleNodeClicked: ${origin.refs.length} ref(s) → flattening + enriching`
  );
  const candidates = await enrichWithTurnData(flattenCandidates(origin.refs));
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
  mindMapLog(
    `handleNodeClicked: chose session=${chosen.sessionId} turnIndex=${chosen.turnIndex ?? "<branch>"} → opening markdown`
  );
  await openChosenTranscript(chosen);
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
  });
}
