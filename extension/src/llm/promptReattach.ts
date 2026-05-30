import type { AgentHostId } from "../host/types";
import type { PromptLanguage } from "./promptLanguage";
import type { TrieReparentInput } from "./trieReparentInput";

const HOST_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

export const REATTACH_PROMPT_VERSION = 3;

/**
 * LLM-only: decide whether top-level trie branches should attach under another chain.
 */
export function buildReattachPrompt(
  input: TrieReparentInput,
  hostId: AgentHostId = "cursor",
  _promptLanguage?: PromptLanguage
): string {
  const agentLabel = HOST_LABELS[hostId];
  const branchCount = input.topBranches.length;

  return [
    `你是「思维导图树归并」助手。下面是 ${agentLabel} 多会话合并后、**出图前**的概念树草稿。`,
    `已做过段级同义合并（segmentEquivalences）；仍有 ${branchCount} 个**顶级分支**并列。`,
    "你的任务：对每个顶级分支，**从语义上**判断它是否应成为另一条链上某节点的子树，而非继续并列挂在根下。",
    "",
    "## 核心思路（语义父子，非文本匹配）",
    "",
    "不要靠 path 段名字面相同/相似来挂载。应对每个待考察的根分支 R：",
    "1) 结合 domain、keywords、pathSamples、ontology parentKeys/evidence，理解 R 在讨论什么概念。",
    "2) 浏览其他顶级链及其子树，寻找**语义上适合作为 R 之父**的节点 P（P 不必与 R 同名）。",
    "3) 若 P 的子树主题、下游内容与 R 一致或为其自然上位，则 R 应挂到 P 下面；",
    "   toPath = 从根到 P 的 conceptPath，再接上 R 自身段（即 R 移动后的新根路径）。",
    "4) 若只能证明段级同义、找不到语义父节点，或父子关系不确定：**不要**输出 move。",
    "",
    "## 判断维度（须综合，不可单看字面）",
    "",
    "1) **domain**：R 与候选父链是否同一技术域/产品语境（看 evidence、keywords、讨论主题）。",
    "2) **上级（upstream）**：候选父节点在概念上是否涵盖、统领或包含 R。",
    "3) **下级（downstream）**：R 的 childSegments / pathSamples 是否与候选父节点下已有子树**语义重叠**。",
    "4) **结构信号**：若某链已呈现外层→内层→模块的层级，而 R 语义上属于该内层，应挂到对应深度。",
    "",
    "## 输出要求",
    "",
    "- moves[].from 必须精确匹配 topBranches[].from（段 key，小写归一）。",
    "- moves[].toPath 为 2–5 段 conceptPath，表示该分支移动后的**新根路径**（末段为 R 自身）。",
    "- moves[].evidence 须写**语义理由**（为何该链上节点是 R 的父），勿写「段名相同」。",
    "- confidence 0–1；不确定则不要输出，或给低 confidence（<0.55 将被丢弃）。",
    "- 每个 from 最多一条 move；无合适父节点则 moves 可为空数组。",
    "",
    "只输出严格 JSON：",
    '{"moves":[{"from":"subsystem","toPath":["platform-wrapper","subsystem"],"confidence":0.85,"evidence":["wrapper chain covers same runtime domain","subsystem children match nested topics"]}]}',
    "",
    "输入 topBranches：",
    JSON.stringify(input.topBranches, null, 2),
    "",
    "输入 segmentEquivalences（参考，勿仅凭同义段做挂载）：",
    JSON.stringify(input.segmentEquivalences.slice(0, 24), null, 2),
    "",
    "输入 ontology nodes：",
    JSON.stringify(input.nodes.slice(0, 48), null, 2),
  ].join("\n");
}
