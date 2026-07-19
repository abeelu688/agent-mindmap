# Agent Mind Map 完整使用指南

本文梳理本仓库**所有面向用户的使用路径**：扩展 UI、CLI、MCP、离线导出、Team Mode，以及安装/配置方式。

架构细节见 [`ARCHITECTURE.md`](ARCHITECTURE.md)；流水线契约见仓库规则 `conversation-data-flow` / `merge-snapshot-delta`。

---

## 0. 产品在做什么

Agent Mind Map 读取 Cursor / Claude Code 的本地对话记录（`.jsonl`），用 LLM 抽成单会话主题脑图，再跨会话合并成项目级概念脑图；分析结果写入本地 Store，并可通过 MCP 供后续 Agent 对话按需检索。

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│ Cursor / Claude │────▶│ 分析（扩展或 CLI）│────▶│ 本地 Store  │
│  对话 .jsonl    │     │ S1 LLM + S2 DET  │     │ + merge     │
└─────────────────┘     │ + snapshot merge │     └──────┬──────┘
                        └──────────────────┘            │
                               │                        ▼
                               │                 ┌─────────────┐
                               │                 │ MCP Server  │
                               ▼                 │ (stdio)     │
                        ┌──────────────┐         └──────┬──────┘
                        │ 脑图 Webview │                │
                        │ / 离线 HTML  │                ▼
                        └──────────────┘         新 Agent 对话
                                                 检索历史记忆
