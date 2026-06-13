# Agent Mind Map — Improvement Plan

> **Language**: 中文 · [English version pending — see roadmap.](#)
>
> 本文档为开源协作路线图。如需翻译为英文，请遵循 [CONTRIBUTING.zh-cn.md](../CONTRIBUTING.zh-cn.md) 中的"添加新语言"流程，并对照 [CONTRIBUTING.md](../CONTRIBUTING.md) 确认贡献规范。

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

- [x] 安装 ESLint 9 (flat config) + `typescript-eslint` 8 + `eslint-plugin-import` + `eslint-config-prettier`
- [x] `eslint.config.mjs` flat config，包含核心规则：
  - `no-empty: warn` — 禁止 bare catch（现有 20+ 处先标 warn，逐步收紧）
  - `no-console: warn` — 统一走 agentLog
  - `@typescript-eslint/no-unused-vars: warn` — 允许 `_` 前缀
  - `import/order: warn` — 分组排序 builtin → external → internal → parent → sibling → index → type
  - `@typescript-eslint/consistent-type-imports: warn` — 推动 `import type`
  - `@typescript-eslint/no-explicit-any: warn`
  - `@typescript-eslint/no-unsafe-function-type: warn` — 禁止裸 `Function` 类型
  - `prefer-const: warn`
- [x] 现有违规全部 warn 级（**0 errors, 280 warnings**），新代码逐步收紧
- [x] `package.json` 加 `lint` / `lint:fix` scripts
- [x] test 文件放宽规则（mocks/类型断言常见）

### 3.2 Prettier 配置

- [x] `.prettierrc.json`：`semi: true, singleQuote: false, trailingComma: "es5", printWidth: 100`
- [x] `.prettierignore` — 排除 dist、node_modules、l10n bundle JSON、LLM dumps 等
- [x] `package.json` 加 `format` / `format:check` scripts
- [ ] 一次性 `npm run format` 全量格式化（**187 文件待格式化**，独立 PR）— 暂不执行避免 git diff 噪音

### 3.3 GitHub Actions CI

- [x] `.github/workflows/ci.yml`
  - 触发：push to main + PR
  - Strict steps（必须通过）：`check:concept-nodes` → `build` → `test:vitest` → `test`
  - Soft steps（`continue-on-error`，目前仅警告）：`lint`、`format:check`、`typecheck:extension`、`typecheck:webview`
  - 缓存 npm — root + extension + webview
- [ ] `.github/workflows/release.yml`（Phase 5 处理）

### 3.4 Pre-commit Hook

- [x] 安装 `husky` v9 + `lint-staged` v15
- [x] `.husky/pre-commit` → `npx lint-staged`
- [x] `lint-staged` 配置：staged `.ts` 跑 eslint --fix + prettier --write；`.json/.md/.yml` 跑 prettier --write
- [x] `prepare` script 自动安装 husky hooks

### 3.5 Type Check 独立步骤

- [x] CI 中单独跑 `tsc --noEmit`（esbuild 不做类型检查）
- [x] `package.json` 加 `typecheck` / `typecheck:extension` / `typecheck:webview` scripts
- [x] webview 新增 `tsconfig.json`（之前缺失）
- [x] 加 `check` 综合脚本：typecheck + lint + format:check + check:concept-nodes
- ⚠️ **现状**：extension 49 个 + webview 17 个预存类型错误，`continue-on-error` 暂不阻断 CI；逐步修复列入 Phase 4 待办

### 3.6 已知失败（非本 Phase 引入）

`npm run test:vitest` 现有 3 个测试失败，全部为预先存在问题：

- `sessionStore.test.ts > isRecordFresh detects transcript / param / model / promptVersion changes` — 上游 commit `2cb43f2` 改了 `transcriptSha256` → `transcriptFreshnessToken` API，测试未同步
- `workspaceToSlug.test.ts > decodes windows slugs with drive letter`
- `reattachTimeout.test.ts > scaleMergeSessionAnalysisTimeoutMs > adds slot for large prompts`

这些不阻断 CI，列入 Phase 4 后续清理。

---

## Phase 4: 国际化 (Day 5-6)

> 三层 i18n：UI 通知、LLM Prompt、项目文档。

### 4.1 UI 通知 i18n（已有基础，需扩展）

现状：`bundle.l10n.json`（英文，153 条）+ `bundle.l10n.zh-cn.json`（中文，153 条）。

- [x] 审计所有 `t()` / `uiTranslate()` 调用，确认 key 与 bundle 一致 — `npm run check:l10n` 通过
- [x] Phase 1 新增的错误消息 key (`notify.unexpected`) 已同步两份 bundle
- [x] 新增语言包占位文件：
  ```
  extension/l10n/
  ├── bundle.l10n.json          ← 英文（基准，153 keys）
  ├── bundle.l10n.zh-cn.json    ← 简体中文（153 keys，全量同步）
  ├── bundle.l10n.ja.json       ← 日文（占位，社区贡献）
  └── bundle.l10n.ko.json       ← 韩文（占位，社区贡献）
  ```
- [x] `uiTranslate()` 支持多语言 fallback chain：指定语言 → VS Code 语言 → 英文 — 见 [`uiTranslate.ts`](../extension/src/l10n/uiTranslate.ts) 中的 `BUNDLES` map + `resolveUiLocale()`
- [x] `agentMindmap.ui.locale` enum 扩展为：`auto | en | zh-cn | ja | ko`
- [x] 新增 `agentMindmap.llm.promptLanguage` setting（`auto | en | zh`），独立于 UI locale 控制 prompt 语言
- [x] 贡献者指南说明如何添加新语言包 — 见 [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-new-ui-language)

### 4.2 LLM Prompt i18n（搭建框架 + 单文件示范）

> 策略：搭好 framework + 改造一个 prompt 作为 reference，其余 11 个 prompt 留作社区贡献项。直译 prompt 可能让 LLM 输出质量下降，必须配合 eval 流水线逐个验证。

- [x] `PromptLanguage` 类型保持 `"zh" | "en"`（不扩展为 ja/ko —— LLM 输出 JSON 是机器可读的，UI 语言扩展即可，prompt 输入语言无需逐一对应）
- [x] [`promptLanguage.ts`](../extension/src/llm/promptLanguage.ts) 新增 `resolvePromptLanguage()`：
  1. `agentMindmap.llm.promptLanguage` 显式设置优先
  2. `auto` → 跟随 `ui.locale`：`zh-cn` → `zh`，其他 → `zh`（暂保持向后兼容；待英文 prompt 全部稳定后切到 `en`）
- [x] 改造 [`promptOutline.ts`](../extension/src/llm/promptOutline.ts) 作为 reference：
  - 抽取 `TEXTS: Record<PromptLanguage, OutlinePromptStrings>`
  - `buildOutlinePrompt(events, options, hostId, promptLanguage)` 已支持新参数
  - JSON schema 标记跨语言保持完全一致
- [ ] 待迁移的其他 prompt（社区贡献项）：
  - `promptSessionAnalysis.ts`（S1 主 prompt）
  - `promptOrganizeByTree.ts`（S2 大纲组织）
  - `promptMergeSessionAnalysis.ts`、`promptOntology.ts`、`promptOntologyRefine.ts`、`promptReattach.ts`、`promptReattachTabular.ts`、`promptSessionExtract.ts`、`promptSessionSynonyms.ts`、`promptTopicPaths.ts`、`promptMerge.ts`
- [ ] 测试用例：用 fixture transcript 验证 `zh` 和 `en` prompt 输出 schema 一致（添加到 `test/promptOutline.test.ts`）— 等任意一个 prompt 完成英文化后再加

### 4.3 项目文档 i18n

- [x] README 多语言体系：
  ```
  README.md              ← 英文（Phase 0 完成）
  README.zh-cn.md        ← 简体中文（Phase 0 完成）
  CONTRIBUTING.md        ← 英文（Phase 0 完成 + Phase 4 扩展 i18n 段落）
  CONTRIBUTING.zh-cn.md  ← 简体中文（Phase 4 新增）
  docs/
  └── IMPROVEMENT-PLAN.md ← 中文（暂不双语化，路线图本身随时变动）
  ```
- [x] 每份文档顶部加跨语言链接：README、CONTRIBUTING 互链
- [x] 英文 README 在 Phase 0 已完成本地化措辞（非直译）
- [x] CONTRIBUTING 中文版扩展了"添加新语言"+"翻译 LLM prompt"详细流程

### 4.4 i18n 贡献流程

- [x] `CONTRIBUTING.md` 与 `CONTRIBUTING.zh-cn.md` 都包含完整的"Adding a new language" + "Translating LLM Prompts"段落
- [x] [`scripts/check-l10n-keys.mjs`](../scripts/check-l10n-keys.mjs) — 检查 locale bundle key 集合与英文基准一致；空占位 bundle（仅含 `_comment`）豁免，运行时会 fallback 到英文
- [x] CI strict step 加入 `npm run check:l10n`
- [x] `package.json` 加 `check:l10n` script，并纳入综合 `check` 命令

---

## Phase 5: 社区协作基础设施 (Day 7)

### 5.1 Issue 模板

- [x] [`.github/ISSUE_TEMPLATE/bug_report.yml`](../.github/ISSUE_TEMPLATE/bug_report.yml) — 含扩展版本、编辑器、host、OS、复现步骤、Output channel 日志区
- [x] [`.github/ISSUE_TEMPLATE/feature_request.yml`](../.github/ISSUE_TEMPLATE/feature_request.yml) — 问题、提案、备选方案、scope、是否愿贡献 PR
- [x] [`.github/ISSUE_TEMPLATE/question.yml`](../.github/ISSUE_TEMPLATE/question.yml) — 引导先看 README/CONTRIBUTING/已有 issue
- [x] [`.github/ISSUE_TEMPLATE/config.yml`](../.github/ISSUE_TEMPLATE/config.yml) — 禁用空白 issue，引导安全漏洞走 SECURITY.md，开放讨论走 GitHub Discussions

### 5.2 PR 模板

- [x] [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md) — 变更摘要、关联 issue、变更类型、测试 checklist（build/test/lint/l10n）、PIPELINE_VERSION 提醒、l10n bundle 双语提醒

### 5.3 Labels

- [x] [`docs/MAINTAINING.md`](MAINTAINING.md) — label 一览表 + 颜色规范 + 一键 `gh label create` 脚本（`area:llm`/`ui`/`store`/`merge`/`host`/`ci`、`i18n`、`breaking-change`、`needs-repro` 等）

### 5.4 GitHub Release

- [x] [`CHANGELOG.md`](../CHANGELOG.md) — Keep a Changelog 格式，`[Unreleased]` 段落已记录本路线图全部产出
- [x] [`docs/RELEASE.md`](RELEASE.md) — 完整发布 runbook：版本号语义、pre-release checklist、cut release 步骤、hotfix、yank、stored data 兼容性
- [ ] 实际打包并发布 v0.2.0 至 GitHub Release / VS Code Marketplace（开源时由维护者执行）

### 5.5 文档完善

- [x] [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — 面向新贡献者的高层架构文档：repo 布局、两种渲染模式、单/多 session 数据流、library 持久化、host 抽象、LLM 层、i18n 三层设计、webview 边界
- [x] CONTRIBUTING（EN + zh-cn）已链入 ARCHITECTURE.md + PIPELINES_AND_REVIEW.md + CLAUDE.md
- [x] README（EN + zh-cn）roadmap 段落更新为已完成里程碑 + 社区可参与项

---

## 时间线总览

| Day | Phase         | 关键产出                                        |
| :-: | ------------- | ----------------------------------------------- |
|  1  | Phase 0       | 开源基础文件 + README 双语 + badge              |
|  2  | Phase 1       | errors.ts + log.ts + notify.ts + wrapCommand    |
|  3  | Phase 2       | commands/ + batch/ 拆分，extension.ts ≤150行    |
|  4  | Phase 3       | ESLint + Prettier + GitHub Actions + pre-commit |
|  5  | Phase 4.1-4.2 | UI i18n 扩展 + Prompt i18n 核心三件             |
|  6  | Phase 4.3-4.4 | 文档 i18n + i18n 贡献流程                       |
|  7  | Phase 5       | Issue/PR 模板 + 架构文档 + v0.2.0 发布          |

---

## 风险与注意事项

1. **Prompt i18n 可能影响 LLM 输出质量**：英文 prompt 产出的 JSON 结构可能与中文 prompt 有细微差异。需要用 eval 流水线（已有 `npm run eval`）对比两种语言的输出质量。
2. **重构不改变行为**：Phase 2 的每一步都是纯重构，必须保证测试通过 + 手动验证。建议每步一个 PR。
3. **ESLint 渐进式收紧**：不要一次把所有规则设为 `error`。先用 `warn`，确认 CI 通过后逐条收紧。
4. **i18n 贡献门槛**：社区贡献语言包时，LLM prompt 翻译需要母语者 + AI 产品使用经验。在 CONTRIBUTING.md 中说明质量标准。
5. **LLM prompt 版本与缓存**：Prompt 语言变更后，`promptVersion` 必须递增，否则旧缓存会命中但 schema 不匹配。`pipelineVersions` 机制已存在，需要扩展以包含 prompt 语言。
