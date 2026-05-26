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
import { getWorkspaceSlug, slugToWorkspacePath } from "./paths";
import {
  loadAgentProjects,
  loadComposerHeaders,
} from "./transcript/composerTitles";
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
    placeHolder: "选择要跳转到的 Agent 会话 / 问题",
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
      MindMapPanel.log(`[openAgentById] will use command: ${cmd}`);
      _openByIdCmd = cmd;
      return cmd;
    }
  }
  MindMapPanel.log(
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
    MindMapPanel.log(
      `[openAgentById] ${cmd} ${shapeLabel} → ${JSON.stringify(ret) ?? "undefined"}`
    );
    return ret;
  } catch (err) {
    MindMapPanel.log(`[openAgentById] ${cmd} ${shapeLabel} threw: ${err}`);
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
        MindMapPanel.log(`[openAgentById] ensured agents view via ${cmd}`);
        return;
      } catch (err) {
        MindMapPanel.log(`[openAgentById] ${cmd} threw: ${err}`);
      }
    }
  }
}

/**
 * Result of attempting to open an agent by id.
 * - `opened`: command returned truthy → agent is now active
 * - `not-found`: command exists & accepted args but returned false →
 *   the composerId is unknown to Cursor (pruned / from a different
 *   agent project / never registered in glass.localAgentProjectMembership)
 * - `unsupported`: no openAgentById-style command at all
 * - `error`: command threw
 */
type OpenAgentResult = "opened" | "not-found" | "unsupported" | "error";

async function openAgentById(
  sessionId: string,
  question: string | undefined,
  candidate: JumpCandidate
): Promise<OpenAgentResult> {
  const cmd = await probeOpenByIdCommand();
  if (!cmd) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: 当前 Cursor 不支持按 ID 打开 Agent。运行「Agent Mind Map: Diagnose Jump Commands」查看可用命令。"
    );
    return "unsupported";
  }

  // glass.openAgentById takes an *agent project id*, not a composer id.
  // Each composer (one .jsonl) optionally belongs to one agent project
  // (the entity shown in Cursor's Agents UI). Composers without a
  // project membership are "orphan" — Cursor itself has no UI to switch
  // to them, so we route to the transcript-as-markdown fallback that
  // can at least show the conversation content at the right Q#.
  const { projects, membership } = await loadAgentProjects();
  const projectId = membership.get(sessionId);
  if (!projectId) {
    MindMapPanel.log(
      `[openAgentById] composer ${sessionId} has no agent-project membership → markdown fallback`
    );
    await offerFallbackAfterMiss(question, candidate);
    return "not-found";
  }
  const project = projects.get(projectId);
  MindMapPanel.log(
    `[openAgentById] composer ${sessionId} → project ${projectId} (${project?.name ?? "<unnamed>"})`
  );

  await ensureAgentsViewVisible();
  const ret = await tryOpenById(cmd, projectId, "(projectId)");
  if (ret === true) {
    await maybeJumpToTurn(candidate.turnIndex);
    return "opened";
  }
  if (ret === false) {
    MindMapPanel.log(
      `[openAgentById] glass.openAgentById(${projectId}) returned false — project exists but Cursor refused to open it. Falling back to transcript view.`
    );
    await offerFallbackAfterMiss(question, candidate);
    return "not-found";
  }
  MindMapPanel.log(
    `[openAgentById] non-boolean return value, assuming success.`
  );
  await maybeJumpToTurn(candidate.turnIndex);
  return "opened";
}

/**
 * Walk Glass's in-composer "jump to user message" navigation to the
 * approximate position of `turnIndex`. Best-effort: silent on errors,
 * stops if the command isn't registered.
 */
async function maybeJumpToTurn(turnIndex: number | undefined): Promise<void> {
  if (turnIndex === undefined || turnIndex <= 0) return;
  const all = new Set(await vscode.commands.getCommands(true));
  if (!all.has("glass.jumpToNextUserMessage")) return;
  try {
    // jump from "start" to Q#turnIndex (1-based on UI but 0-based on
    // our turnIndex, so Q1 is turnIndex=0 → 0 jumps; Q2 → 1 jump).
    for (let i = 0; i < turnIndex; i++) {
      await vscode.commands.executeCommand("glass.jumpToNextUserMessage");
    }
    MindMapPanel.log(
      `[openAgentById] navigated ${turnIndex} step(s) via glass.jumpToNextUserMessage`
    );
  } catch (err) {
    MindMapPanel.log(`[openAgentById] jumpToNextUserMessage threw: ${err}`);
  }
}

/**
 * The composer isn't a member of any Glass agent project, so Cursor
 * cannot focus it via `glass.openAgentById`. We've found empirically
 * that NO public extension command will open / recreate it either —
 * Glass blocks all `glass.new*` and `workbench.action.chat.open` calls
 * from extension contexts.
 *
 * The actually-useful fallback: render the composer's `.jsonl` as a
 * readable markdown document. The user wanted to revisit the
 * conversation; we just give them the conversation directly.
 *
 * If we don't have a transcript path (drained pending jump from a
 * previous workspace) we still copy the question to clipboard and
 * tell them to Cmd+N + paste.
 */