```

**不需要单独的 LLM API Key**——分析走本机已登录的 Cursor Agent CLI（`agent` / `cursor-agent`）或 Claude Code CLI（`claude`）。

---

## 1. 使用路径总览

| 路径             | 入口                               | 典型用途                                  |
| ---------------- | ---------------------------------- | ----------------------------------------- |
| **A. 扩展 UI**   | Cursor / VS Code 命令面板          | 看脑图、批量分析、装 MCP、推 Team         |
| **B. CLI**       | `agent-mindmap` / `amind`          | 无 UI 分析、dump、装 MCP、脚本化          |
| **C. MCP**       | Agent 工具调用                     | 用已分析历史优化后续对话                  |
| **D. 离线导出**  | 画布右键 / `session\|project dump` | 浏览器打开自包含 HTML 包                  |
| **E. Team Mode** | 配置 Team Service + Push           | 多机/团队共享 session（需独立 Team 服务） |
| **F. 源码开发**  | `npm run build` + F5               | 贡献者调试扩展                            |

五条用户路径可以组合，例如：`CLI 分析 → 扩展看图`、`扩展分析 → MCP 检索`、`CLI 分析 → CLI mcp install → Agent`。

**关键约束：写入 Store 的路径必须与 MCP 读取路径一致**（见 §8）。

---

## 2. 安装与分发

### 2.1 扩展（推荐日常使用）

| 方式               | 做法                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| **安装 VSIX**      | 仓库根执行 `npm run package:vsix`，得到 `agent-mindmap-<ver>.vsix`，在 Cursor/VS Code 中「从 VSIX 安装」        |
| **Marketplace**    | 若已发布：扩展市场搜 Agent Mind Map（`Abeelu.agent-mindmap`）                                                   |
| **GitHub Release** | 从 Release 附件下载 `.vsix` 再安装                                                                              |
| **开发宿主**       | `npm install` → `npm install --prefix extension` → `npm install --prefix webview` → `npm run build` → 按 **F5** |

### 2.2 CLI（终端 / 脚本）

| 方式                   | 做法                                         |
| ---------------------- | -------------------------------------------- |
| **npm 全局（发布包）** | `npm install -g @agent-mindmap/cli`          |
| **npx**                | `npx @agent-mindmap/cli --help`              |
| **从本仓库打生产包**   | `npm run build:cli` → `npm install -g ./cli` |
| **不装全局**           | `node ./cli/dist/index.js <cmd>`             |

Bin 名：`agent-mindmap`、`amind`。产物：`cli/dist/index.js`（esbuild 单文件 CJS + shebang）。

### 2.3 MCP Server 产物（两条，勿混）

| 产物           | 构建命令                                                             | 文件                            | 谁用                                 |
| -------------- | -------------------------------------------------------------------- | ------------------------------- | ------------------------------------ |
| **扩展捆绑包** | `npm run build:mcp`（含在 `npm run build`）                          | `extension/mcp-server/index.js` | 扩展「Install MCP」、VSIX            |
| **包内构建**   | `npm run build --prefix shared && npm run build --prefix mcp-server` | `mcp-server/dist/index.js`      | CLI `mcp install` 默认写入的绝对路径 |

完整产物构建：

```bash
npm install
npm install --prefix extension webview cli mcp-server shared core   # 按需
npm run build          # shared + core + mcp 捆绑 + webview + extension
npm run build:cli      # CLI 生产包
```

---

## 3. 路径 A — 扩展 UI（Cursor / VS Code）

命令面板搜索 **Agent Mind Map**。

### 3.1 命令一览

| 命令                                          | 作用                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| **Open Latest Session**                       | 打开最近一条对话的单会话脑图                                             |
| **Choose Session…**                           | 按标题 + 时间挑选会话并打开                                              |
| **Analyze All Sessions (Current Project)**    | 扫描当前项目全部会话 → LLM 分析 → 多级 snapshot merge → 打开**概念脑图** |
| **Select Host (Cursor/Claude Code)**          | 固定读 Cursor 或 Claude Code 的 transcript                               |
| **Select Model**                              | 选择 LLM provider / 模型                                                 |
| **Install MCP Server (Cursor & Claude Code)** | 写入 `.cursor/mcp.json` 与 `.mcp.json`                                   |
| **Sync AI Context (Current Project)**         | 刷新当前项目的 MCP 检索索引                                              |
| **Refresh Repo Paths**                        | 刷新 workspace↔slug / 路径映射（MCP 解析文件用）                         |
| **Configure Team Service**                    | 配置 Team 服务 URL + API Key（Key 进 SecretStorage）                     |
| **Push Sessions to Team Service**             | 手动把本地 session 推到 Team 服务                                        |

调用 LLM 的命令带**可取消进度通知**。

### 3.2 推荐日常流程

1. 打开有 Cursor/Claude 对话记录的项目工作区。
2. （可选）**Select Host** / **Select Model**。
3. **Open Latest Session** 或 **Choose Session…** 看单会话脑图；或直接 **Analyze All Sessions** 做项目级合并。
4. 点击脑图节点 → 打开对应 Markdown 对话并定位到来源轮次。
5. （可选）右键空白画布 → **下载思维导图与对话…** → 选目录导出离线包。
6. （可选）**Install MCP Server** → 重载 MCP → 新开 Agent 对话检索历史（§5）。
7. （可选）开启 `agentMindmap.mcp.autoRefreshOnAnalyze`，批量分析结束后自动刷 MCP 索引；或手动 **Sync AI Context**。

### 3.3 脑图两种视图

| 视图              | 何时          | 说明                                |
| ----------------- | ------------- | ----------------------------------- |
| **Topic（主题）** | LLM 分析成功  | 默认；按主题/知识点组织             |
| **Turn（轮次）**  | LLM 失败/取消 | 按 Q1、Q2… 回退；**不写入 library** |

### 3.4 扩展主要设置

在 Settings 中搜 `agentMindmap`：

| 设置键                                              | 默认                      | 含义                                                                        |
| --------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------- |
| `agentMindmap.host`                                 | `auto`                    | `auto` / `cursor` / `claude-code`                                           |
| `agentMindmap.project.mode`                         | `workspace`               | `workspace`：按工作区路径做 slug；`repo`：按 git origin（同仓不同路径合并） |
| `agentMindmap.storeDir`                             | `""` → `~/.agent-mindmap` | 分析库根目录；可指到网盘同步目录                                            |
| `agentMindmap.projectsDir`                          | `""`                      | 覆盖 `~/.cursor/projects`                                                   |
| `agentMindmap.claudeProjectsDir`                    | `""`                      | 覆盖 `~/.claude/projects`                                                   |
| `agentMindmap.cursorStateDb`                        | `""`                      | 覆盖 Cursor `state.vscdb`（会话标题）                                       |
| `agentMindmap.llm.provider`                         | `auto`                    | `auto` / `cursor-cli` / `claude-cli`                                        |
| `agentMindmap.llm.cliPath` / `.model`               | `""`                      | CLI 路径与模型                                                              |
| `agentMindmap.llm.timeoutMs`                        | `480000`                  | 单次 CLI 超时                                                               |
| `agentMindmap.llm.maxAttempts` / `.retryBackoffMs`  | `1` / `1000`              | 重试                                                                        |
| `agentMindmap.maxTopics` / `maxItemsPerTopic`       | `6` / `6`                 | 主题视图规模                                                                |
| `agentMindmap.cacheLlmResult`                       | `true`                    | LLM 结果缓存                                                                |
| `agentMindmap.llm.dumpIo` / `.dumpDir`              | `false` / 自动            | 调试：落盘 prompt/response                                                  |
| `agentMindmap.autoRefresh`                          | `false`                   | 监视当前 transcript 刷新脑图                                                |
| `agentMindmap.mcp.autoRefreshOnAnalyze`             | `false`                   | 批量分析后刷 MCP 索引                                                       |
| `agentMindmap.team.serverUrl`                       | `""`                      | 空 = 单机；非空 = Team 模式                                                 |
| `agentMindmap.ui.preset` / `.locale` / `.direction` | `auto` / `auto` / `side`  | 主题、界面语言、布局                                                        |
| `agentMindmap.llm.promptLanguage`                   | `auto`                    | LLM 用户可见字段语言                                                        |
| `agentMindmap.library.*`                            | 多为 `true`               | 库持久化与 batch 相关；`mergeFullReconcileEvery` **已废弃忽略**             |

---

## 4. 路径 B — CLI

安装见 §2.2。在**目标项目根目录**执行，或加 `--cwd`。

### 4.1 全局参数

| 参数                                                                | 含义                                  |
| ------------------------------------------------------------------- | ------------------------------------- |
| `--cwd <path>`                                                      | 工作区根                              |
| `--store-dir <path>`                                                | Store 根（强烈建议与扩展对齐，见 §8） |
| `--host <id>`                                                       | `cursor` \| `claude-code`             |
| `--json` / `--quiet` / `--no-progress` / `--no-color` / `--verbose` | 输出控制                              |
| `--version`                                                         | 版本                                  |

> `--workspace`、`--locale` 已在 CLI 声明，当前解析器**未完全接线**，勿依赖。

### 4.2 命令完整表

| 命令                                 | 主要参数                             | 作用                                                   |
| ------------------------------------ | ------------------------------------ | ------------------------------------------------------ |
| `version`                            |                                      | CLI + core + pipeline + Node 版本                      |
| `doctor`                             |                                      | Store、host 扫描目录、LLM CLI 是否存在、配置路径、slug |
| `config get <key>`                   |                                      | 读配置（项目 → 用户 → `AGENT_MINDMAP_*`）              |
| `config set <key> <value>`           |                                      | 写**用户**配置（value 可 JSON）                        |
| `config list` / `config path`        |                                      | 列出合并配置 / 用户配置文件路径                        |
| `host list` / `detect` / `select`    |                                      | 列出、自动检测、交互选择 host                          |
| `model list` / `select`              |                                      | 列出/交互选择模型（分析前通常需 `select`）             |
| `session list`                       | `--all-hosts` `--limit <n>`          | 列出会话                                               |
| `session show <id>`                  | 支持 id 前缀                         | 元数据 + 是否已分析                                    |
| `session analyze [id]`               | `--latest`（无 id 时默认） `--force` | 单会话 S1+S2；等待 code-ref 队列结束                   |
| `session dump <id>`                  | `-o` `--force` `--with-analyze`      | 导出离线 HTML（**需要 id**，无 `--latest`）            |
| `project analyze`                    | `--force`                            | 全项目分析 + snapshot merge                            |
| `project status`                     |                                      | session 数、merge/snapshot、code-ref 队列              |
| `project dump`                       | `-o` `--force` `--with-analyze`      | 导出合并概念脑图                                       |
| `mcp install`                        | `--targets cursor,claude-code`       | 写 MCP 配置                                            |
| `mcp uninstall` / `mcp status`       | `--targets …`                        | 卸载 / 查看状态                                        |
| `context sync`                       |                                      | 同步 AI context（CLI 侧对 MCP 索引能力弱于扩展）       |
| `team configure` / `status` / `push` |                                      | Team URL+token、状态、推送                             |

### 4.3 CLI 推荐流程

```bash
export STORE_DIR="$HOME/.agent-mindmap"   # 与扩展/MCP 对齐

