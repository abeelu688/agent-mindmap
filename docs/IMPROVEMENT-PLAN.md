# Agent Mind Map — Improvement Plan

> 目标：将项目推进到可开源发布的状态——代码质量、工程化、国际化、社区协作基础设施全部就位。

---

## Phase 0: 开源准备 (Day 1)

### 0.1 代码仓库基础

- [x] 创建 `CONTRIBUTING.md`（贡献流程、开发环境搭建、PR 规范）
- [x] 创建 `CODE_OF_CONDUCT.md`（Contributor Covenant）
- [x] 更新 `LICENSE` 中的 copyright holder 为项目名
- [x] 创建 `SECURITY.md`（安全漏洞报告渠道）
- [x] 在 `README.md` 顶部加 badge（CI status、license、VS Code version）
- [x] 确认 `.gitignore` 排除所有敏感路径（LLM dumps、transcripts、`.env`）— 补充了 `.env`、`.env.*`、`.vscode/settings.json` 等
- [x] 检查代码中是否有硬编码的本地路径或凭证 — 仅 `eval/loadEvalConfig.ts` 有开发时默认路径，可被 local config 覆盖，无安全风险

### 0.2 README 多语言

- [x] `README.md` 保持英文（主文档）
- [x] `README.zh-cn.md` 中文版
- [x] 两份 README 顶部互相链接
- [ ] README 增加截图 / GIF（mind map 实际效果）— 待实际截图替换 `docs/screenshot.png`
- [x] README 增加 "Roadmap" 段落，指向本文档

---

## Phase 1: 统一错误处理 (Day 2)

> 原则：所有模块的错误都有 `code`，所有用户可见消息走 `notify()`，所有日志走 `agentLog`。

### 1.1 创建统一错误类型

- [x] 新建 `extension/src/errors.ts`
  - `AgentMindmapError` 基类（`code: string`, `context?: Record<string,unknown>`, `cause?: unknown`）
  - 错误码命名空间：`llm:*`, `store:*`, `transcript:*`, `merge:*`, `host:*`
  - `isUserFacingError()` / `isRetryableError()` / `isCancellationError()` 工具函数
  - `LlmProviderError` 保持独立，`toMindmapError()` 可将 LlmProviderError 转为 AgentMindmapError
  - `isRetryableError` 和 `isCancellationError` 覆盖两种错误类型

### 1.2 创建统一日志通道

- [x] 新建 `extension/src/log.ts`
  - `initLog(context)` 初始化 OutputChannel
  - `agentLog.debug/info/warn/error()` 方法
  - 自动附加时间戳、级别标记（🔍ℹ️⚠️❌）
  - 非 VS Code 环境（vitest）自动 fallback 到 console
  - `mindMapLogCompat()` 兼容过渡
- [x] `extension.ts` 中 `mindMapLog` 调用标记为 TODO，后续迁移
- [x] 替换散落的 `console.warn/error/info`：extension.ts (2处)、sessionLoader.ts (5处)、store/ (3处)、transcript/ (9处)、llm/ (2处)

### 1.3 创建统一通知函数

- [x] 新建 `extension/src/notify.ts`
  - `notify(err, fallbackLevel?)` 按 error code 自动选 info/warning/error
  - `CODE_LEVEL` 映射表：`llm:timeout` → warning, `merge:failed` → error 等
  - 自动调用 `agentLog.error()` 记录
  - 便捷函数：`notifyInfo()`, `notifyWarning()`, `notifyError()`

### 1.4 创建命令包装器

- [x] 新建 `extension/src/commands/commandWrapper.ts`
  - `wrapCommand(fn)` — 统一 try/catch，取消时静默，其他走 `notify()`

### 1.5 逐步替换现有代码

优先级（用户可见路径优先）：

