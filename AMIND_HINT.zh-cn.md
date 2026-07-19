# AMIND_HINT

`agent-mindmap` MCP 索引当前项目过去的 AI agent 会话（Cursor / Claude Code
transcript）- 它是过往对话的记忆，**不是**当前文件或实时代码的视图。

## 何时咨询

非平凡工作之前：规划、调试、实施、code review、重构、onboarding。琐碎修复可
跳过（错别字、一行小改、自动生成的更新）。

## 如何咨询

1. `list_projects` -> `get_project_briefing` 定位当前项目。
2. `search_project_history`（关键词/语义）或 `retrieve_project_memory`（综合回忆），
   用具体关键词搜。
3. `get_session_outline` 看会话详情；`get_concept_detail` 看某概念的别名 + 跨会话证据。

| 你想问什么                               | 工具                                                |
| ---------------------------------------- | --------------------------------------------------- |
| "我们最近在做什么？"                     | `get_project_briefing`                              |
| "我们做过 X 吗？" / "Y 当时怎么处理的？" | `search_project_history`、`retrieve_project_memory` |
| "关于 X 我们决定了什么？"（综合）        | `retrieve_project_memory`                           |
| "看一下会话 Z 的大纲"                    | `get_session_outline`                               |
| "详细说说概念 X"（别名、证据）           | `get_concept_detail`                                |
| "有哪些会话？"                           | `list_project_sessions`                             |

用具体关键词（`virtual session incremental analysis`，而不是 `analysis`）；组合
领域 + 功能；带决策词（`decided`、`rejected`、`why`）。

## 注意

- 路径/函数名/标志位要对当前代码验证 - memory 是快照，不是当前状态的权威。
- 在设计文档 / PR / commit message 里引用会话 id，让下个会话能顺着线索找到。