agent-mindmap --store-dir "$STORE_DIR" doctor
agent-mindmap model select

agent-mindmap --store-dir "$STORE_DIR" session list
agent-mindmap --store-dir "$STORE_DIR" session analyze --latest

agent-mindmap --store-dir "$STORE_DIR" project analyze
agent-mindmap --store-dir "$STORE_DIR" project status

# dump 需要 session id（可用 list 里的短前缀）
agent-mindmap --store-dir "$STORE_DIR" session dump <id> -o ./agent-mindmap-export --with-analyze
agent-mindmap --store-dir "$STORE_DIR" project dump -o ./agent-mindmap-export
```

### 4.4 CLI 配置文件

| 层级     | 路径                                                                                                                | 优先级 |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ------ |
| 项目     | `<cwd>/.agent-mindmap/config.json`                                                                                  | 最高   |
| 用户     | `$XDG_CONFIG_HOME/agent-mindmap/config.json`（默认 `~/.config/agent-mindmap/`；Windows `%APPDATA%\agent-mindmap\`） | 中     |
| 环境变量 | `AGENT_MINDMAP_<KEY>`（如 `llm.provider` → `AGENT_MINDMAP_LLM_PROVIDER`）                                           | 覆盖用 |

键名与扩展大致镜像：`llm.provider`、`llm.model`、`llm.timeoutMs`、`host`、`team.serverUrl` 等。

更细的 CLI 说明见 [`cli/README.md`](../cli/README.md)。

---

## 5. 路径 C — MCP（把记忆喂回 Agent）

分析完成后，MCP **只读** Store，不重新跑分析 LLM。

### 5.1 安装方式

**扩展：**

1. 至少成功分析过当前项目。
2. 命令面板：**Install MCP Server (Cursor & Claude Code)**。
3. 重载 Cursor Window / Claude `/mcp`。

**CLI：**

```bash
# 先构建 mcp-server/dist
npm run build --prefix shared && npm run build --prefix mcp-server

