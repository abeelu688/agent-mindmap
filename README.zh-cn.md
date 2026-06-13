# Agent Mind Map

[![CI](https://github.com/abeelu688/agent-mindmap/actions/workflows/ci.yml/badge.svg)](https://github.com/abeelu688/agent-mindmap/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blue.svg)](https://code.visualstudio.com/)
[![English README](https://img.shields.io/badge/README-English-blue.svg)](README.md)

VS Code 扩展：读取 AI Agent 聊天记录并以**交互式思维导图**呈现。

**[English README →](README.md)**

---

![Agent Mind Map 截图](docs/images/agentmindmap012.png)

## 支持的产品

| 产品            | 无头 CLI                 |
| --------------- | ------------------------ |
| **Cursor**      | `agent` / `cursor-agent` |
| **Claude Code** | `claude -p`              |

设置 `agentMindmap.host` 为 `auto`（默认）、`cursor` 或 `claude-code`。`auto` 模式下自动检测当前编辑器，找不到时扫描两个目录。

思维导图是**只读**的——不会写回聊天存储或影响 Agent 面板。

## LLM 集成

Agent Mind Map 使用 LLM 分析每段对话，提取主要概念，并组织成可读的主题结构。它也可以把多个已分析会话合并为项目级概念导图。

扩展通过子进程调用对应的**无头 CLI**，所以**无需单独的 API Key**，会复用你现有的产品订阅。

| Host        | 命令格式                                                       |
| ----------- | -------------------------------------------------------------- |
| Cursor      | `agent -p --force --trust --output-format json <prompt>`       |
| Claude Code | `claude -p --bare --output-format json --max-turns 1 <prompt>` |

## 命令

| 命令                                                       | 说明                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| **Agent Mind Map: Open Latest Session**                    | 加载最近的对话记录并显示单会话思维导图                      |
| **Agent Mind Map: Choose Session…**                        | 按标题 + 时间选择对话记录                                   |
| **Agent Mind Map: Analyze All Sessions (Current Project)** | 扫描所有对话记录、逐一 LLM 分析、构建并打开**概念思维导图** |

调用 LLM 的命令会显示**可取消的进度通知**，附带逐步状态文字。

## 点击节点打开对话

思维导图中的每个节点都可以点击。扩展会追溯节点到其来源的会话和轮次，然后在编辑器中打开可读的 Markdown 对话记录。

## 离线导出

右键空白画布 → **下载思维导图与对话…**。导出内容包括：

- 自包含的 `index.html` 思维导图
- 预渲染的 `transcripts/*.html`（以及 `*.md` 供编辑器使用）

无需本地 HTTP 服务器——双击 `index.html` 即可在浏览器中打开。点击节点可跳转到对应的对话锚点。

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
- [ ] 以及更多来自真实使用场景和社区反馈的新功能

## 隐私

对话记录可能包含本地文件路径和代码片段。扩展仅将对话内容发送到已配置的 CLI（`cursor-agent` 或 `claude`），由其在现有订阅条款下转发。库中仅存储摘要化的 `TopicGraph` 和元数据——**不包含**原始对话。扩展**不含任何遥测**，也不连接任何第三方服务器。

完整隐私政策见 [`PRIVACY.md`](PRIVACY.md)。

## 许可证

[MIT](LICENSE)
