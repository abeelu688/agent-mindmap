# 为 Agent Mind Map 做贡献

> **[English](CONTRIBUTING.md)**

感谢你愿意参与贡献！本指南涵盖参与项目所需的全部准备步骤。

## 快速上手

```bash
# 克隆并安装
git clone https://github.com/your-org/agent-mindmap.git
cd agent-mindmap
npm install
npm install --prefix extension
npm install --prefix webview

# 构建
npm run build

# 测试
npm run test:vitest    # vitest（无需 build）
npm test               # 扩展端 node 测试（先 build）

# 开发
npm run watch          # 同时监听 extension + webview
# 然后在 VS Code 中按 F5 启动扩展开发宿主
```

## 开发流程

1. **Fork** 仓库
2. **从 `main` 拉一个分支**：`feature/<短描述>`、`fix/<短描述>` 或 `i18n/<locale>`
3. **修改代码** —— 遵循下文的编码约定
4. **测试** —— 运行 `npm run test:vitest && npm test`
5. **Lint** —— 运行 `npm run lint`
6. **提交** —— 使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式
7. **推送** 并发起 **Pull Request**

## 提交消息

使用 Conventional Commits 格式：

```
type(scope): description

feat(llm): 添加日文 prompt 语言支持
fix(store): 修复原子写入的竞态条件
refactor(commands): 从 extension.ts 抽出 analyzeProject
docs: 更新 README 多语言 badge
i18n(ja): 添加日文 UI 翻译
chore: 升级依赖
```

**类型：** `feat`、`fix`、`refactor`、`docs`、`i18n`、`test`、`chore`、`perf`

## 编码约定

### TypeScript

- 启用 `strict: true` —— 所有新代码必须通过 `tsc --noEmit`
- 对象形状优先使用 `type` 而非 `interface`
- 仅类型导入使用 `import type`
- 字面量"枚举对象"使用 `as const`

### 错误处理

- LLM 错误：使用 `LlmProviderError` 并附带具体 `LlmErrorCode`
- 永远不要在 `catch {}` 中静默吞错——至少要记录日志
- Store/transcript 错误统一走 `extension/src/log.ts` 中的 `agentLog`

### 导入顺序

1. Node 内置模块（`fs`、`path`、`child_process`）
2. 外部依赖（`vscode`、`markdown-it`）
3. 内部模块（`../llm/`、`../store/`）

### 测试

- 测试文件放在仓库根目录的 `test/`
- 测试文件名与源文件保持一致：`reattachChanges.test.ts` ↔ `reattachChanges.ts`
- VS Code API 通过 `test/vscode-stub.cjs` mock
- 使用 `__testing` 导出来测试内部函数
- 提交前运行 `npm run test:vitest && npm test`

### L10n / i18n

- UI 字符串：使用 `t(key, englishMessage, ...args)` 或 `uiTranslate(key, englishMessage, ...args)`
- 新增 key 时，必须**同时**写入 `extension/l10n/bundle.l10n.json`（英文）和 `extension/l10n/bundle.l10n.zh-cn.json`（中文）
- LLM prompt 语言由 `PromptLanguage` 类型控制

## 架构概览

详细架构说明请参阅 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，代码级 pipeline review 见 [docs/PIPELINES_AND_REVIEW.md](docs/PIPELINES_AND_REVIEW.md)，面向 AI 助手的简明版见 [CLAUDE.md](CLAUDE.md)。

要点：

- **Extension**（`extension/src/`）跑在 Node.js 中，处理 LLM 调用与数据持久化
- **Webview**（`webview/src/`）跑在浏览器 iframe 中，通过 mind-elixir 渲染思维导图
- **两种渲染模式**：Topic 视图（LLM 驱动）和 Turn 视图（按时序回退）
- **Store**（`~/.agent-mindmap/`）跨会话、跨项目持久化分析结果
- **无需 API Key** —— 复用现有的 Cursor / Claude CLI 订阅

## 常见任务

### 新增一个 LLM Prompt 阶段

1. 创建 `extension/src/llm/promptXxx.ts`，导出 `buildXxxPrompt()`
2. 在 `llm/types.ts` 的 `LlmResponseSchema` 中加入新 schema 名
3. 在 `llm/headlessCli.ts` 中添加 `parseXxxFromStdout()`
4. 在 `headlessCli.ts` 的 `parseBySchema()` 中加 case
5. 如果输出 schema 是新的或有变化，递增 `PIPELINE_VERSION`
6. 在 `test/` 中加测试

