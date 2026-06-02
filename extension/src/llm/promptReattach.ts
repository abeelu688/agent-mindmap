import type { AgentHostId } from "../host/types";
import type { PromptLanguage } from "./promptLanguage";
import type { ConceptContextForMerge } from "../store/storeTypes";
import type { MergeInputMode, TrieReparentInput } from "./trieReparentInput";

const HOST_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

export const REATTACH_PROMPT_VERSION = 20;

export type ReattachPromptChunkMeta = {
  chunkIndex: number;
  chunkCount: number;
};

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Single LLM call: numbered draft map → ordered `steps[]` referencing node ids (N1…).
 */
export function buildReattachPrompt(
  input: TrieReparentInput,
  hostId: AgentHostId = "cursor",
  _promptLanguage?: PromptLanguage,
  mergeMode: MergeInputMode = input.mergeMode ?? "full",
  chunkMeta?: ReattachPromptChunkMeta
): string {
  const agentLabel = HOST_LABELS[hostId];
  const catalog = input.nodeCatalog;
  const chainCount = catalog.numberedChains.length;
  const nodeCount = catalog.nodes.length;

  const hintParts: string[] = [];
  if (input.topBranchSynonymHints.length) {
    hintParts.push(
      "### 并列顶级链同义线索（segmentEquivalences，须结合语境验证）",
      compactJson(input.topBranchSynonymHints)
    );
  }
  if (input.rootChildSynonymHints.length) {
    hintParts.push(
      "### 链根与其直接子段同义线索（须结合语境验证）",
      compactJson(input.rootChildSynonymHints)
    );
  }
  const sh = input.structuralHints;
  if (sh.duplicateTopRoots.length) {
    hintParts.push(
      "### 并列顶根重复（某链 childSegments 已含另一顶根）",
      "→ 用 `merge_synonym`：`sourceNodeId` = duplicateTopNodeId，`targetNodeId` = parentNodeId。",
      compactJson(sh.duplicateTopRoots)
    );
  }
  if (sh.listedChildCollapses.length) {
    hintParts.push(
      "### 链内根/子段同义（segmentEquivalences 已支持折叠）",
      "→ 勿保留「链根 → 同义子段」连续两层；并列顶根用 merge_synonym（按节点 id）。",
      compactJson(sh.listedChildCollapses)
    );
  }
  if (sh.ontologySubordinates.length) {
    hintParts.push(
      "### ontology 下位关系（parentKeys）",
      "→ `attach_under`：`sourceNodeId` = specialistNodeId，`targetNodeIds` = [hubNodeId, specialistNodeId]。",
      compactJson(sh.ontologySubordinates)
    );
  }
  if (sh.prefixSubordinates.length) {
    hintParts.push(
      "### segment key 前缀下位（专精顶根 extends hub key）",
      "→ `attach_under`：`sourceNodeId` = specialistNodeId，`targetNodeIds` = [hubNodeId, specialistNodeId]。",
      "例：android-app、android-framework 与 android 并列时，须挂到 android 下，禁止保留为并列顶根。",
      compactJson(sh.prefixSubordinates)
    );
  }
  const hintsBlock = hintParts.length
    ? ["", "## ontology / 结构线索", "", ...hintParts].join("\n")
    : "";

  const chunkBlock =
    chunkMeta && chunkMeta.chunkCount > 1
      ? [
          "",
          "## 分治合并（本批为子任务）",
          "",
          `- 完整导图过大，已拆成 ${chunkMeta.chunkCount} 批；当前为第 ${chunkMeta.chunkIndex + 1} 批。`,
          "- 仅处理本批 `numberedChains` 中的链；已稳定/其它批次的链不在本批输入中，但 nodeCatalog 仍含本批可见的全部节点 id。",
          "- 新链须并入本批 nodeCatalog 中已有节点 id（含稳定顶根）。",
        ].join("\n")
      : "";

  const frozenLabels =
    input.frozenChainIndices?.length
      ? input.frozenChainIndices
          .map((i) => input.chains[i]?.from)
          .filter(Boolean)
      : [];
  const deltaBlock =
    mergeMode === "delta" && input.frozenChainCount
      ? [
          "",
          "## 增量合并（delta）",
          "",
          `- 以下 numberedChains 来自**已稳定项目导图**（虚拟会话 ${input.snapshotSessionId ?? "snapshot"}），其结构视为已生效，**不要**对它们输出 Step A/B：${frozenLabels.length ? frozenLabels.join("、") : `共 ${input.frozenChainCount} 条`}。`,
      "- 仅对**新会话**引入的并列顶级链：在 Step A 做链内折叠，在 Step B 用 `merge_synonym` / `attach_under` 把它们并入已有节点 id（禁止仅用 segment 名）。",
      "- **新批顶根**若与已稳定 nodeCatalog 中某节点 domain/evidence 同义或下位，**必须**输出 merge/attach steps；禁止因「已稳定链」而返回空 steps。",
      "- 若无新链需调整则 `{\"steps\":[]}`。",
        ].join("\n")
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
    "## Working order（必须按序完成）",
    "",
    "### Step A — 链内：父子同义折叠",
    "遍历 `nodeCatalog` 中每个节点：若该节点与其**直接上级**在 `conceptContexts` 的 domain/parent/child/evidence 语境下同义，",
    "输出折叠步骤（避免「顶根 → 同义子段」连续两层）。**childKeys 已含 Part I outline conceptPath 补齐的下级**，须与 parentKeys、evidence 一并参考。",
    "同义判断须有 evidence，禁止跨 domain 乱并。",
    "",
    "### Step B — 跨根：顶根同义或挂靠",
    "在假定 Step A 的 steps 已生效后，遍历各并列顶根：与其他树上的节点",
    "同义 → `merge_synonym`；专精/下位 → `attach_under`。必须使用 `conceptContexts` 中的 domainKeys、parentKeys、childKeys（含 outline 补齐）、evidence。",
    "",
    "1) 读完全部 `nodeCatalog`、`numberedChains`、`conceptContexts`。",
    "2) 先完成 Step A 的 steps，再完成 Step B（step 从 1 递增；执行 step n 时假定 1…n-1 已生效）。",
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
    deltaBlock,
    chunkBlock,
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
    compactJson(catalog.nodes),
    "",
    "## 输入 numberedChains（带 id 的并列链与子树）",
    compactJson(catalog.numberedChains),
    "",
    "## 输入 segmentEquivalences（各会话 S1，供 Step A/B 参考）",
    compactJson(input.segmentEquivalences.slice(0, 24)),
    "",
    "## 输入 conceptContexts（Part I 概念语境：domain / 上级 / 下级 / evidence）",
    compactJson(formatConceptContexts(input.conceptContexts)),
    "",
    "## 输入 ontology nodes",
    compactJson(input.nodes.slice(0, 48)),
  ].join("\n");
}

function formatConceptContexts(
  contexts: ConceptContextForMerge[]
): unknown[] {
  return contexts.slice(0, 120).map((c) => ({
    key: c.key,
    label: c.label,
    domainKeys: c.domainKeys,
    parentKeys: c.parentKeys,
    childKeys: c.childKeys,
    evidence: c.evidence.slice(0, 4),
    sessionId: c.sessionId,
  }));
}