# 用 monorepo 内 CLI 写入绝对路径（全局 npm 包旁没有 mcp-server 目录）
node /path/to/agent-mindmap/cli/dist/index.js \
  --cwd /path/to/project \
  --store-dir "$HOME/.agent-mindmap" \
  mcp install --targets cursor
```

**手动**（与扩展捆绑包一致时）：

```json
{
  "mcpServers": {
    "agent-mindmap": {
      "command": "node",
      "args": ["/绝对路径/extension/mcp-server/index.js"],
      "env": {
        "AGENT_MINDMAP_STORE_DIR": "/home/<you>/.agent-mindmap"
      }
    }
  }
}
```

写入位置：

- Cursor：`<workspace>/.cursor/mcp.json`
- Claude Code：`<workspace>/.mcp.json`

### 5.2 MCP 工具

| 工具                      | 何时用                                        |
| ------------------------- | --------------------------------------------- |
| `server_info`             | 看能力、storeDir、推荐调用顺序                |
| `list_projects`           | 需要 `projectSlug` / 有哪些已分析项目         |
| `get_project_briefing`    | 「最近在做什么」总览                          |
| `list_project_sessions`   | 按时间浏览 session，拿 `sessionId`            |
| `search_project_history`  | 「以前怎么处理 X」——主搜索                    |
| `retrieve_project_memory` | 「提醒我关于 X 的结论」——浓缩记忆，非原始列表 |
| `get_concept_detail`      | 已有 `conceptKey` 时下钻                      |
| `get_session_outline`     | 已有 `sessionId` 时看大纲 Markdown            |

### 5.3 MCP Resources

- `agent-mindmap://project/{projectSlug}/sessions?limit=&offset=`
- `agent-mindmap://session/{projectSlug}/{sessionId}`

工具描述里的**示例语句**语言由 `storeDir/mcp-locale.json` 控制（扩展会按 UI locale 写入）。

### 5.4 在 Agent 里怎么验证

新开对话，用自然语言触发，例如：

- 「我分析过哪些项目」→ `list_projects`
- 「这个项目我们最近在做什么」→ `get_project_briefing`
- 「我们之前怎么处理 clock skew / auth retry」→ `search_project_history` / `retrieve_project_memory`

---

## 6. 路径 D — 离线导出

| 入口 | 操作                                                      |
| ---- | --------------------------------------------------------- |
| 扩展 | 脑图画布空白处右键 → **下载思维导图与对话…** → 选输出目录 |
| CLI  | `session dump <id> [-o dir] [--with-analyze]`             |
| CLI  | `project dump [-o dir] [--with-analyze]`                  |

典型目录结构：

```
agent-mindmap-export/
└── <host>-<id8>-<timestamp>/   或  <projectSlug>-<timestamp>/
    ├── index.html              ← 浏览器直接打开
    ├── mindmap.json
    ├── transcript-viewer.html
    ├── assets/
    ├── transcripts/
    ├── README.md
    ├── open.sh / open.cmd
```

