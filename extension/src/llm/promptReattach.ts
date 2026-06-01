import type { AgentHostId } from "../host/types";
import type { PromptLanguage } from "./promptLanguage";
import type { TrieReparentInput } from "./trieReparentInput";

const HOST_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

export const REATTACH_PROMPT_VERSION = 16;

/**
 * Single LLM call: numbered draft map → ordered `steps[]` referencing node ids (N1…).
 */
export function buildReattachPrompt(
  input: TrieReparentInput,
  hostId: AgentHostId = "cursor",
  _promptLanguage?: PromptLanguage
): string {
  const agentLabel = HOST_LABELS[hostId];
  const catalog = input.nodeCatalog;
  const chainCount = catalog.numberedChains.length;
  const nodeCount = catalog.nodes.length;

  const hintParts: string[] = [];
  if (input.topBranchSynonymHints.length) {
    hintParts.push(
      "### 并列顶级链同义线索（segmentEquivalences，须结合语境验证）",
      JSON.stringify(input.topBranchSynonymHints, null, 2)
    );
  }
  if (input.rootChildSynonymHints.length) {
    hintParts.push(
      "### 链根与其直接子段同义线索（须结合语境验证）",
      JSON.stringify(input.rootChildSynonymHints, null, 2)
    );
  }
  const sh = input.structuralHints;
  if (sh.duplicateTopRoots.length) {
    hintParts.push(
      "### 并列顶根重复（某链 childSegments 已含另一顶根）",
      "→ 用 `merge_synonym`：`sourceNodeId` = duplicateTopNodeId，`targetNodeId` = parentNodeId。",
      JSON.stringify(sh.duplicateTopRoots, null, 2)
    );
  }
  if (sh.listedChildCollapses.length) {
    hintParts.push(
      "### 链内根/子段同义（segmentEquivalences 已支持折叠）",
      "→ 勿保留「链根 → 同义子段」连续两层；并列顶根用 merge_synonym（按节点 id）。",
      JSON.stringify(sh.listedChildCollapses, null, 2)
    );
  }
  if (sh.ontologySubordinates.length) {
    hintParts.push(
      "### ontology 下位关系（parentKeys）",
      "→ `attach_under`：`sourceNodeId` = specialistNodeId，`targetNodeIds` = [hubNodeId, specialistNodeId]。",
      JSON.stringify(sh.ontologySubordinates, null, 2)
    );
  }
  const hintsBlock = hintParts.length
    ? ["", "## ontology / 结构线索", "", ...hintParts].join("\n")
    : "";

  return [
    `你是「思维导图树归并」助手。下面是 ${agentLabel} 多会话合并后的**整幅草稿思维导图**。`,
    `导图共 ${nodeCount} 个**已编号节点**（id 为 N1…N${nodeCount}），${chainCount} 条并列顶级链。`,
    "",
    "## 节点编号（必须遵守）",
    "",
    "- 每个概念段在 `nodeCatalog[]` 有唯一 `id`（N1、N2…）；`path` 为从导图根到该节点的段 key 序列。",
    "- `numberedChains[].tree` 为带 id 的子树；**所有 steps 必须用节点 id 引用**，禁止仅用 segment 名（易歧义）。",
    "- `isTopRoot: true` 的节点才可作 `merge_synonym` / `attach_under` 的 `sourceNodeId`（移动整条顶级链）。",
    "",
    "## 重要前提",
    "",
    "- 思维导图 = 概念段父子关系；无预设行业架构。",
    "- 禁止套用示例中的 seg-a/seg-b 名字；示例只说明 **steps 字段与 id 写法**。",
    "- 同义 → `merge_synonym`；专精下位 → `attach_under`。",
    "",
    "## 你的任务",
    "",
    "1) 读完全部 `nodeCatalog` 与 `numberedChains`。",
    "2) 输出有序 `steps`（step 从 1 递增；执行 step n 时假定 1…n-1 已生效）。",
    "3) 每步写清 **action** 与 **result**（可提及节点 id）。",
    "",
    "## 步骤类型（仅用节点 id）",
    "",
    "### merge_synonym",
    "- `sourceNodeId`：将被取消并列顶根的节点 id（须 isTopRoot）。",
    "- `targetNodeId`：保留为唯一顶根的节点 id（须 isTopRoot）。",
    "- **禁止**用 `attach_under` + `targetNodeIds:[hubId, sourceId]` 表示两个**并列顶根同义**（会形成 hub→同义子层）；必须用 merge_synonym。",
    "- segmentEquivalences / topBranchSynonymHints 中已同义的顶根，只能 merge_synonym。",
    "",
    "### attach_under",
    "- `sourceNodeId`：专精/下位顶级链的根节点 id。",
    "- `targetNodeIds`：有序 id 列表，从上级 hub 的顶根 id 到 source 自身 id（**末 id 必须等于 sourceNodeId**）。",
    "- 等价于把该链挂到这些节点所表示的路径下。",
    "",
    "## 典型错误（禁止）",
    "",
    "- 仅用 segment 名、不用 nodeCatalog id。",
    "- 同义顶根未 merge_synonym 仍并列。",
    "- attach_under 的 targetNodeIds 末 id 不是 sourceNodeId。",
    hintsBlock,
    "",
    "## 输出（严格 JSON，仅 steps）",
    "",
    '{"steps":[',
    '{"step":1,"kind":"merge_synonym","sourceNodeId":"N3","targetNodeId":"N1","action":"将顶根 N3 并进 N1，N3 不再并列","result":"N3 下话题改以 N1 为顶根前缀","confidence":0.9,"evidence":["nodeCatalog 语境同义"]},',
    '{"step":2,"kind":"attach_under","sourceNodeId":"N7","targetNodeIds":["N1","N7"],"action":"将专精顶根 N7 挂在 N1 下","result":"N7 为 N1 的一级子概念","confidence":0.88,"evidence":["N7 是 N1 内部专支"]}',
    "]}",
    "",
    "- 每步必须含 `sourceNodeId`；merge 用 `targetNodeId`，attach 用 `targetNodeIds`。",
    "- 无调整则 `{\"steps\":[]}`。",
    "",
    "## 输入 nodeCatalog（全图节点索引）",
    JSON.stringify(catalog.nodes, null, 2),
    "",
    "## 输入 numberedChains（带 id 的并列链与子树）",
    JSON.stringify(catalog.numberedChains, null, 2),
    "",
    "## 输入 segmentEquivalences",
    JSON.stringify(input.segmentEquivalences.slice(0, 24), null, 2),
    "",
    "## 输入 ontology nodes",
    JSON.stringify(input.nodes.slice(0, 48), null, 2),
  ].join("\n");
}