### 新增一个 Host（如 Windsurf）

1. 创建 `extension/src/host/windsurfHost.ts` 实现 `AgentHost`
2. 在 `extension/src/host/registry.ts` 中注册
3. 在 `host/types.ts` 的 `AgentHostId` 中加 host id
4. 如果 JSONL 格式不同，添加 transcript 解析逻辑
5. 如果 headless CLI 不同，在 `extension/src/llm/` 中加 CLI provider

### 添加一种新的 UI 语言

扩展的 UI 字符串（通知、命令名、安装引导）位于 `extension/l10n/`。添加新语言（例如日文）的步骤：

1. **以英文 bundle 为模板拷一份**。占位文件 `bundle.l10n.ja.json` 和 `bundle.l10n.ko.json` 已经存在：

   ```bash
   # 用完整 key 集合替换占位内容
   cat extension/l10n/bundle.l10n.json > extension/l10n/bundle.l10n.ja.json
   ```

   然后逐条翻译 value，保持 key 不变。`{0}`、`{1}` 等占位符必须保留在原位置。

2. **接入运行时加载器**。打开 [`extension/src/l10n/uiTranslate.ts`](extension/src/l10n/uiTranslate.ts) 添加 import 和 BUNDLES 项：

   ```ts
   import jaL10n from "../../l10n/bundle.l10n.ja.json";

   const BUNDLES: Partial<Record<UiLocale, Record<string, string>>> = {
     "zh-cn": zhL10n as Record<string, string>,
     ja: jaL10n as Record<string, string>, // ← 新增
   };
   ```

3. **更新 locale 枚举**。[`extension/package.json`](extension/package.json) 中的 `agentMindmap.ui.locale.enum` 已经预留了 `ja` 和 `ko`。如果你添加全新语言，需要同步在这里加上。

4. **校验 key 一致性**。运行 `npm run check:l10n` —— 确保每个 locale bundle 的 key 集合与英文基准一致。

5. **在 README 中加跨语言链接**。更新 [`README.md`](README.md) 和 [`README.zh-cn.md`](README.zh-cn.md) 顶部的 badge，必要时创建 `README.<locale>.md`。

### 翻译 LLM Prompt

LLM prompt 当前仅有中文。英文模板的脚手架已就绪（[`promptOutline.ts`](extension/src/llm/promptOutline.ts) 是参考实现），`agentMindmap.llm.promptLanguage` 设置可在语言间切换。

添加完整英文（或其他语言）prompt 的流程：

1. **一次只迁移一个 prompt**。`extension/src/llm/` 下每个 `prompt*.ts` 都有自己的 JSON 输出 schema，**不要批量翻译** —— 每个都要在 eval 流水线上验证。

2. **遵循 [`promptOutline.ts`](extension/src/llm/promptOutline.ts) 的 `TEXTS` 模式**：把每行中文抽进一个 `TEXTS: Record<PromptLanguage, ...>` 对象，再用本地化字符串拼接成 prompt。JSON schema 标记（如 `{"title":...}`）在所有语言下保持一致。

3. **验证 JSON 输出 schema 不变**。添加一个测试，用 fixture transcript 跑新 prompt 并通过 `validateSessionAnalysis()`（或对应 validator）。`zh` 和 `en` 输出必须 schema 一致。

4. **运行 eval 流水线**（`npm run eval`），分别用 `agentMindmap.llm.promptLanguage=zh` 和 `=en` 比较输出质量。**直译往往效果不如原版** —— 必要时本地化措辞。

5. **递增 `PIPELINE_VERSION`**（位于 [`pipelineVersions.ts`](extension/src/pipeline/pipelineVersions.ts)）—— 如果你的改动改变了 JSON 输出形状（纯语言切换通常不需要，但 schema 变更必须）。

> **提示**：LLM prompt 翻译既需要目标语言的母语水平，也需要 AI 产品的使用经验。逐字翻译往往不如原版有效。

## 行为准则

本项目遵循 [Contributor Covenant 行为准则](CODE_OF_CONDUCT.md)。参与即表示你同意遵守该准则。

## 许可证

提交贡献即表示你同意贡献内容以 [MIT License](LICENSE) 授权。