无需本地 HTTP 服务。节点点击可跳到对话锚点。

> 与「离线脑图」不同：`agentMindmap.llm.dumpIo` 落的是 LLM I/O 调试文件，不是导出包。

---

## 7. 路径 E — Team Mode

客户端已具备配置与推送；Team 服务本身是**独立 Go 服务**（设计见 [`TEAM_MODE.md`](TEAM_MODE.md)），需自行部署或对接。Team 服务现已可用：

- **Merge worker**：按 `AGENT_MINDMAP_MERGE_INTERVAL`（默认 5m）定时重建 concept-trie，推送 session 后自动聚合。
- **Search**：`POST /v1/projects/:slug/search` 返回 token 评分结果（session / concept / evidence / code 四种 hit）；设 `AGENT_MINDMAP_EMBEDDING_ENDPOINT` 后启用 hybrid 检索。
- **Embedding**（opt-in）：设 `AGENT_MINDMAP_EMBEDDING_ENDPOINT` 指向 Ollama `/api/embed` 端点，worker 会自动构建 embedding 索引并用于 hybrid 评分。不设则纯文本搜索。

### 7.1 扩展

1. **Configure Team Service** → 填 URL（如 `https://team.example.com/v1`）与 API Key。
2. 清空 URL 即回到单机。
3. **Reload Window**（store 在 activate 时选定）。
4. Team 场景建议 `agentMindmap.project.mode = repo`。
5. 本地分析后，手动执行 **Push Sessions to Team Service**（无自动推送）。

### 7.2 CLI

```bash
agent-mindmap team configure   # URL + token → ~/.config/agent-mindmap/team-token（0600）
agent-mindmap team status
agent-mindmap team push
```

Token 也可用环境变量：`AGENT_MINDMAP_TEAM_TOKEN`。

---

## 8. Store、Host 与数据布局

### 8.1 Store 目录必须对齐（易错）

| 消费者                                              | 默认目录                     |
| --------------------------------------------------- | ---------------------------- |
| 扩展 `agentMindmap.storeDir`                        | `~/.agent-mindmap`           |
| MCP `AGENT_MINDMAP_STORE_DIR` / `resolveStoreDir()` | `~/.agent-mindmap`           |
| **CLI**（未传 `--store-dir`）                       | **`~/.agent-mindmap-store`** |

互通时二选一：

```bash
# 推荐：CLI 显式对齐扩展
agent-mindmap --store-dir "$HOME/.agent-mindmap" project analyze

# 或：MCP 指向 CLI 默认
# env: AGENT_MINDMAP_STORE_DIR=$HOME/.agent-mindmap-store
```

### 8.2 Store 内主要布局

```
<storeDir>/
  sessions/<projectSlug>/<sessionId>.json
  merges/…                    # concept-trie、snapshot hierarchy、deterministic 等
  ontology/
  llm-cache/
  index.json / schema.json
  mcp-locale.json             # MCP 示例语言
  …                           # repo/workspace 路径映射等
```

### 8.3 Host：Cursor vs Claude Code

|                | Cursor                                 | Claude Code            |
| -------------- | -------------------------------------- | ---------------------- |
| Transcript 根  | `~/.cursor/projects/…`                 | `~/.claude/projects/…` |
| 分析用 LLM CLI | `agent` / `cursor-agent`               | `claude -p …`          |
| 扩展选择       | `agentMindmap.host` 或 **Select Host** | 同左                   |
| CLI 选择       | `--host` / `host select` / `doctor`    | 同左                   |

扩展 `host=auto`：优先当前应用名是否 Cursor → 工作区钉扎 → 扫描目录 → 默认 cursor。  
CLI `auto`：按 cwd 扫描目录；仅一侧存在则用该侧；两侧都有或都无 → 默认 cursor。

### 8.4 项目 slug：`workspace` vs `repo`

- **workspace**（默认）：按工作区文件夹路径派生 slug。
- **repo**：按 git `origin` 规范化 URI；同仓库不同 clone 路径共用一个库。非 git 根或无 origin 时扩展会硬报错。

---

## 9. 端到端配方

### 9.1 纯扩展（最常见）

1. 安装 VSIX 或 F5。
2. **Analyze All Sessions (Current Project)**。
3. **Install MCP Server** → 重载。
4. 新 Agent 对话问历史决策。

### 9.2 生产形态 CLI → MCP（验证全链路）