1. [x] `extension.ts` 中 19 处 `vscode.window.showXxx` → `notifyXxx()`（保留 1 处带选择按钮的 `showInformationMessage` 用于下载导出交互）
2. [x] `sessionLoader.ts` 中 6 处 `showXxx` → `notifyXxx()`，7 处 `console.warn` → `agentLog`
3. [x] `store/` 中 3 处 `console.warn` → `agentLog`
4. [x] `transcript/` 中 9 处 `console.warn` → `agentLog`
5. [x] `llm/` 中 2 处 `console.warn/info` → `agentLog`
6. [ ] 20+ 个 bare `catch {}` 至少加 `agentLog.debug()`（后续随 ESLint `no-empty` 规则逐步补齐）

### 1.6 i18n 兼容

- [x] `notify()` 中的消息使用 `t()` / `uiTranslate()`
- [x] 新增错误消息 key `notify.unexpected` 到 `bundle.l10n.json` + `bundle.l10n.zh-cn.json`

---

## Phase 2: 重构入口文件 (Day 3)

> 目标：`extension.ts` 从 1,229 行降到 ~232 行，只做注册 + 生命周期。

### 2.1 抽取共享模块

- [x] `extension/src/llmOptions.ts` (67行) — `readLlmOptions()` + `resolveLlmProviderId()` + `ensureModelSelected()` + `markModelSelected()`
- [x] `extension/src/progressHelpers.ts` (100行) — `withCancellableProgress()` + `progressTitle()` + `attachTranscriptWatch()`

### 2.2 抽取命令文件

```
extension/src/commands/
├── commandWrapper.ts   ← Phase 1 已创建 (27行)
├── openLatest.ts      ← commandOpenLatest (46行) + activeSession 状态管理
├── pickSession.ts     ← commandPickSession (36行)
├── downloadPackage.ts ← commandDownloadPackage (79行)
├── selectHost.ts      ← commandSelectHost (32行)
├── selectModel.ts     ← commandSelectModel (84行)
└── analyzeProject.ts  ← commandAnalyzeAndMergeCurrentProject (497行)
```

### 2.3 拆分批量分析编排

```
extension/src/batch/
├── batchStatus.ts     ← pendingMindMap + lastBatchStatus 状态管理 (50行)
└── conceptMerge.ts    ← buildProjectConceptMergeForBatch/FromCache + toConceptMergeLlmOpts (125行)
```

### 2.4 精简 extension.ts

- [x] 删除所有命令实现函数，import 自 `commands/`
- [x] `activate()` 只做：initLog、注册命令（`wrapCommand` 包一层）、事件监听、启动后初始化
- [x] `deactivate()` 不变，通过 `setActiveSession(undefined)` 清理
- [x] 删除模块级状态变量 `pendingMergeMindMap` / `pendingMergeBatchNo` / `lastBatchStatus`，移入 `batchStatus.ts`
- [x] 删除模块级 `activeSession`，移入 `commands/openLatest.ts`

### 2.5 验证

- [x] `npm run build` 通过 ✅
- [x] `npm run test:vitest` 301/303 通过（2 处预存失败，非本次改动）
- [ ] F5 启动 Extension Development Host，手动验证三个命令（需人工验证）
- [x] Git diff 确认行为无变化（纯重构）

---

## Phase 3: 补齐 CI 与代码质量门禁 (Day 4)

### 3.1 ESLint 配置

