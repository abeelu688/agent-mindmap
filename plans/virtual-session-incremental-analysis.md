# PR Plan: Virtual Session Incremental Analysis

## Status: Ready (all decisions confirmed)

## Context

当前 `analyzeSession` 一次 LLM 调用分析整段 transcript。session 增长（用户继续聊天）时整段重分析，项目级 concept trie 也整体重建。长 session 场景下浪费明显：

- **成本**：100 条消息的 session 加 5 条新消息 = 20x 不必要的 LLM 调用 token
- **延迟**：整段重分析阻塞用户
- **稳定性**：新内容加入后旧分析结果会变（outline 漂移、concept 重派生），下游缓存（code refs、merge snapshot）失效
- **Merge 重建**：只有一个 session 变化时仍重建整个 project 的 concept trie

## 用户的核心想法

把一段 session 划分为多个**虚拟会话**：

- 前 10 个 Q&A 已分析 -> 后续聊了新问题 -> 新问题作为新的虚拟会话
- 之前的分析结果冻结（不重分析，不更新上层 merge）
- 新虚拟会话的分析参考之前的问题/上下文

## 核心设计：虚拟 session 作为独立 record

**关键洞察**：新 segment 不挂在原 session 的 record 里，而是作为**独立的虚拟 session**（独立 record、独立 leaf）。原 session 的 record 完全不动，它的 leaf 不变，它的 merge 路径不动，**无需向上传播**。新虚拟 session 像任何新 session 一样正常进 batch merge。

| 维度                   | 方案                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| 存储                   | 独立 record，ID 形如 `<sid>#v2`、`<sid>#v3`                            |
| 原 session             | record 完全不动                                                        |
| 新虚拟 session         | 独立 record，meta.parentSessionId 指向原 session                       |
| Merge                  | 新虚拟 session 当普通新 session，正常 batch merge 接走，无特殊增量逻辑 |
| 读取全 session outline | 按 parentSessionId 聚合 `<sid>` + `<sid>#v*` 的 outlines 合并          |

## 提议的优化

### O1. Delta-based 切分，不做 topic 检测

Topic shift 检测本身需要一次 LLM 调用，抵消成本节省。改为纯 delta 切分：自上次分析以来的新消息构成新虚拟 session。LLM 在分析新虚拟 session 时自然能看到消息内容里的 topic 转换。

### O2. 压缩 context primer

不传完整原 session outline（长 session 可达 100+ topics，token 重）。只传：原 session + 已有虚拟 session 的 topic 标题 + concept paths + 关键 code ref 摘要。大约比完整 outline 小 10x。

### O3. 基于 turn 的边界检测（非 raw event）

Transcript 经 `groupTurns()` 切成 turn 列表，每个 turn 算哈希。一个 turn = 一个 `user_query` + 后续所有事件（assistant_summary、tool_call、tool_result、system 等）直到下一个 `user_query`。非用户事件自动归到前一个 turn，不会单独占 chunk 位置，也不会在 tool call 中间被切断。

重分析时对比 turn 哈希序列，找第一个不匹配的 turn -> 新虚拟 session 起点。正确处理编辑场景：用户编辑了第 50 个 turn，则从第 50 个 turn 开始重分析（旧虚拟 session 失效，新建一个覆盖 50-N 的虚拟 session）。

**复用现有工具**：`groupTurns()` / `splitEventsByTurns()` / `mergeSessionAnalyses()` 已在 `core/src/pipeline/stages/analyzeSessionChunked.ts` 实现（横向切分），本方案是纵向增量版本。

### O4. 独立 prompt 文件，不动现有 `promptSessionAnalysis.ts`

新虚拟 session 的 LLM 分析需要带原 session 前文上下文（context primer），输入与现有 `analyzeSession` 不同。**新建独立 prompt 文件**，不修改现有 prompt。

**先例**：`core/src/llm/promptMergeSessionAnalysis.ts` 就是这种模式--独立文件、独立版本常量（`MERGE_SESSION_ANALYSIS_PROMPT_VERSION = 11`）、独立 schema、独立 stage，完全不影响 `promptSessionAnalysis.ts`。本方案照此抄。

