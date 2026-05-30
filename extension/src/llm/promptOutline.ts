import type { AgentHostId } from "../host/types";
import type { ChatEvent } from "../transcript/types";
import { __testing as promptTesting } from "./prompt";

const HOST_CHAT_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

/**
 * Bump whenever {@link buildOutlinePrompt} changes the LLM JSON schema.
 *
 * @deprecated Primary session path uses {@link runSessionPipeline} +
 * {@link buildOrganizeByTreePrompt} (S4). Kept for tests and `groupTurns` helpers.
 */
export const PROMPT_VERSION = 7;

export type OutlinePromptOptions = {
  maxBranches: number;
  maxDetailsPerNode: number;
};

const { groupTurns, renderTurns } = promptTesting;

export function buildOutlinePrompt(
  events: ChatEvent[],
  options: OutlinePromptOptions,
  hostId: AgentHostId = "cursor"
): string {
  const chatLabel = HOST_CHAT_LABELS[hostId];
  const turns = groupTurns(events);
  const body = renderTurns(turns);
  const maxBranches = Math.max(1, options.maxBranches);
  const maxDetails = Math.max(1, options.maxDetailsPerNode);

  return [
    `你是会话大纲分析助手。下面是 ${chatLabel} 聊天记录（已脱敏），段标记 [Q#]/[T#]/[A#]。`,
    "请把整段对话翻译成【分级大纲 + 叶子细节】：",
    "- title: 5-15 字名词性短语，整段总主题（思维导图根，不含日期/ID）",
    "- summary: ≤50 字一句话，可省",
    `- outline: 2-4 层分级标题树，顶层 2-${maxBranches} 条分支`,
    "  - 中间层节点只有 title / summary / children，不要放 details",
    "  - 最细一层节点放 details[]（叶子细节），每条 ≤40 字",
    `  - 每个有 details 的节点 1-${maxDetails} 条细节`,
    "  - 有 details 的节点必须写 summary（≤50 字），作为跨会话 Concept Mind Map 该子话题的概括标题",
    "- 有 details 的节点另附 conceptPath: 3-5 段，从最泛领域到最细概念（小写英文/通用术语），用于跨会话 Concept Mind Map 聚类；单会话图不显示",
    "  - conceptPath 最后一段应对应本条 details 的子话题/子概念（例：useState vs useReducer → …,\"use-state\" / …,\"use-reducer\"），便于同父概念下按子概念分列",
    "  例：「React Hooks 入门」→ [\"frontend\",\"react\",\"hooks\"]；「Vite 构建优化」→ [\"frontend\",\"tooling\",\"vite\",\"build\"]；须据本对话实际领域归纳，禁止照抄与内容无关的示例路径",
    "- details 若引用【本 transcript 内】某轮用户提问，附 sourceTurnIndices（0-based，[Q1]→0、[Q2]→1）",
    "- 禁止把助理回复里提到的其他会话轮次写入 sourceTurnIndices",
    "",
    "只输出严格 JSON，不要 markdown / 解释 / ```；禁止在 JSON 前或后输出任何说明文字（含中文）：",
    '{"title":"...","summary":"...","outline":[{"title":"...","children":[{"title":"...","conceptPath":["frontend","react","hooks"],"details":[{"text":"...","sourceTurnIndices":[0]}]}]}]}',
    "",
    "===",
    body || "(空会话)",
  ].join("\n");
}

export type BatchOutlinePromptOptions = OutlinePromptOptions & {
  maxSessions: number;
};

export type SessionTranscriptBlock = {
  sessionIndex: number;
  sessionLabel: string;
  events: ChatEvent[];
};

function renderBatchTurns(blocks: SessionTranscriptBlock[]): string {
  const parts: string[] = [];
  let total = 0;
  const MAX_TOTAL_CHARS = 30000;
  for (const block of blocks) {
    const turns = groupTurns(block.events);
    const inner = renderTurns(turns)
      .split("\n\n")
      .map((line) => {
        return line
          .replace(/^\[Q(\d+)\]/, `[S${block.sessionIndex + 1}][Q$1]`)
          .replace(/^\[T(\d+)\]/, `[S${block.sessionIndex + 1}][T$1]`)
          .replace(/^\[A(\d+)\]/, `[S${block.sessionIndex + 1}][A$1]`);
      })
      .join("\n\n");
    const header = `--- [S${block.sessionIndex + 1}] ${block.sessionLabel} ---`;
    const chunk = `${header}\n${inner || "(空)"}`;
    if (total + chunk.length + 2 > MAX_TOTAL_CHARS) {
      parts.push("[...truncated due to length...]");
      break;
    }
    parts.push(chunk);
    total += chunk.length + 2;
  }
  return parts.join("\n\n");
}

/**
 * Optional multi-session batch prompt (explicit command / selection only).
 */
export function buildBatchOutlinePrompt(
  blocks: SessionTranscriptBlock[],
  options: BatchOutlinePromptOptions,
  hostId: AgentHostId = "cursor"
): string {
  const chatLabel = HOST_CHAT_LABELS[hostId];
  const capped = blocks.slice(0, Math.max(1, options.maxSessions));
  const body = renderBatchTurns(capped);
  const maxBranches = Math.max(1, options.maxBranches);
  const maxDetails = Math.max(1, options.maxDetailsPerNode);

  return [
    `你是跨会话大纲分析助手。下面是 ${capped.length} 个 ${chatLabel} 会话，段标记 [S#][Q#]/[T#]/[A#]。`,
    "请合并翻译成一张【分级大纲 + 叶子细节】：",
    "- title / summary 同上",
    `- outline: 2-4 层，顶层 3-${maxBranches} 条`,
    "  - 叶子 details[] 每条附 sources: [{ sessionIndex, turnIndex? }]",
    "  - sessionIndex 0-based，对应 [S1]→0；turnIndex 0-based，对应 [S1][Q1]→0",
    "",
    "只输出严格 JSON：",
    '{"title":"...","summary":"...","outline":[{"title":"...","children":[{"title":"...","details":[{"text":"...","sources":[{"sessionIndex":0,"turnIndex":0}]}]}]}]}',
    "",
    "===",
    body || "(空)",
  ].join("\n");
}

export const __testing = { groupTurns, renderTurns, renderBatchTurns };