```bash
cd /path/to/agent-mindmap
npm run build:cli
npm run build --prefix shared && npm run build --prefix mcp-server
npm install -g ./cli

export STORE_DIR="$HOME/.agent-mindmap"
cd /path/to/your/project

agent-mindmap --store-dir "$STORE_DIR" doctor
agent-mindmap --store-dir "$STORE_DIR" project analyze

node /path/to/agent-mindmap/cli/dist/index.js \
  --cwd /path/to/your/project \
  --store-dir "$STORE_DIR" \
  mcp install --targets cursor
# 重载 MCP → 新开 Agent 对话检索
```

### 9.3 CLI 分析 + 扩展看图

两边 `--store-dir` / `agentMindmap.storeDir` 设成同一路径后，CLI 分析完可在扩展里直接打开概念脑图（无需再分析，视缓存新鲜度而定）。

### 9.4 只导出离线包、不装 MCP

扩展右键导出，或：

```bash
agent-mindmap --store-dir "$STORE_DIR" session analyze --latest
agent-mindmap --store-dir "$STORE_DIR" session dump <id> -o ./out --with-analyze
xdg-open ./out/*/index.html
```

---

## 10. 环境变量速查

| 变量                                                            | 作用                               |
| --------------------------------------------------------------- | ---------------------------------- |
| `AGENT_MINDMAP_STORE_DIR`                                       | MCP（及 shared）Store 根           |
| `AGENT_MINDMAP_<CONFIG_KEY>`                                    | CLI 配置覆盖（点号变下划线并大写） |
| `AGENT_MINDMAP_TEAM_TOKEN`                                      | CLI Team API token                 |
| `AGENT_MINDMAP_DEBUG_INGEST` / `AGENT_MINDMAP_DEBUG_SESSION_ID` | 开发用调试 ingest（默认关）        |

---

## 11. 常见问题

**CLI 分析了，MCP / 扩展是空的？**  
Store 不一致。对齐 `--store-dir` 与 `AGENT_MINDMAP_STORE_DIR` / `agentMindmap.storeDir`。

**`mcp install` 后 MCP 起不来？**  
检查 `mcp.json` 里 `args` 指向的 `index.js` 是否存在。CLI 默认写 `mcp-server/dist/…`；只跑了 `build:mcp` 时应改指向 `extension/mcp-server/index.js`。

**全局安装 CLI 后 `mcp install` 路径错误？**  
全局包旁没有 monorepo 的 `mcp-server/`。用仓库内 `node cli/dist/index.js mcp install …` 写入绝对路径。

**`session dump --latest` 不可用？**  
实现上 dump **必须传 `<id>`**。先 `session list` / `analyze --latest`，再用 id（或前缀）dump。

**需要 API Key 吗？**  
单机分析不需要。Team Mode 需要 Team 服务自己的 API Key。

**会不会改写 Cursor/Claude 的聊天记录？**  
不会。脑图与 Store 均为只读消费 transcript。

---

## 12. 维护者脚本（非终端用户主路径）

| 脚本                                         | 用途                                       |
| -------------------------------------------- | ------------------------------------------ |
| `npm run build` / `build:cli` / `build:mcp`  | 构建产物                                   |
| `npm run package` / `package:vsix`           | 打 VSIX                                    |
| `npm test` / `test:vitest` / `test:mcp`      | 测试                                       |
| `npm run check`                              | typecheck + lint + format + 边界 + l10n 等 |
| `npm run eval`                               | 本地 eval（需 fixtures + LLM CLI）         |
| `npm run watch`                              | 扩展/webview 监视构建                      |
| `npm run check:concept-nodes` / `check:l10n` | 质量门禁                                   |

Eval 说明见 [`test/eval/README.md`](../test/eval/README.md)。发版见 [`RELEASE.md`](RELEASE.md)。

---

## 13. 相关文档

| 文档                                                                  | 内容          |
| --------------------------------------------------------------------- | ------------- |
| [`README.md`](../README.md) / [`README.zh-cn.md`](../README.zh-cn.md) | 产品简介      |
| [`cli/README.md`](../cli/README.md)                                   | CLI 命令细节  |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)                                  | 架构          |
| [`PIPELINES_AND_REVIEW.md`](PIPELINES_AND_REVIEW.md)                  | 流水线阶段    |
| [`TEAM_MODE.md`](TEAM_MODE.md)                                        | Team 模式设计 |
| [`PRIVACY.md`](../PRIVACY.md)                                         | 隐私          |
| [`MAINTAINING.md`](MAINTAINING.md)                                    | 维护          |