| 项                       | 现状                                           | 新方案                                                                                       |
| ------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Prompt 文件              | `core/src/llm/promptSessionAnalysis.ts`（v18） | **不动**                                                                                     |
| 新 Prompt 文件           | -                                              | `core/src/llm/promptAnalyzeVirtualSession.ts`，`VIRTUAL_SESSION_ANALYSIS_PROMPT_VERSION = 1` |
| LlmResponseSchema union  | 含 `"session-analysis"`                        | 新增 `"virtual-session-analysis"`                                                            |
| `parseBySchema()` switch | 含 `session-analysis` case                     | 新增 `virtual-session-analysis` case（解析逻辑相同，复用 `parseJsonFromStdout`）             |
| Pipeline stage           | `analyzeSession`                               | **不动**；新增 `analyzeVirtualSession` stage 或在 `analyzeSession` 内部分支                  |
| `PIPELINE_VERSION`       | 跟踪 session-analysis                          | **无需 bump**（新 schema 是独立分支）                                                        |

**新 prompt 签名**：

```typescript
buildVirtualSessionAnalysisPrompt(
  events: ChatEvent[],                       // 仅新虚拟 session 覆盖的 turn 区间事件
  options: SessionAnalysisPromptOptions,     // 复用（maxDomains/nodes/branches 等）
  contextPrimer: {                           // 新增：压缩的前文上下文（O2）
    priorTopics: { title: string; conceptPath?: string }[];
    priorCodeRefs: { file: string; line: number; summary: string }[];
    originalSessionLabel: string;
  },
  hostId?: AgentHostId,
  projectPath?: string,
  outputLanguage?: string
): string
```

**输出 schema**：与现有 `session-analysis` 完全一致（outline + concepts + codeRefs），产出可直接构造 `SessionRecord`。

**Prompt 文本要点**：

1. 说明这是已有 session 的延续分析（"This is a continuation of an existing session. Analyze only the new turns below."）
2. 注入 context primer 作为前文背景
3. 鼓励 concept 连续性（"Reuse concept paths from prior sessions where the same concept appears."）
4. 不重分析已冻结的前文 turn

## 数据模型

```typescript
// SessionRecord 不变（仍是 v1），但 meta 增加可选字段
type SessionRecordMeta = {
  // ...existing fields...
  parentSessionId?: string; // 虚拟 session 指向原 session；原 session 无此字段
  virtualSessionIndex?: number; // 虚拟 session 序号（1, 2, 3...）；原 session 无此字段
  startTurnIndex?: number; // 虚拟 session 覆盖的 turn 起始（inclusive）
  endTurnIndex?: number; // 虚拟 session 覆盖的 turn 结束（exclusive）
  turnHashes?: string[]; // 该虚拟 session 涵盖的 turn 哈希（delta 检测用）
};
```

**无需 schema version bump**：新字段都是可选的，旧 record（无 parentSessionId）自然视为"原 session"。

## 分析流程

1. 读取原 session record（如有）+ 所有虚拟 session（`<sid>#v*`）
2. 对当前 transcript 调 `groupTurns()` 得到 turn 列表，每个 turn 算哈希
3. 对比已知虚拟 session 的 `turnHashes`，找第一个不匹配的 turn
4. 从该 turn 起的所有消息构成"待分析区间"
5. 构造 context primer：原 session + 已有虚拟 session 的 topic 标题 + concept paths
6. LLM 分析待分析区间，产出新虚拟 session 的 outline/concepts/codeRefs
7. 写入新 record，ID = `<sid>#v<N+1>`，meta.parentSessionId = `<sid>`
8. 触发正常 batch merge（新虚拟 session 当普通新 session 处理）

## 读取视图

读取 `<sid>` 的完整 outline 时：

1. 查询 `<sid>` + 所有 `<sid>#v*` 的 records
2. 按 `virtualSessionIndex` 排序
3. 合并 outlines（复用 `mergeSessionAnalyses()`）
4. Code refs 去重（同 file:line 取首次出现的虚拟 session）
5. Concept paths 跨虚拟 session 复用

## 关键决策

### D1. 切分策略

| 选项                | 说明                                     | 评价                          |
| ------------------- | ---------------------------------------- | ----------------------------- |
| A. Delta-based      | 自上次分析以来的新消息构成新虚拟 session | 简单可预测，无额外 LLM 成本   |
| B. Topic-shift 检测 | LLM 检测 topic 边界                      | 智能，但额外 LLM 调用抵消节省 |
| C. Time-gap         | 空闲 >1h 切分                            | 启发式，无 LLM 成本，但不准   |
| D. Hybrid           | time-gap + delta                         | 平衡                          |

**决议**：A（delta-based，turn 单位）。理由：用户的核心目标是成本节省，topic 检测的 LLM 调用反而增加成本。Delta 切分让 LLM 在新虚拟 session 的分析中自然看到 topic 转换。