- [ ] 安装：`@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `eslint-plugin-import`, `eslint-config-prettier`
- [ ] `.eslintrc.json` 核心规则：
  - `no-empty: error` — 禁止 bare catch（现有 20+ 处）
  - `no-console: warn` — 统一走 agentLog
  - `@typescript-eslint/no-unused-vars: warn`
  - `import/order: warn`
  - `@typescript-eslint/explicit-function-return-type: off`（暂不强求）
- [ ] 现有违规先标 `warn`，新代码 `error`，逐步收紧
- [ ] `package.json` 加 `lint` / `lint:fix` scripts

### 3.2 Prettier 配置

- [ ] `.prettierrc`：`{ "singleQuote": true, "trailingComma": "es5", "printWidth": 100 }`
- [ ] `package.json` 加 `format` / `format:check` scripts
- [ ] 一次性 `npm run format` 全量格式化，独立提交

### 3.3 GitHub Actions CI

- [ ] `.github/workflows/ci.yml`
  - 触发：push to main + PR
  - Steps：checkout → node 20 → npm install → `tsc --noEmit` → `npm run lint` → `npm run format:check` → `npm run build` → `npm run test:vitest` → `npm test` → `npm run check:concept-nodes`
- [ ] `.github/workflows/release.yml`（可选）
  - 触发：tag `v*`
  - Steps：build → `vsce package` → upload artifact / publish to marketplace

### 3.4 Pre-commit Hook

- [ ] 安装 `husky` + `lint-staged`
- [ ] `.husky/pre-commit` → `npx lint-staged`
- [ ] `lint-staged` 配置：只对 staged `.ts` 文件跑 eslint --fix + prettier --write

### 3.5 Type Check 独立步骤

- [ ] esbuild 不做类型检查，CI 中单独跑 `tsc --noEmit`
- [ ] `package.json` 加 `typecheck` script
- [ ] webview 也加 `tsc --noEmit`（如有 tsconfig）

---

## Phase 4: 国际化 (Day 5-6)

> 三层 i18n：UI 通知、LLM Prompt、项目文档。

### 4.1 UI 通知 i18n（已有基础，需扩展）

现状：`bundle.l10n.json`（英文）+ `bundle.l10n.zh-cn.json`（中文）共 154 条。

- [ ] 审计所有 `t()` / `uiTranslate()` 调用，确保 key 与 bundle 一致
- [ ] 补充 Phase 1 新增的错误消息 key
- [ ] 新增语言包结构规范：
  ```
  extension/l10n/
  ├── bundle.l10n.json          ← 英文（基准）
  ├── bundle.l10n.zh-cn.json    ← 简体中文
  ├── bundle.l10n.ja.json       ← 日文（社区贡献）
  └── bundle.l10n.ko.json       ← 韩文（社区贡献）
  ```
- [ ] `uiTranslate()` 支持多语言 fallback chain：指定语言 → VS Code 语言 → 英文
- [ ] `agentMindmap.ui.locale` setting 扩展 enum：`auto | en | zh-cn | ja | ko`
- [ ] 贡献者指南说明如何添加新语言包

### 4.2 LLM Prompt i18n（当前全部硬编码中文）

现状：12 个 prompt 文件中 16 处硬编码中文（"你是会话大纲分析助手"、"请把整段对话翻译成" 等）。

- [ ] 将每个 prompt 文件中的固定文字抽为 `promptTexts[language]` 结构：
  ```typescript
  // llm/prompts/texts/sessionOutline.ts
  export const sessionOutlineTexts: Record<PromptLanguage, SessionOutlineTexts> = {
    zh: {
      systemRole: "你是会话大纲分析助手。下面是 {chatLabel} 聊天记录（已脱敏）…",
      titleHint: "title: 5-15 字名词性短语，整段总主题",
      // ...
    },
    en: {
      systemRole: "You are a session outline analysis assistant. Below is a {chatLabel} chat transcript (sanitized)…",
      titleHint: "title: 5-15 character noun phrase, overall theme",
      // ...
    },
  };
  ```
- [ ] `PromptLanguage` 类型扩展为 `"zh" | "en" | "ja" | "ko"`（LLM 对中英日韩都有不错支持）
- [ ] `promptLanguage` 自动推断逻辑：
  1. 用户 setting `agentMindmap.llm.promptLanguage`（新增）
  2. 若 `auto`：跟随 `ui.locale`
  3. 默认 `"zh"`（保持向后兼容）
- [ ] 优先改造 3 个最常用的 prompt：
  1. `promptSessionAnalysis.ts`（S1 主 prompt）
  2. `promptOrganizeByTree.ts`（S2 大纲组织）
  3. `promptOutline.ts`（fallback 路径）
- [ ] 其余 prompt 逐步迁移，旧 prompt 只留中文、新 prompt 双语
- [ ] 增加 prompt i18n 的测试用例（确保英文 prompt 输出的 JSON schema 不变）

### 4.3 项目文档 i18n

- [ ] README 多语言体系：
  ```
  README.md              ← 英文（主）
  README.zh-cn.md        ← 简体中文
  docs/
  ├── CONTRIBUTING.md              ← 英文
  ├── CONTRIBUTING.zh-cn.md        ← 简体中文
  ├── IMPROVEMENT-PLAN.md          ← 英文
  └── IMPROVEMENT-PLAN.zh-cn.md    ← 简体中文
  ```
- [ ] 每份文档顶部加语言切换链接
- [ ] 英文 README 内容：保持与中文版同步的核心信息，措辞本地化（不要直译）
- [ ] 在 README 中明确说明 "LLM prompt 语言跟随 UI 设置" 以及如何切换

### 4.4 i18n 贡献流程

- [ ] `CONTRIBUTING.md` 增加 "Adding a new language" 段落
- [ ] 提供模板文件：`docs/i18n-template.md`（翻译 checklist）
- [ ] CI 中可选步骤：检查 `bundle.l10n.*.json` 的 key 集合是否与基准一致

---

## Phase 5: 社区协作基础设施 (Day 7)

### 5.1 Issue 模板

- [ ] `.github/ISSUE_TEMPLATE/bug_report.md`
- [ ] `.github/ISSUE_TEMPLATE/feature_request.md`
- [ ] `.github/ISSUE_TEMPLATE/question.md`
- [ ] Issue 模板包含：OS、VS Code 版本、扩展版本、Host（Cursor/Claude）、复现步骤

### 5.2 PR 模板

- [ ] `.github/PULL_REQUEST_TEMPLATE.md`
  - 变更描述、关联 Issue、测试方法、截图（UI 变更时）

### 5.3 Labels

- [ ] 创建 label set：`bug`, `enhancement`, `good first issue`, `help wanted`, `i18n`, `area:llm`, `area:ui`, `area:store`, `area:merge`

### 5.4 GitHub Release

- [ ] 首次发布 v0.2.0 标注为 "First public release"
- [ ] CHANGELOG.md 开始记录
- [ ] 发布流程文档化（`scripts/package-vsix.sh` → GitHub Release → Marketplace）

### 5.5 文档完善

- [ ] `docs/ARCHITECTURE.md` — 项目架构说明（数据流、pipeline 阶段、目录结构）
- [ ] `docs/CONTRIBUTING.md` 补充：
  - 开发环境搭建（F5 调试步骤）
  - 代码风格约定
  - 提交消息格式（Conventional Commits）
  - 新增 Host 适配指南
  - 新增 LLM Provider 适配指南

---

## 时间线总览

| Day | Phase | 关键产出 |
|:---:|-------|---------|
| 1 | Phase 0 | 开源基础文件 + README 双语 + badge |
| 2 | Phase 1 | errors.ts + log.ts + notify.ts + wrapCommand |
| 3 | Phase 2 | commands/ + batch/ 拆分，extension.ts ≤150行 |
| 4 | Phase 3 | ESLint + Prettier + GitHub Actions + pre-commit |
| 5 | Phase 4.1-4.2 | UI i18n 扩展 + Prompt i18n 核心三件 |
| 6 | Phase 4.3-4.4 | 文档 i18n + i18n 贡献流程 |
| 7 | Phase 5 | Issue/PR 模板 + 架构文档 + v0.2.0 发布 |

---

## 风险与注意事项

1. **Prompt i18n 可能影响 LLM 输出质量**：英文 prompt 产出的 JSON 结构可能与中文 prompt 有细微差异。需要用 eval 流水线（已有 `npm run eval`）对比两种语言的输出质量。
2. **重构不改变行为**：Phase 2 的每一步都是纯重构，必须保证测试通过 + 手动验证。建议每步一个 PR。
3. **ESLint 渐进式收紧**：不要一次把所有规则设为 `error`。先用 `warn`，确认 CI 通过后逐条收紧。
4. **i18n 贡献门槛**：社区贡献语言包时，LLM prompt 翻译需要母语者 + AI 产品使用经验。在 CONTRIBUTING.md 中说明质量标准。
5. **LLM prompt 版本与缓存**：Prompt 语言变更后，`promptVersion` 必须递增，否则旧缓存会命中但 schema 不匹配。`pipelineVersions` 机制已存在，需要扩展以包含 prompt 语言。
