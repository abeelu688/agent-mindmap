import type { AgentHostId } from "../host/types";
import type { PromptLanguage } from "./promptLanguage";
import {
  buildReattachDataTables,
  buildReattachHintTables,
  formatInputSchema,
} from "./promptReattachTabular";
import type { MergeInputMode, TrieReparentInput } from "./trieReparentInput";

const HOST_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

export const REATTACH_PROMPT_VERSION = 23;

export type ReattachPromptChunkMeta = {
  chunkIndex: number;
  chunkCount: number;
};

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

  const hintTables = buildReattachHintTables(input);
  const hintsBlock = hintTables.length
    ? ["", "## ontology / 结构线索", "", hintTables].join("\n")
    : "";

  const chunkBlock =
    chunkMeta && chunkMeta.chunkCount > 1
      ? [
          "",
          "## 分治合并（本批为子任务）",
          "",
          `- 完整导图过大，已拆成 ${chunkMeta.chunkCount} 批；当前为第 ${chunkMeta.chunkIndex + 1} 批。`,
          "- 仅处理本批 `chainMeta` / `treeEdges` 中的链；已稳定/其它批次的链不在本批输入中，但 `nodeCatalog` 仍含本批可见的全部节点 id。",
          "- 新链须并入本批 nodeCatalog 中已有节点 id（含稳定顶根）。",
        ].join("\n")
      : "";

  const frozenLabels =
    input.frozenChainIndices?.length
      ? input.frozenChainIndices
          .map((i) => input.chains[i]?.from)
          .filter(Boolean)
      : [];
  const frozenTopRoots =
    mergeMode === "delta" && input.frozenChainIndices?.length
      ? input.frozenChainIndices
          .map((i) => {
            const c = input.chains[i];
            const numbered = input.nodeCatalog.numberedChains.find(
              (nc) => nc.chainIndex === c?.chainIndex
            );
            if (!numbered) {
              return c?.from;
            }
            return `${numbered.rootNodeId} (${numbered.from})`;
          })
          .filter(Boolean)
      : [];
  const deltaBlock =
    mergeMode === "delta" && input.frozenChainCount
      ? [
          "",
          "## 增量合并（delta）",
          "",
          `- 以下 chainMeta 行来自**已稳定项目导图**（虚拟会话 ${input.snapshotSessionId ?? "snapshot"}），其结构视为已生效，**不要**对它们输出 Step A/B：${frozenLabels.length ? frozenLabels.join("、") : `共 ${input.frozenChainCount} 条`}。`,
          `- **已稳定顶根 hub（仅此列表可作 merge/attach 的目标顶根）**：${frozenTopRoots.length ? frozenTopRoots.join("、") : "见 nodeCatalog isTopRoot=1 且 chain 来自 snapshot 的行"}。`,
          "- 仅对**新会话**引入的并列顶级链：在 Step A 做链内折叠，在 Step B 用 `merge_synonym` / `attach_under` 把它们并入**上述 frozen 顶根 id**（禁止仅用 segment 名）。",
          "- **`attach_under` 的 `targetNodeIds[0]` 必须是 frozen 顶根 id**；禁止以新 batch 顶根（editable chain 的 rootNodeId）作 hub — 那会发明与 snapshot 平行的顶层。",
          "- 新 batch 顶根之间可先 `merge`，再 `attach` 到 frozen 顶根；禁止新建 generic hub（如单独的 `android`）收纳本应挂到 `androidplatform` 等 frozen 顶的链。",
          "- **新批顶根**若与 frozen nodeCatalog 节点 domain/evidence 同义或下位，**必须**输出 change；禁止因「已稳定链」而返回空 changes。",
          '- 若无新链需调整则 `{"changes":[]}`。',
        ].join("\n")
      : "";

  const deltaOutputBlock =
    mergeMode === "delta" && input.frozenChainCount
      ? [
          "",
          "## 输出（严格 JSON，仅 changes）",
          "",
          "只写**本批相对 snapshot 有变化**的结构调整（不要重复已稳定部分）。用 **segment key**（与 chainMeta.from / nodeCatalog.segment 一致），**不要**写 N 编号或 steps/moves。",
          "",
          "### attach — `hub->node`",
          "含义：专精顶根 **node** 挂到 **hub** 下，**node 顶根去除**。",
          '{"kind":"attach","hub":"androidplatform","node":"aosp"}',
          "",
          "### merge — remove 并进 keep",
          "含义：**remove** 与 **keep** 同义合并，remove 的子节点归 keep，**remove 顶根去除**。",
          '{"kind":"merge","keep":"androidlogging","remove":"debugging"}',
          "",
          '{"changes":[',
          '{"kind":"attach","hub":"androidplatform","node":"aosp","note":"AOSP 源码检索挂到 Android Platform 下"},',
          '{"kind":"merge","keep":"androidlogging","remove":"debugging","note":"debugging 与 android-logging 同义"}',
          "]}",
          "",
          '- 无变化则 `{"changes":[]}`。**禁止**输出 `steps` / `moves`。',
        ].join("\n")
      : "";

  const dataTables = buildReattachDataTables(input);

  if (mergeMode === "delta" && input.frozenChainCount) {
    return [
      `你是「思维导图树归并」助手。下面是 ${agentLabel} 多会话合并后的**草稿思维导图**（含已稳定 snapshot + 本批新会话）。`,
      `共 ${chainCount} 条并列顶级链。`,
      "",
      "## 任务",
      "",
      "比较 **已稳定顶根** 与 **本批新顶根**，只输出需要执行的 **changes**（挂接或同义合并）。",
      "读 `nodeCatalog`、`chainMeta`、`conceptContexts` 判断 domain/evidence；输出用 **segment key**，不用节点 id。",
      deltaBlock,
      chunkBlock,
      "",
      formatInputSchema(),
      hintsBlock,
      deltaOutputBlock,
      "",
      "## 输入数据（TAB 表，列名见 schema）",
      "",
      dataTables,
    ].join("\n");
  }

  const dataTablesFull = dataTables;

  return [
    `你是「思维导图树归并」助手。下面是 ${agentLabel} 多会话合并后的**整幅草稿思维导图**。`,
    `导图共 ${nodeCount} 个**已编号节点**（id 为 N1…N${nodeCount}），${chainCount} 条并列顶级链。`,
    "",
    "## 节点编号（必须遵守）",
    "",
    "- 每个概念段在 `nodeCatalog` 表有唯一 `id`（N1、N2…）；`path` 为从导图根到该节点的段 key（`/` 分隔）。",
    "- `treeEdges` 表描述带 id 的子树父子关系；**所有 steps 必须用节点 id 引用**，禁止仅用 segment 名（易歧义）。",
    "- `isTopRoot=1` 的节点才可作 `merge_synonym` / `attach_under` 的 `sourceNodeId`（移动整条顶级链）。",
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
    "输出折叠步骤（避免「顶根 → 同义子段」连续两层）。**conceptContexts.childKeys 已含从该会话大纲叶子 conceptPath 推断的直接下级**，须与 parentKeys、evidence 一并参考。",
    "同义判断须有 evidence，禁止跨 domain 乱并。",
    "",
    "### Step B — 跨根：顶根同义或挂靠",
    "在假定 Step A 的 steps 已生效后，遍历各并列顶根：与其他树上的节点",
    "同义 → `merge_synonym`；专精/下位 → `attach_under`。必须使用 `conceptContexts` 中的 domainKeys、parentKeys、childKeys（含大纲推断下级）、evidence。",
    "",
    "1) 读完全部输入 schema 定义的表（`nodeCatalog`、`chainMeta`、`treeEdges`、`conceptContexts` 等）。",
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
    "",
    formatInputSchema(),
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
    '- 无调整则 `{"steps":[]}`。',
    "",
    "## 输入数据（TAB 表，列名见 schema）",
    "",
    dataTablesFull,
  ].join("\n");
}