**实现细节**：chunk 单位是 turn（不是 raw event），复用 `groupTurns()`。一个 turn = 一个 `user_query` + 后续所有事件（assistant_summary、tool_call、tool_result、system 等）直到下一个 `user_query`。非用户事件自动归到前一个 turn，不会单独占 chunk 位置，也不会在 tool call 中间被切断。虚拟 session 边界总在 turn 边界（`user_query` 处）。

### D2. 存储模型

| 选项                                | 说明                           | 评价                                       |
| ----------------------------------- | ------------------------------ | ------------------------------------------ |
| A. SessionRecord 内 segments 数组   | 一个 record 含多 segment       | schema 改动小，但改原 record -> 需向上传播 |
| B. 子 ID 独立 record（`<sid>#v2`）  | 每个虚拟 session 是独立 record | per-segment 清晰，原 session 不动          |
| C. 保持 flat（单 record，内部增量） | 一个 record，内部缓存增量结果  | 最小改动，但冻结语义不清晰                 |

**决议**：B（子 ID 独立 record）。理由：原 session record 完全不动是"无需向上传播"的关键前提。原 session 的 leaf 和 merge 路径保持冻结。新虚拟 session 作为独立 record 自然进入 batch merge，无需特殊增量逻辑。schema 不变（仅加可选 meta 字段），向后兼容。

### D3. 何时重分析已有虚拟 session

| 选项                               | 说明                                 | 评价                            |
| ---------------------------------- | ------------------------------------ | ------------------------------- |
| A. 永不（冻结，仅 `--force` 修复） | 一旦分析就固定                       | 简单，但 LLM 偶发错误无法自动修 |
| B. pipeline 版本 bump 时全重分析   | 升级 prompt 时重分析所有虚拟 session | 保证一致性，但升级成本高        |
| C. 仅 concept ontology 变化时      | concept 体系变化触发                 | 粒度细，但检测复杂              |

**决议**：A + B 组合（默认冻结，pipeline 版本 bump 时全虚拟 session 重分析）。理由：默认冻结保证稳定性；pipeline 版本 bump 是已知会改变分析结果的场景，必须重分析。

### D4. Project merge 更新策略

| 选项                                       | 说明                          | 评价           |
| ------------------------------------------ | ----------------------------- | -------------- |
| A. 增量（移除旧 contribution，加新）       | 仅该 session 的 leaf 重 merge | 需特殊增量逻辑 |
| B. 重建整个 project（当前行为）            | 所有 session 重新合并         | 简单但浪费     |
| C. 无特殊逻辑（虚拟 session 当新 session） | 正常 batch merge 接走         | 最简单         |

**决议**：C（无特殊逻辑）。理由：D2 选 B 后，新虚拟 session 是独立 record，对 batch merge 来说就是"加了个新 session"。原 session 的 leaf 不动，新虚拟 session 自然进入下一个 L1 batch。无需为虚拟 session 写专门的增量 merge 代码。

### D5. 虚拟 session 数量上限

| 选项                                    | 说明                  | 评价                        |
| --------------------------------------- | --------------------- | --------------------------- |
| A. 上限 5，超过合并最老两个虚拟 session | 自动控制增长          | 引入合并 LLM 调用，抵消节省 |
| B. 无上限                               | 虚拟 session 自由增长 | 简单，无额外逻辑            |
| C. 可配置（默认 5）                     | 用户可调              | 灵活但默认值意义不大        |

**决议**：B（无上限）。理由（基于代码核实）：

- **Batch merge 成本不随 session 数 N² 增长**：`DEFAULT_SNAPSHOT_GROUP_SIZE = 5` 固定，每次 merge 调用最多处理 5 个 session；snapshot 树深度按 log₅(N) 增长，14→30 sessions 只是多几个 L1 leaf，可能多一层 L2。
- **Batch merge 有 cache short-circuit**（`tryReuseBatchMergeFn`）：sessionIds + transcriptShas + model 不变时直接跳过 LLM 调用。
- **`refreshSnapshotsForFreshSessions` 是增量路径**：只重建包含变更 session 的 leaf，不重建整个 project。
- **SQLite 查询走索引**：`sessions` 表 `PRIMARY KEY (project_slug, session_id)`，`listRecordsForProject` 是 `WHERE project_slug = ?` 索引扫描，不是全表扫描。
- **`list_project_sessions` MCP 工具分页**：`limit` + `offset`，30 vs 14 sessions 查询成本相同（单次索引查询 + 内存排序切片）。
- **读取视图合并是纯函数**：`mergeSessionAnalyses()` 不调 LLM，K 个虚拟 session 合并是毫秒级。
- **Concept trie 构建是确定性遍历**：一次 O(N) 扫描，无 LLM 调用。

