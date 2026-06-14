# Concept 合并量化评价（aosp14）

对 **Concept Trie 跨会话合并脑图** 做可重复的结构化指标统计，用于调试 prompt、合并与 ontology 改动效果。

## 目录

| 路径                          | 说明                                                           |
| ----------------------------- | -------------------------------------------------------------- |
| `eval.config.example.json`    | 配置模板（提交到仓库）                                         |
| `eval.config.local.json`      | 本机覆盖（gitignore，从 example 复制）                         |
| `export-aosp14-fixtures.mjs`  | 从本机 Cursor `agent-transcripts` 导出 jsonl（需 `--source=`） |
| `run-eval.ts`                 | Headless eval CLI（构建为 `extension/dist/eval-run.js`）       |
| `baselines/concept-trie.json` | 可选 baseline，用于 `--compareBaseline`                        |
| `reports/`                    | 运行报告输出（gitignore）                                      |

Fixture 数据：`../fixtures/aosp14/` 不在 git 仓库中；需本机导出后 eval（见下方）。

## 快速开始

```bash
# 1. 首次或 transcript 更新后，本地导出 fixture（可选；transcripts 已在 .gitignore）
npm run eval:fixtures:export -- --source="$HOME/.cursor/projects/<project-slug>/agent-transcripts"

# 2. 本机配置
cp test/eval/eval.config.example.json test/eval/eval.config.local.json

# 3. 跑 eval（默认读 fixture，会对每个 session 调 LLM，较慢）
npm run eval

# 4. 认可当前结果后写入 baseline
npm run eval -- --write-baseline
```

## 配置说明

`eval.config.local.json` 合并 `eval.config.example.json` 后生效。

| 字段                          | 说明                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `useFixtureTranscripts`       | `true` → `test/fixtures/aosp14/transcripts`；`false` → 实机 `~/.cursor/projects/<projectSlug>/agent-transcripts` |
| `fixtureSet`                  | fixture 子目录名，默认 `aosp14`                                                                                  |
| `projectSlug` / `projectPath` | 写入 `SessionRecord.meta`                                                                                        |
| `sessionFilter`               | `"all"` 或 session uuid 数组（冒烟子集）                                                                         |
| `llmProvider`                 | `cursor-cli` 或 `claude-cli`                                                                                     |
| `promptParams`                | `maxTopics` / `maxItemsPerTopic`                                                                                 |
| `useStoreRecords`             | `true` 时跳过 LLM，从 `~/.agent-mindmap` 读已有 `SessionRecord`（仅测合并逻辑）                                  |
| `compareBaseline`             | 与 `baselines/concept-trie.json` 做 diff 并打印                                                                  |
| `writeReport`                 | 写入 `reports/<timestamp>.json`                                                                                  |

## 指标含义

### 节点规模（`conceptMerge`）

- **`trieNodeCount`**：内部概念 Trie 节点数（含 root），反映路径压缩与分支结构。
- **`mindMapNodeCount`**：渲染后 `MindMapNodeData` 节点总数，与 Webview 可见规模接近。
- **`totalTopics` / `topicsWithPath` / `topicsWithoutPath` / `rootChildren`**：与扩展内 `ConceptMergeStats` 一致。

### 会话覆盖率（`coverage`）

- **叶子定义**：概念路径**终点**且挂载 `topics` 的 Trie 节点（`children` 为空且 `topics.length > 0`）。
- **`sessionsAtTerminalTopics`**：上述叶子上出现的去重 session 数（限于 fixture 集合）。
- **`sessionCoverageRate`**：`sessionsAtTerminalTopics / fixtureSessionCount`。
- **`sessionsInAnyTopic`**：含 orphan 分支在内的所有 topic 涉及 session 数。
- **`uncoveredSessionIds`**：未出现在任何 terminal 叶子上的 fixture session 列表。

## LLM 波动说明

仓库**只固化 jsonl**，不提交 `SessionRecord`。因此每次 `npm run eval` 会重新 summarize，指标会有随机波动。

建议用法：

1. 改代码/prompt **前后各跑一遍**，看 `baselineDelta` 或两次 report 的**相对变化**。
2. 只验证合并算法时，设 `useStoreRecords: true`（需本地已 analyze 过 aosp14 会话）。
3. LLM 结果会缓存在 `test/eval/.cache/llm-outline/`（同 prompt + transcript 可复用）。

## 单元测试

不调用 LLM 的指标逻辑在 Vitest 中覆盖：

```bash
npm run test:vitest -- test/evalMetrics.test.ts
```

## 隐私

Fixture jsonl 可能含本地路径与代码片段，默认不提交仓库；导出前请评估脱敏。
