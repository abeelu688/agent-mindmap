import type { AgentHostId } from "../host/types";
import type { ChatEvent } from "../transcript/types";
import type { SessionTreeSnapshot } from "./types";
import { __testing as promptTesting } from "./prompt";

const HOST_CHAT_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

/** Bump when {@link buildOrganizeByTreePrompt} JSON schema changes. */
export const ORGANIZE_PROMPT_VERSION = 1;

export type OrganizeByTreePromptOptions = {
  maxBranches: number;
  maxDetailsPerNode: number;
};

const { groupTurns, renderTurns } = promptTesting;

export function buildOrganizeByTreePrompt(
  events: ChatEvent[],
  tree: SessionTreeSnapshot,
  options: OrganizeByTreePromptOptions,
  hostId: AgentHostId = "cursor"
): string {
  const chatLabel = HOST_CHAT_LABELS[hostId];
  const turns = groupTurns(events);
  const body = renderTurns(turns);
  const maxBranches = Math.max(1, options.maxBranches);
  const maxDetails = Math.max(1, options.maxDetailsPerNode);

  const pathHints = tree.topicPathDecisions
    .slice(0, 40)
    .map((tp) => ({
      conceptPath: tp.conceptPath,
      evidence: tp.evidence?.slice(0, 4),
    }));

  return [
    `你是会话大纲整理助手。下面是 ${chatLabel} 聊天记录与已确定的**概念分级树**。`,
    "请依托该树，把整段对话整理为【专业名词 → 相关话题概要 → 话题细节】：",
    "- title: 5-15 字名词性短语，整段总主题",
    "- summary: ≤50 字一句话，可省",
    `- outline: 2-4 层，顶层 2-${maxBranches} 条，结构应反映概念树层级`,
    "  - 中间层：title / summary / children",
    "  - 叶子：details[]（≤40 字）+ 必填 summary（≤50 字，作为子话题概括）",
    `  - 每个叶子 1-${maxDetails} 条细节`,
    "  - 叶子必须附 conceptPath（3-5 段），与下方给定路径一致或为其子路径",
    "  - conceptPath 最后一段对应该叶子子话题",
    "- details 引用本 transcript 用户提问时附 sourceTurnIndices（0-based，[Q1]→0）",
    "",
    "给定概念树（nodes / topicPathDecisions）：",
    JSON.stringify(
      {
        nodes: tree.nodes.slice(0, 60),
        topicPaths: pathHints,
      },
      null,
      2
    ),
    "",
    "只输出严格 JSON：",
    '{"title":"...","summary":"...","outline":[{"title":"...","children":[{"title":"...","summary":"...","conceptPath":["frontend","react","hooks"],"details":[{"text":"...","sourceTurnIndices":[0]}]}]}]}',
    "",
    "===",
    body || "(空会话)",
  ].join("\n");
}