**存储考量**：虚拟 session 存的是提取后的信息（outline/concepts/codeRefs），单 record 几 KB 量级。1000 个虚拟 session ≈ 几 MB，可忽略。

**未来优化方向（不在本 PR 范围）**：若真出现存储压力，应该做**项目级存储上限**（如 `project.maxStorageMb`），而不是单 session 虚拟 session 数量上限——虚拟 session 数量与存储大小非线性对应（长 session 20 个虚拟 session 可能只占 50KB，短 session 1 个虚拟 session 可能占 5KB）。存储优化属于独立 future work。

## 实施阶段

### Phase 1: 虚拟 session 存储与识别

- `SessionRecord.meta` 增加可选字段 `parentSessionId` / `virtualSessionIndex` / `startTurnIndex` / `endTurnIndex` / `turnHashes`
- 实现 `listVirtualSessions(parentSessionId)`：查找 `<sid>#v*` records
- 实现 `computeTurnHashes(events)`：基于 `groupTurns()` 输出算每 turn 哈希
- 修改 `list_project_sessions` MCP 工具：默认不返回虚拟 session（加 `includeVirtual` 选项）

### Phase 2: Delta 检测 + 增量分析

- `analyzeSession` 检测原 session + 虚拟 session 的 turnHashes
- 找第一个不匹配的 turn -> 新虚拟 session 起点
- 新建 `core/src/llm/promptAnalyzeVirtualSession.ts`（独立 prompt 文件，不动 `promptSessionAnalysis.ts`）
- `LlmResponseSchema` union 新增 `"virtual-session-analysis"`，`parseBySchema()` 新增 case
- LLM prompt 注入 context primer（原 session + 已有虚拟 session 的 topic 标题 + concept paths + code ref 摘要）
- 新虚拟 session 写入独立 record `<sid>#v<N+1>`
- 触发正常 batch merge（无特殊逻辑）

### Phase 3: 读取视图合并

- `readRecord(<sid>)` 增加合并模式：返回 `<sid>` + 所有 `<sid>#v*` 的合并 outline
- 复用 `mergeSessionAnalyses()` 合并 outlines
- Code refs 跨虚拟 session 去重
- Concept paths 跨虚拟 session 复用

## 测试策略

- **Unit**：turn 哈希计算、delta 检测、虚拟 session ID 生成、outline 合并、`buildVirtualSessionAnalysisPrompt` 输出（验证 context primer 注入正确）
- **Integration**：增长中的 session 重分析，验证只有新虚拟 session 触发 LLM，且新 prompt 文件被调用（而非 `promptSessionAnalysis.ts`）
- **E2E**：长 session 多次 topic 转换，验证成本节省（LLM 调用次数 / token 数）
- **回归**：现有 730 vitest + 85 CLI 测试全过（现有 `analyzeSession` prompt 行为不变）
- **MCP 兼容**：`list_project_sessions` 默认不返回虚拟 session，`get_session_outline` 自动合并虚拟 session

## 风险

- **Context primer 质量**：压缩太多 -> 新虚拟 session 缺上下文 -> concept 碎片化
- **编辑级联**：编辑早期消息 -> 覆盖该 turn 之后的所有虚拟 session 失效，需重分析（成本可能比整段还高）
- **Concept 碎片化**：同一 concept 在不同虚拟 session 拿到不同 path -> 跨虚拟 session merge 困难
- **Session 列表膨胀**：虚拟 session 不过滤会污染 list；需默认隐藏 + 提供展开选项（D5 选 B 后无数量上限，但 `list_project_sessions` 默认过滤即可，不增加性能压力）
- **ID 格式兼容**：`<sid>#v2` 含 `#`，需确保所有路径解析、SQLite 查询、文件名都能处理

## 不在范围

- Topic shift 自动检测（D1 选 A 时不需要）
- 跨 session 的虚拟会话（仅 session 内切分）
- 实时流式分析（仍批量触发）
- 修改原 session 的 leaf（D2 选 B 后原 session 永远不动）
- 虚拟 session 数量上限 / 自动合并（D5 选 B，无上限；若未来有存储压力，做项目级存储上限作为独立 future work）
