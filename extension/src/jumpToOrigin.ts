import * as fs from "fs/promises";
import * as vscode from "vscode";
import {
  flattenCandidates,
  formatPickerLabel,
  type JumpCandidate,
  type PendingJump,
  PENDING_JUMP_KEY,
} from "./jumpToOriginCore";
import { getWorkspaceSlug, slugToWorkspacePath } from "./paths";
import { parseJsonl } from "./transcript/parseJsonl";
import type { ChatEvent, NodeOrigin } from "./transcript/types";
import { MindMapPanel } from "./webview/MindMapPanel";

export {
  flattenCandidates,
  formatPickerLabel,
  type JumpCandidate,
  type PendingJump,
  PENDING_JUMP_KEY,
};

const PENDING_JUMP_TTL_MS = 60 * 1000;

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
    return { ...c, question: ev.text, lineIndex: ev.lineIndex };
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
    placeHolder: "选择要跳转到的 Agent 会话 / 问题",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return picked?.candidate;
}

async function openAgentById(sessionId: string): Promise<void> {
  // Newer Cursor builds run in "glass" mode and prefer `glass.openAgentById`;
  // classic builds expose `composer.openComposer`. We try the newer one
  // first and fall back to the legacy one if it isn't registered. The
  // "command 'X' not found" error from vscode contains the command id, so
  // we filter on that to avoid swallowing real failures.
  const tryRun = async (cmd: string): Promise<boolean> => {
    try {
      await vscode.commands.executeCommand(cmd, sessionId);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found") || msg.includes("no handler")) {
        return false;
      }
      throw err;
    }
  };
  if (await tryRun("glass.openAgentById")) {
    return;
  }
  if (await tryRun("composer.openComposer")) {
    return;
  }
  vscode.window.showWarningMessage(
    "Agent Mind Map: 当前 Cursor 不支持按 ID 打开 Agent（缺少 glass.openAgentById / composer.openComposer 命令）。"
  );
}

async function focusComposer(): Promise<void> {
  try {
    await vscode.commands.executeCommand("composer.focusComposer");
  } catch (err) {
    // Non-fatal; older / non-Cursor hosts may not have this command.
    console.warn("[agent-mindmap] composer.focusComposer failed:", err);
  }
}

async function revealTranscriptLine(
  transcriptPath: string,
  lineIndex: number
): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(transcriptPath);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
      preserveFocus: true,
    });
    const safeLine = Math.min(Math.max(lineIndex, 0), doc.lineCount - 1);
    const pos = new vscode.Position(safeLine, 0);
    editor.selections = [new vscode.Selection(pos, pos)];
    editor.revealRange(
      new vscode.Range(pos, pos),
      vscode.TextEditorRevealType.AtTop
    );
  } catch (err) {
    console.warn(
      `[agent-mindmap] failed to reveal transcript line ${lineIndex} in ${transcriptPath}:`,
      err
    );
  }
}

async function finishJumpInCurrentWindow(
  candidate: JumpCandidate
): Promise<void> {
  await openAgentById(candidate.sessionId);
  await focusComposer();

  const parts: string[] = ["已打开 Agent"];
  if (candidate.turnIndex !== undefined && candidate.question) {
    await vscode.env.clipboard.writeText(candidate.question);
    parts.push(`Q${candidate.turnIndex + 1} 原文已复制 (粘贴即可继续)`);
  }
  if (
    candidate.turnIndex !== undefined &&
    candidate.lineIndex !== undefined &&
    candidate.transcriptPath
  ) {
    await revealTranscriptLine(candidate.transcriptPath, candidate.lineIndex);
  }
  vscode.window.showInformationMessage(`Agent Mind Map: ${parts.join(" · ")}`);
}

type WorkspaceChoice = "current" | "new-window" | "clipboard" | "cancel";

async function pickWorkspaceAction(
  candidate: JumpCandidate
): Promise<WorkspaceChoice> {
  const projectDisplay =
    candidate.projectPath ?? slugToWorkspacePath(candidate.projectSlug);
  const items: (vscode.QuickPickItem & { choice: WorkspaceChoice })[] = [
    {
      label: "新窗口打开",
      description: projectDisplay,
      detail:
        "在新窗口打开目标项目，Mind Map 扩展启动后会自动跳转到对应 Agent。",
      choice: "new-window",
    },
    {
      label: "在当前窗口打开（关闭当前 workspace）",
      description: projectDisplay,
      detail: "当前未保存的状态会被关闭。",
      choice: "current",
    },
    {
      label: "仅复制问题原文到剪贴板",
      description: "不切换 workspace，也不打开 Agent",
      detail:
        candidate.turnIndex !== undefined
          ? "用于先看完当前内容再手动切过去。"
          : "用于先看完当前内容再手动打开 Agent。",
      choice: "clipboard",
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `目标项目 (${candidate.projectSlug}) 与当前 workspace 不同，如何打开？`,
  });
  return picked?.choice ?? "cancel";
}