async function offerFallbackAfterMiss(
  question: string | undefined,
  candidate?: { transcriptPath?: string; sessionLabel?: string; turnIndex?: number }
): Promise<void> {
  // Question is already on the clipboard at this point (set by caller).
  const transcriptPath = candidate?.transcriptPath;
  const canShowTranscript = !!transcriptPath;

  const actions: string[] = [];
  if (canShowTranscript) actions.push("查看完整对话 (Markdown)");
  if (question) actions.push("用此问题新开 Agent (Cmd+N → 粘贴)");

  const msg = canShowTranscript
    ? "Agent Mind Map: 这个对话尚未被 Cursor 注册为 Agent (无法直接切换)。但完整记录在 .jsonl 里，可以打开看。"
    : "Agent Mind Map: 这个对话尚未被 Cursor 注册为 Agent，无法直接切换。";

  const clicked = await vscode.window.showInformationMessage(msg, ...actions);
  if (!clicked) return;

  if (clicked === "查看完整对话 (Markdown)" && transcriptPath) {
    await openTranscriptAsMarkdown(transcriptPath, {
      label: candidate?.sessionLabel,
      focusTurnIndex: candidate?.turnIndex,
    });
    return;
  }
  if (clicked === "用此问题新开 Agent (Cmd+N → 粘贴)") {
    await ensureAgentsViewVisible();
    vscode.window.showInformationMessage(
      "Agent Mind Map: 问题原文已在剪贴板。按 Cmd/Ctrl+N 新开 Agent，然后粘贴。"
    );
  }
}

/**
 * Render a composer .jsonl as a readable Markdown transcript and open
 * it in a side editor. Skips low-signal noise (raw tool blobs); keeps
 * user queries and assistant summaries as the primary content.
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

  const doc = await vscode.workspace.openTextDocument({
    content: lines.join("\n"),
    language: "markdown",
  });
  const editor = await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
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
      MindMapPanel.log(`[openAgentById] user confirmed working shape: ${label}`);
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
  MindMapPanel.log("[diagnose] agent-related commands:\n" + relevant.join("\n"));
  const items = relevant.map((c) => ({ label: c }));
  await vscode.window.showQuickPick(items, {
    placeHolder: `发现 ${relevant.length} 个命令（已记录到 Mind Map 日志）`,
    canPickMany: false,
  });
}

async function focusComposer(): Promise<void> {
  try {
    await vscode.commands.executeCommand("composer.focusComposer");
  } catch (err) {
    // Non-fatal; older / non-Cursor hosts may not have this command.
    console.warn("[agent-mindmap] composer.focusComposer failed:", err);
  }
}


async function finishJumpInCurrentWindow(
  candidate: JumpCandidate
): Promise<void> {
  // Always copy the question first — orphan composers can't be opened
  // by any Cursor command, so we need the clipboard as a Cmd+N fallback.
  if (candidate.turnIndex !== undefined && candidate.question) {
    await vscode.env.clipboard.writeText(candidate.question);
  }

  const result = await openAgentById(
    candidate.sessionId,
    candidate.question,
    candidate
  );
  if (result !== "opened") {
    // openAgentById already routed to the markdown / manual fallback;
    // don't show an extra notification on top.
    return;
  }

  await focusComposer();

  if (candidate.turnIndex !== undefined) {
    const label = `Q${candidate.turnIndex + 1}`;
    vscode.window.showInformationMessage(
      `Agent Mind Map: 已切到对应 Agent，并尝试定位到 ${label}`
    );
  } else {
    vscode.window.showInformationMessage("Agent Mind Map: 已切到对应 Agent");
  }
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

  // The .jsonl file path tells us which `<slug>/agent-transcripts/`
  // directory the composer was indexed into, but that's NOT always the
  // workspace Cursor itself considers the composer's home. We trust two
  // tables from state.vscdb instead:
  //   - composer.composerHeaders : per-composer workspaceIdentifier
  //   - glass.localAgentProjects.v1 / Membership.v1 : composer → project
  //     and project → workspace mappings
  // `glass.openAgentById` actually wants a *project* id (not composerId),
  // and only succeeds when the current workspace matches the project's
  // workspace. So we route to the project's workspace when known.
  const headers = await loadComposerHeaders();
  const { projects, membership } = await loadAgentProjects();
  const composer = headers.get(chosen.sessionId);
  const projectId = membership.get(chosen.sessionId);
  const project = projectId ? projects.get(projectId) : undefined;

  if (composer) {
    MindMapPanel.log(
      `handleNodeClicked: composer header found — workspacePath=${composer.workspacePath ?? "<none>"} archived=${composer.isArchived}`
    );
  }
  if (project) {
    MindMapPanel.log(
      `handleNodeClicked: composer belongs to agent project ${projectId} "${project.name ?? ""}" in ${project.workspacePath ?? "<unknown>"}`
    );
  } else {
    MindMapPanel.log(
      `handleNodeClicked: composer ${chosen.sessionId} has no agent project membership — Cursor's Agents UI cannot focus it directly`
    );
  }

  // Prefer the agent project's workspace (the entity glass.openAgentById
  // will actually open). Fall back to composer's, then to .jsonl path.
  const targetWorkspacePath =
    project?.workspacePath ??
    composer?.workspacePath ??
    chosen.projectPath ??
    slugToWorkspacePath(chosen.projectSlug);
  if (project?.workspacePath) {
    chosen.projectPath = project.workspacePath;
  } else if (composer?.workspacePath) {
    chosen.projectPath = composer.workspacePath;
  }
  const currentWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (
    currentWorkspacePath &&
    targetWorkspacePath &&
    currentWorkspacePath === targetWorkspacePath
  ) {
    await finishJumpInCurrentWindow(chosen);
    return;
  }

  // Fallback to slug comparison when we couldn't resolve paths reliably.
  const currentSlug = getWorkspaceSlug();
  if (currentSlug === chosen.projectSlug && !composer?.workspacePath) {
    await finishJumpInCurrentWindow(chosen);
    return;
  }

  MindMapPanel.log(
    `handleNodeClicked: workspace switch needed (current=${currentWorkspacePath ?? currentSlug ?? "<none>"} → ${targetWorkspacePath ?? chosen.projectSlug})`
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
  };
  await finishJumpInCurrentWindow(candidate);
}
