# Agent Mind Map

[![CI](https://github.com/abeelu688/agent-mindmap/actions/workflows/ci.yml/badge.svg)](https://github.com/abeelu688/agent-mindmap/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blue.svg)](https://code.visualstudio.com/)
[![English README](https://img.shields.io/badge/README-English-blue.svg)](README.md)

VS Code 扩展：读取 AI Agent 聊天记录并以**交互式思维导图**呈现。

**[English README →](README.md)**

---

![Agent Mind Map 截图](docs/screenshot.png)

> **截图占位** — 公开发布前请替换为实际截图或 GIF。

## 支持的产品

| 产品            | 对话记录位置                                                  | 无头 CLI                 |
| --------------- | ------------------------------------------------------------- | ------------------------ |
| **Cursor**      | `~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl` | `agent` / `cursor-agent` |
| **Claude Code** | `~/.claude/projects/<encoded-path>/*.jsonl`                   | `claude -p`              |

设置 `agentMindmap.host` 为 `auto`（默认）、`cursor` 或 `claude-code`。`auto` 模式下自动检测当前编辑器，找不到时扫描两个目录。

思维导图是**只读**的——不会写回聊天存储或影响 Agent 面板。

## 两种渲染模式

| 模式            | 何时使用                      | 结构                                                     |
| --------------- | ----------------------------- | -------------------------------------------------------- |
| **主题** (默认) | LLM 摘要成功                  | 根节点 (LLM 归纳主题) → `核心 N: <标题>` → 知识点 / 引用 |
| **轮次** (回退) | LLM 不可用 / 取消 / JSON 异常 | 根节点 (会话标签) → `Q1`, `Q2`, … → `调研` / `结论`      |

主题模式回答的是"这段对话讲了什么"。根节点也是 LLM 归纳的（5-15 字名词短语），不会出现 Agent UUID 或时间戳。

## LLM 集成

扩展通过子进程调用对应的**无头 CLI**——**无需单独的 API Key**，复用你现有的产品订阅。

| Host        | 命令格式                                                       |
| ----------- | -------------------------------------------------------------- |
| Cursor      | `agent -p --force --trust --output-format json <prompt>`       |
| Claude Code | `claude -p --bare --output-format json --max-turns 1 <prompt>` |

如果找不到 CLI 二进制文件，扩展会回退到时序视图并弹出安装引导。可通过 `agentMindmap.llm.cliPath` 手动指定路径。

## 库（跨会话、跨项目存储）

每次成功的 LLM 分析都会持久化为 `SessionRecord` 到项目外的目录，因此：

- 同一会话再次打开时无需调用 LLM
- 多个会话 / 项目可以合并为更大的思维导图

默认位置：`~/.agent-mindmap/`。通过 `agentMindmap.storeDir` 覆盖——指向同步文件夹（iCloud / Dropbox）即可跨机器共享。

### 概念思维导图

运行 **Analyze All Sessions (Current Project)** 时，所有主题会按 `conceptPath` 插入前缀树，渲染为统一的概念导图：

```
Concept Mind Map · <project-slug>
└── frontend (5)
    └── react (3)
        ├── hooks (2)
        │   ├── use-state (1)
        │   │   └── useState 基础 · [s2-label]
        │   └── use-reducer (1)
        │       └── useReducer 进阶 · [s1-label]
        └── router (1)
            └── React Router 配置 · [s3-label]
```

这是完全确定性的（前缀树布局不需要 LLM 调用）。路径在插入前会归一化，并通过缓存的**段等价规则**（带作用域的别名——代码中没有硬编码的领域名称）进行重写。

## 命令

| 命令                                                       | 说明                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| **Agent Mind Map: Open Latest Session**                    | 加载最近的对话记录并显示单会话思维导图                      |
| **Agent Mind Map: Choose Session…**                        | 按标题 + 时间选择对话记录                                   |
| **Agent Mind Map: Analyze All Sessions (Current Project)** | 扫描所有对话记录、逐一 LLM 分析、构建并打开**概念思维导图** |

调用 LLM 的命令会显示**可取消的进度通知**，附带逐步状态文字。

## 点击节点打开对话

思维导图中的每个节点都可以点击。扩展会追溯节点到其来源的会话和轮次，然后在编辑器中打开可读的 Markdown 对话记录。点击特定轮次的节点时，会自动滚动到对应的标题位置。

## 离线导出

右键空白画布 → **下载思维导图与对话…**。导出内容包括：

- 自包含的 `index.html` 思维导图
- 预渲染的 `transcripts/*.html`（以及 `*.md` 供编辑器使用）

无需本地 HTTP 服务器——双击 `index.html` 即可在浏览器中打开。点击节点可跳转到对应的对话锚点。

## 设置

### Host / 对话记录

| 设置                             | 默认值 | 说明                                |
| -------------------------------- | ------ | ----------------------------------- |
| `agentMindmap.host`              | `auto` | `auto` \| `cursor` \| `claude-code` |
| `agentMindmap.projectsDir`       | `""`   | [Cursor] 覆盖 `~/.cursor/projects`  |
| `agentMindmap.claudeProjectsDir` | `""`   | [Claude] 覆盖 `~/.claude/projects`  |

### LLM / 主题视图

| 设置                            | 默认值   | 说明                                   |
| ------------------------------- | -------- | -------------------------------------- |
| `agentMindmap.llm.provider`     | `auto`   | `auto` \| `cursor-cli` \| `claude-cli` |
| `agentMindmap.llm.cliPath`      | `""`     | 覆盖 CLI 二进制路径                    |
| `agentMindmap.llm.model`        | `""`     | 可选的 `--model` 参数                  |
| `agentMindmap.llm.timeoutMs`    | `480000` | 单次 CLI 调用的硬超时 (ms)             |
| `agentMindmap.llm.maxAttempts`  | `1`      | 每次摘要的最大重试次数                 |
| `agentMindmap.maxTopics`        | `6`      | 目标主题数量                           |
| `agentMindmap.maxItemsPerTopic` | `6`      | 每个主题的子项数                       |
| `agentMindmap.cacheLlmResult`   | `true`   | 辅助内容寻址缓存                       |

### 库 / 合并

| 设置                                       | 默认值  | 说明                                |
| ------------------------------------------ | ------- | ----------------------------------- |
| `agentMindmap.storeDir`                    | `""`    | 库路径（空则为 `~/.agent-mindmap`） |
| `agentMindmap.library.enabled`             | `true`  | 持久化分析结果，重开时跳过 LLM      |
| `agentMindmap.library.batchRefineOntology` | `true`  | 增量本体 + 同义词精炼               |
| `agentMindmap.library.mergeMode`           | `delta` | `delta` \| `full`                   |

### UI / 主题

| 设置                        | 默认值 | 说明                                     |
| --------------------------- | ------ | ---------------------------------------- |
| `agentMindmap.ui.preset`    | `auto` | `auto` \| `dark` \| `light`              |
| `agentMindmap.ui.direction` | `side` | `side` \| `side-lr` \| `left` \| `right` |
| `agentMindmap.ui.locale`    | `auto` | `auto` \| `en` \| `zh-cn`                |
| `agentMindmap.ui.themeFile` | `""`   | 自定义主题 JSON 覆盖                     |

## 开发

```bash
cd agent-mindmap
npm install
npm install --prefix extension
npm install --prefix webview
npm run build
npm test
```

在 VS Code 中按 **F5** 启动扩展开发宿主。

完整贡献指南请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)，架构概览请参阅 [CLAUDE.md](CLAUDE.md)。

## 路线图

欢迎社区贡献：

- [ ] 为更多语言补全 UI 翻译
- [ ] 将生产路径仍在使用的 LLM prompt 迁移到 language-aware `TEXTS` 模式：
      `session-analysis`、`code-ref-descriptions`、`merge-session-analysis`
- [ ] 为非中文 prompt 变体补充 eval 覆盖，再将 `auto` prompt language 切到英文

## 隐私

对话记录可能包含本地文件路径和代码片段。扩展仅将对话内容发送到已配置的 CLI（`cursor-agent` 或 `claude`），由其在现有订阅条款下转发。库中仅存储摘要化的 `TopicGraph` 和元数据——**不包含**原始对话。扩展**不含任何遥测**，也不连接任何第三方服务器。

完整隐私政策见 [`PRIVACY.md`](PRIVACY.md)。

## 许可证

[MIT](LICENSE)