function buildPendingJump(candidate: JumpCandidate): PendingJump {
  return {
    expectedSlug: candidate.projectSlug,
    sessionId: candidate.sessionId,
    projectPath: candidate.projectPath,
    transcriptPath: candidate.transcriptPath,
    turnIndex: candidate.turnIndex,
    question: candidate.question,
    lineIndex: candidate.lineIndex,
    expiresAt: Date.now() + PENDING_JUMP_TTL_MS,
  };
}

async function openProjectFolder(
  candidate: JumpCandidate,
  forceNewWindow: boolean
): Promise<void> {
  const resolvedPath =
    candidate.projectPath ?? slugToWorkspacePath(candidate.projectSlug);
  if (!candidate.projectPath) {
    vscode.window.showWarningMessage(
      `Agent Mind Map: 项目路径由 slug 反推得到 (${resolvedPath})，可能不准确。`
    );
  }
  await vscode.commands.executeCommand(
    "vscode.openFolder",
    vscode.Uri.file(resolvedPath),
    { forceNewWindow }
  );
}

export type JumpDeps = {
  context: vscode.ExtensionContext;
};

export async function handleNodeClicked(
  origin: NodeOrigin,
  deps: JumpDeps
): Promise<void> {
  if (!origin?.refs?.length) {
    MindMapPanel.log("handleNodeClicked: empty origin, nothing to do");
    return;
  }
  MindMapPanel.log(
    `handleNodeClicked: ${origin.refs.length} ref(s) → flattening + enriching`
  );
  const candidates = await enrichWithTurnData(flattenCandidates(origin.refs));
  if (!candidates.length) {
    MindMapPanel.log("handleNodeClicked: no candidates after flatten");
    return;
  }
  MindMapPanel.log(
    `handleNodeClicked: ${candidates.length} candidate row(s) ready for picker`
  );
  const chosen = await pickCandidate(candidates);
  if (!chosen) {
    MindMapPanel.log("handleNodeClicked: user dismissed picker");
    return;
  }
  MindMapPanel.log(
    `handleNodeClicked: chose session=${chosen.sessionId} turnIndex=${chosen.turnIndex ?? "<branch>"}`
  );

  const currentSlug = getWorkspaceSlug();
  if (currentSlug === chosen.projectSlug) {
    await finishJumpInCurrentWindow(chosen);
    return;
  }
  MindMapPanel.log(
    `handleNodeClicked: workspace switch needed (current=${currentSlug ?? "<none>"} → ${chosen.projectSlug})`
  );

  const action = await pickWorkspaceAction(chosen);
  if (action === "cancel") {
    return;
  }
  if (action === "clipboard") {
    if (chosen.turnIndex !== undefined && chosen.question) {
      await vscode.env.clipboard.writeText(chosen.question);
      vscode.window.showInformationMessage(
        `Agent Mind Map: Q${chosen.turnIndex + 1} 原文已复制到剪贴板。`
      );
    } else {
      vscode.window.showInformationMessage(
        "Agent Mind Map: 没有可复制的问题原文。"
      );
    }
    return;
  }
  // current / new-window — persist and reload.
  const pending = buildPendingJump(chosen);
  await deps.context.globalState.update(PENDING_JUMP_KEY, pending);
  await openProjectFolder(chosen, action === "new-window");
}

/**
 * Drain a pending jump persisted by a previous `vscode.openFolder` call.
 * Called once at activation. The pending record is cleared whether or not
 * we end up running it (expired / wrong workspace).
 */
export async function drainPendingJump(
  deps: JumpDeps
): Promise<void> {
  const pending = deps.context.globalState.get<PendingJump>(PENDING_JUMP_KEY);
  if (!pending) {
    return;
  }
  await deps.context.globalState.update(PENDING_JUMP_KEY, undefined);
  if (pending.expiresAt < Date.now()) {
    return;
  }
  const currentSlug = getWorkspaceSlug();
  if (!currentSlug || currentSlug !== pending.expectedSlug) {
    return;
  }
  const candidate: JumpCandidate = {
    sessionId: pending.sessionId,
    projectSlug: pending.expectedSlug,
    projectPath: pending.projectPath,
    sessionLabel: "",
    transcriptPath: pending.transcriptPath ?? "",
    turnIndex: pending.turnIndex,
    question: pending.question,
    lineIndex: pending.lineIndex,
  };
  await finishJumpInCurrentWindow(candidate);
}
