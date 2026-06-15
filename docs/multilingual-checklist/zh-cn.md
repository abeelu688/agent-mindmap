# Simplified Chinese (zh-cn) — UI translation review

> Auto-generated from `extension/l10n/bundle.l10n.zh-cn.json`. Regenerate with `npm run checklist:l10n`.

| Field        | Value                                                                                  |
| ------------ | -------------------------------------------------------------------------------------- |
| Locale ID    | `zh-cn`                                                                                |
| Native name  | 简体中文                                                                               |
| Bundle       | [`extension/l10n/bundle.l10n.zh-cn.json`](../../extension/l10n/bundle.l10n.zh-cn.json) |
| Keys         | 154                                                                                    |
| Review tier  | Maintainer-reviewed baseline. Re-check when English keys change.                       |
| Status       | ☐ Not started · ☐ In progress · ☐ Reviewed                                             |
| Reviewer     | _@github-username_                                                                     |
| Review PR    | \_#\_\_\_                                                                              |
| Last updated | _YYYY-MM-DD_                                                                           |

## Review criteria

Tick each row when the translation:

- [ ] Matches the English meaning in context (notifications, progress, errors).
- [ ] Keeps placeholders `{0}`, `{1}`, … in the same order and count.
- [ ] Uses consistent product terms (`Agent Mind Map`, `LLM`, `CLI`, `VS Code`).
- [ ] Reads naturally for UI copy (not overly literal).

---

## Concept mind map (`mindmap.concept`, 6 keys)

- [ ] **`mindmap.concept.empty.invalidConceptPath`**
  - **EN:** (Some topics have invalid conceptPath; re-open the session or run Analyze All Sessions with force re-analyze.)
  - **ZH-CN:** (部分核心的 conceptPath 无效；请重新打开会话，或运行 Analyze All Sessions 并强制重新分析)

- [ ] **`mindmap.concept.empty.noConceptPath`**
  - **EN:** (No topics with conceptPath in the library; re-open a session or run Analyze All Sessions with force re-analyze.)
  - **ZH-CN:** (库中暂无带 conceptPath 的核心；请重新打开会话，或运行 Analyze All Sessions 并强制重新分析)

- [ ] **`mindmap.concept.empty.noSessions`**
  - **EN:** (No analyzed sessions in the library; run Open Latest Session or Analyze Project Sessions first.)
  - **ZH-CN:** (库中暂无已分析的 session；请先 Open Latest Session 或 Analyze Project Sessions)

- [ ] **`mindmap.concept.noDetails`**
  - **EN:** (No details)
  - **ZH-CN:** （无细节）

- [ ] **`mindmap.concept.titleAll`**
  - **EN:** Concept Mind Map · All
  - **ZH-CN:** Concept Mind Map · 全部

- [ ] **`mindmap.concept.uncategorized`**
  - **EN:** Uncategorized ({0})
  - **ZH-CN:** 未分类 ({0})

## Merged mind map (`mindmap.merge`, 3 keys)

- [ ] **`mindmap.merge.empty.noSessions`**
  - **EN:** (No analyzed sessions in the library)
  - **ZH-CN:** (库中暂无已分析的 session)

- [ ] **`mindmap.merge.projectPrefix`**
  - **EN:** Project: {0}
  - **ZH-CN:** 项目: {0}

- [ ] **`mindmap.merge.titleAll`**
  - **EN:** Agent Mind Map · All
  - **ZH-CN:** Agent Mind Map · 全部

## Turn view labels (`mindmap.turn`, 3 keys)

- [ ] **`mindmap.turn.conclusion`**
  - **EN:** Conclusion
  - **ZH-CN:** 结论

- [ ] **`mindmap.turn.research`**
  - **EN:** Research
  - **ZH-CN:** 调研

- [ ] **`mindmap.turn.sessionDefault`**
  - **EN:** Agent Session
  - **ZH-CN:** Agent 会话

## Unexpected errors (`notify.unexpected`, 1 keys)

- [ ] **`notify.unexpected`**
  - **EN:** Agent Mind Map: An unexpected error occurred: {0}
  - **ZH-CN:** Agent Mind Map: 发生意外错误：{0}

## Batch analyze (`ui.batch`, 23 keys)

- [ ] **`ui.batch.emptyOnDisk`**
  - **EN:** Agent Mind Map: No agent transcripts found on disk for current project ({0}).
  - **ZH-CN:** Agent Mind Map: 当前项目 ({0}) 磁盘上暂无 agent 会话记录。

- [ ] **`ui.batch.failedSuffix`**
  - **EN:** {0} session(s) failed.
  - **ZH-CN:** {0} 条会话分析失败。

- [ ] **`ui.batch.item.cacheHit`**
  - **EN:** Cache hit
  - **ZH-CN:** 命中缓存

- [ ] **`ui.batch.item.done`**
  - **EN:** Analysis completed
  - **ZH-CN:** 分析完成

- [ ] **`ui.batch.item.failed`**
  - **EN:** Analysis failed
  - **ZH-CN:** 分析失败

- [ ] **`ui.batch.item.fallbackTurnView`**
  - **EN:** Fell back to chronological view
  - **ZH-CN:** 已降级为时序视图

- [ ] **`ui.batch.item.start`**
  - **EN:** Start analyzing
  - **ZH-CN:** 开始分析

- [ ] **`ui.batch.mode.force.desc`**
  - **EN:** Clear this project's library, merge snapshots, and ontology cache, then re-run the LLM for every session
  - **ZH-CN:** 清除本项目的分析库、合并快照与 ontology 缓存，并对每条会话重新调用 LLM

- [ ] **`ui.batch.mode.force.label`**
  - **EN:** Force re-analyze all
  - **ZH-CN:** 全部强制重新分析

- [ ] **`ui.batch.mode.skipCached.desc`**
  - **EN:** Only analyze transcripts missing or stale in the library
  - **ZH-CN:** 仅分析库中缺失或已过期的 transcript

- [ ] **`ui.batch.mode.skipCached.label`**
  - **EN:** Skip cached sessions
  - **ZH-CN:** 跳过已缓存会话

- [ ] **`ui.batch.noOntologyEquivalences`**
  - **EN:** Agent Mind Map: Concept synonym rules were not generated. Run Analyze All Sessions (Current Project) again for full merge.
  - **ZH-CN:** Agent Mind Map: 未生成概念同义段规则。请再次运行「Analyze All Sessions (Current Project)」以完成同义项合并。

- [ ] **`ui.batch.noOntologyEquivalencesDisabled`**
  - **EN:** Agent Mind Map: Batch merge used mechanical path rules only. Enable agentMindmap.library.batchRefineOntology and run Analyze All Sessions again to refine synonyms.
  - **ZH-CN:** Agent Mind Map: 批量合并仅使用机械 path 规则。可启用 agentMindmap.library.batchRefineOntology，并再次运行「Analyze All Sessions (Current Project)」进行同义段精炼。

- [ ] **`ui.batch.pickMode.placeholder`**
  - **EN:** Batch analyze agent sessions in current project
  - **ZH-CN:** 批量分析当前项目的 agent 会话

- [ ] **`ui.batch.progress.finalRefine`**
  - **EN:** Final concept synonym refine…
  - **ZH-CN:** 正在进行最终概念同义段精炼…

- [ ] **`ui.batch.progress.finished`**
  - **EN:** Batch finished: {0} total, {1} succeeded, {2} cached, {3} failed
  - **ZH-CN:** 批量分析结束：共 {0} 条，成功 {1}，缓存 {2}，失败 {3}

- [ ] **`ui.batch.progress.mergingConceptMap`**
  - **EN:** Merging concept mind map (analyzed {0} session(s))…
  - **ZH-CN:** 正在合并概念思维导图（已分析 {0} 条会话）…

- [ ] **`ui.batch.progress.refineOntology`**
  - **EN:** Refining concept synonyms (batch {0}, {1}/{2} sessions)…
  - **ZH-CN:** 正在精炼概念同义段（第 {0} 批，{1}/{2} 条会话）…

- [ ] **`ui.batch.progress.scanSessions`**
  - **EN:** Scanning agent sessions for current project…
  - **ZH-CN:** 正在扫描当前项目的 agent 会话…

- [ ] **`ui.batch.progress.start`**
  - **EN:** {0} session(s) total, starting batch analysis…
  - **ZH-CN:** 共 {0} 条会话，开始批量分析…

- [ ] **`ui.batch.progress.title`**
  - **EN:** Agent Mind Map: Batch analyze & merge…
  - **ZH-CN:** Agent Mind Map: 批量分析并合并…

- [ ] **`ui.batch.summary`**
  - **EN:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached.
  - **ZH-CN:** Agent Mind Map: 共 {0} 条会话，新分析 {1}，缓存 {2}。

- [ ] **`ui.batch.summary.withFailures`**
  - **EN:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached, {3} failed ({4}{5}).
  - **ZH-CN:** Agent Mind Map: 共 {0} 条会话，新分析 {1}，缓存 {2}，失败 {3}（{4}{5}）。

## Browse sessions (`ui.browse`, 1 keys)

- [ ] **`ui.browse.placeholder`**
  - **EN:** Pick an analyzed session to open (from library)
  - **ZH-CN:** 选择要打开的已分析会话（来自库）

## CLI install guide (`ui.cliInstall`, 15 keys)

- [ ] **`ui.cliInstall.action.copyCommand`**
  - **EN:** Copy install command
  - **ZH-CN:** 复制安装命令

- [ ] **`ui.cliInstall.action.openDocs`**
  - **EN:** Open install docs
  - **ZH-CN:** 打开安装文档

- [ ] **`ui.cliInstall.action.openSettings`**
  - **EN:** Open CLI settings
  - **ZH-CN:** 打开 CLI 设置

- [ ] **`ui.cliInstall.claude.installBody`**
  - **EN:** Follow the official guide: {0}
  - **ZH-CN:** 参阅官方文档：{0}

- [ ] **`ui.cliInstall.copied`**
  - **EN:** Agent Mind Map: Install command copied to clipboard.
  - **ZH-CN:** Agent Mind Map: 安装命令已复制到剪贴板。

- [ ] **`ui.cliInstall.cursor.auth`**
  - **EN:** 3. First run may require sign-in: agent login (or follow the browser link).
  - **ZH-CN:** 3. 首次使用可能需要登录：agent login（或按浏览器提示完成）。

- [ ] **`ui.cliInstall.cursor.installUnix`**
  - **EN:** In a terminal: {0}
  - **ZH-CN:** 在终端中运行：{0}

- [ ] **`ui.cliInstall.cursor.installWin`**
  - **EN:** In PowerShell: {0}
  - **ZH-CN:** 在 PowerShell 中运行：{0}

- [ ] **`ui.cliInstall.step.auth`**
  - **EN:** 3. Sign in if prompted (see the install guide for headless / CI auth).
  - **ZH-CN:** 3. 首次使用可能需要登录（见安装文档中的 headless / CI 鉴权说明）。

- [ ] **`ui.cliInstall.step.cliPath`**
  - **EN:** 4. If auto-detect still fails, set Settings → {0} to the full path of the agent or claude executable.
  - **ZH-CN:** 4. 若仍无法自动找到，请在设置中填写 {0} 为 agent / claude 可执行文件的完整路径。

- [ ] **`ui.cliInstall.step.install`**
  - **EN:** 1. Install the CLI
  - **ZH-CN:** 1. 安装 CLI

- [ ] **`ui.cliInstall.step.libraryNote`**
  - **EN:** 5. Turn-only (chronological) views are not saved. Re-run batch analyze after the CLI works to build Concept Mind Map.
  - **ZH-CN:** 5. 时序视图不会写入分析库。CLI 可用后请重新批量分析以生成 Concept Mind Map。

- [ ] **`ui.cliInstall.step.verify`**
  - **EN:** 2. Verify in a terminal: {0}
  - **ZH-CN:** 2. 在终端验证：{0}

- [ ] **`ui.cliInstall.summary.claude`**
  - **EN:** Agent Mind Map: Claude Code CLI not found — sessions cannot be saved to the library.
  - **ZH-CN:** Agent Mind Map: 未找到 Claude Code CLI，无法写入分析库。

- [ ] **`ui.cliInstall.summary.cursor`**
  - **EN:** Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library.
  - **ZH-CN:** Agent Mind Map: 未找到 cursor-agent CLI，无法写入分析库。

## Code references (`ui.codeRefs`, 1 keys)

- [ ] **`ui.codeRefs.pendingRefresh`**
  - **EN:** Agent Mind Map: Code descriptions are ready. Click Refresh in the mind map to update.
  - **ZH-CN:** Agent Mind Map: 代码描述已更新。点击思维导图里的 Refresh 后更新画面。

## Commands (`ui.command`, 1 keys)

- [ ] **`ui.command.refresh.done`**
  - **EN:** Agent Mind Map refreshed.
  - **ZH-CN:** Agent Mind Map 已刷新。

## Concept path hints (`ui.concept`, 2 keys)

- [ ] **`ui.concept.noConceptPathAll`**
  - **EN:** Agent Mind Map: All topics in the library have no conceptPath (likely analyzed before upgrade). Re-open the session or run Analyze All Sessions with force re-analyze.
  - **ZH-CN:** Agent Mind Map: 库里所有核心都没有 conceptPath（可能是升级前分析的）。请重新打开会话，或运行「Analyze All Sessions」并选择全部强制重新分析。

- [ ] **`ui.concept.someMissingConceptPath`**
  - **EN:** Agent Mind Map: {0} topic(s) missing conceptPath were placed under the “Uncategorized” branch.
  - **ZH-CN:** Agent Mind Map: {0} 个核心缺少 conceptPath，被放在「未分类」分支下。

## Debug commands (`ui.debug`, 6 keys)

- [ ] **`ui.debug.cursorOnly`**
  - **EN:** Agent Mind Map: This debug command is only available when agentMindmap.host is Cursor.
  - **ZH-CN:** Agent Mind Map: 此调试命令仅在 agentMindmap.host 为 Cursor 时可用。

- [ ] **`ui.debug.inspectComposer.pickSession.placeholder`**
  - **EN:** Pick a session to inspect its entry in composer.composerHeaders
  - **ZH-CN:** 选择一个 session 检查它在 composer.composerHeaders 里的条目

- [ ] **`ui.debug.pickStateKey.placeholder`**
  - **EN:** Pick a state.vscdb key to view its full value
  - **ZH-CN:** 选择一个 state.vscdb key 查看完整 value

- [ ] **`ui.debug.stateKeyMissing`**
  - **EN:** Agent Mind Map: key {0} does not exist or failed to read.
  - **ZH-CN:** Agent Mind Map: key {0} 不存在或读取失败。

- [ ] **`ui.debug.testJump.pickSession.placeholder`**
  - **EN:** Pick a session as the simulated click target
  - **ZH-CN:** 选择一个 session 作为模拟点击的目标

- [ ] **`ui.debug.tryOpenShapes.placeholder`**
  - **EN:** Pick a session to debug glass.openAgentById argument shapes
  - **ZH-CN:** 选择一个 session 来调试 glass.openAgentById 的参数形态

## Download & export (`ui.download`, 7 keys)

- [ ] **`ui.download.choice.openInBrowser`**
  - **EN:** Open in browser
  - **ZH-CN:** 在浏览器中打开

- [ ] **`ui.download.choice.showInExplorer`**
  - **EN:** Show in file manager
  - **ZH-CN:** 在资源管理器中显示

- [ ] **`ui.download.exportFailed`**
  - **EN:** Agent Mind Map: Export failed: {0}
  - **ZH-CN:** Agent Mind Map: 导出失败: {0}

- [ ] **`ui.download.exported.summary`**
  - **EN:** Exported mind map and {0} transcript(s) to the selected folder.
  - **ZH-CN:** 已导出思维导图与 {0} 个对话到所选目录。

- [ ] **`ui.download.exporting.title`**
  - **EN:** Agent Mind Map: Exporting…
  - **ZH-CN:** Agent Mind Map: 正在导出…

- [ ] **`ui.download.pickFolderLabel`**
  - **EN:** Select download folder
  - **ZH-CN:** 选择下载目录

- [ ] **`ui.download.pickPackageFolderLabel`**
  - **EN:** Select offline package folder
  - **ZH-CN:** 选择离线包目录

## JSON export (`ui.exportJson`, 1 keys)

- [ ] **`ui.exportJson.exported`**
  - **EN:** Exported mind map to docs/agent-mindmaps/{0}
  - **ZH-CN:** 已导出思维导图到 docs/agent-mindmaps/{0}

## Jump to transcript (`ui.jump`, 12 keys)

- [ ] **`ui.jump.diagnose.placeholder`**
  - **EN:** Found {0} command(s) (recorded to Mind Map logs)
  - **ZH-CN:** 发现 {0} 个命令（已记录到 Mind Map 日志）

- [ ] **`ui.jump.loading`**
  - **EN:** Loading transcript…
  - **ZH-CN:** 正在加载会话记录…

- [ ] **`ui.jump.missingTranscriptPath`**
  - **EN:** Agent Mind Map: Cannot open transcript (missing transcript path).
  - **ZH-CN:** Agent Mind Map: 无法打开对话记录（缺少 transcript 路径）。

- [ ] **`ui.jump.openById.allFailed`**
  - **EN:** Agent Mind Map: Tried all shapes and none worked. Please check the logs.
  - **ZH-CN:** Agent Mind Map: 尝试了所有 shape 都未生效。请检查日志面板。

- [ ] **`ui.jump.openById.confirmNo`**
  - **EN:** ❌ No, try next
  - **ZH-CN:** ❌ 否，继续下一个

- [ ] **`ui.jump.openById.confirmYes`**
  - **EN:** ✅ Yes, stop
  - **ZH-CN:** ✅ 是，停止

- [ ] **`ui.jump.openById.remembered`**
  - **EN:** Agent Mind Map: Remembered shape {0} (please send this back to the developer).
  - **ZH-CN:** Agent Mind Map: 已记住 shape {0}（请将这条信息发回开发者）。

- [ ] **`ui.jump.openById.shapePrompt`**
  - **EN:** Agent Mind Map · Called {0} {1} → {2}. Did it open the correct Agent?
  - **ZH-CN:** Agent Mind Map · 调用 {0} {1} → {2}。是否打开了正确的 Agent？

- [ ] **`ui.jump.openByIdUnsupported`**
  - **EN:** Agent Mind Map: The current {0} environment does not support opening the native Agent panel by ID.
  - **ZH-CN:** Agent Mind Map: 当前 {0} 环境不支持按 ID 打开原生 Agent 面板。

- [ ] **`ui.jump.openPicker.placeholder`**
  - **EN:** Select a session / question to open
  - **ZH-CN:** 选择要打开的会话 / 问题

- [ ] **`ui.jump.qTagMissing`**
  - **EN:** Agent Mind Map: Q{0} referenced by this node does not exist in the current transcript ({1} user question(s) total). Opening the whole session instead.
  - **ZH-CN:** Agent Mind Map: 该节点标注的 Q{0} 在当前 transcript 中不存在（共 {1} 轮用户提问）。已打开整段会话。

- [ ] **`ui.jump.readTranscriptFailed`**
  - **EN:** Agent Mind Map: Failed to read transcript: {0}
  - **ZH-CN:** Agent Mind Map: 读取 transcript 失败: {0}

## Library messages (`ui.library`, 5 keys)

- [ ] **`ui.library.empty.currentProject`**
  - **EN:** Agent Mind Map: No analyzed sessions in the library for current project ({0}).
  - **ZH-CN:** Agent Mind Map: 当前项目 ({0}) 库中暂无已分析的会话。

- [ ] **`ui.library.empty.hint`**
  - **EN:** Agent Mind Map: Library is empty. Analyze at least one session first (e.g. “Open Latest Session”).
  - **ZH-CN:** Agent Mind Map: 库为空。先用『Open Latest Session』等命令分析至少一个会话。

- [ ] **`ui.library.empty.llmTurnFallbackGeneric`**
  - **EN:** Agent Mind Map: LLM summarization failed for every session. Turn-only views are not saved to the library, so Concept Mind Map stays empty.
  - **ZH-CN:** Agent Mind Map: 全部会话的 LLM 摘要均失败。时序视图不会写入分析库，Concept Mind Map 因此为空。

- [ ] **`ui.library.empty.noRecordsAfterAnalyze`**
  - **EN:** Agent Mind Map: After analysis, the library still has no usable records for current project ({0}).
  - **ZH-CN:** Agent Mind Map: 当前项目 ({0}) 分析后库中仍无可用记录。

- [ ] **`ui.library.merge.emptyResult`**
  - **EN:** Agent Mind Map: Merge result is empty for current project ({0}).
  - **ZH-CN:** Agent Mind Map: 当前项目 ({0}) 合并结果为空。

## LLM progress (`ui.llm`, 5 keys)

- [ ] **`ui.llm.attempt`**
  - **EN:** LLM attempt {0}/{1}…
  - **ZH-CN:** LLM 第 {0}/{1} 次尝试…

- [ ] **`ui.llm.cacheHit`**
  - **EN:** LLM cache hit…
  - **ZH-CN:** 命中 LLM 缓存…

- [ ] **`ui.llm.failed.fallback`**
  - **EN:** Falling back to chronological view.
  - **ZH-CN:** 已降级为时序视图。

- [ ] **`ui.llm.failed.message`**
  - **EN:** Agent Mind Map: LLM summarization failed ({0}). {1}
  - **ZH-CN:** Agent Mind Map: LLM 总结失败（{0}）。{1}

- [ ] **`ui.llm.outline.heartbeat`**
  - **EN:** Generating outline…
  - **ZH-CN:** 正在生成大纲…

## Loading states (`ui.loading`, 3 keys)

- [ ] **`ui.loading.forceReanalyzing`**
  - **EN:** Force re-analyzing…
  - **ZH-CN:** 正在强制重新分析…

- [ ] **`ui.loading.preparing`**
  - **EN:** Understanding conversation…
  - **ZH-CN:** 理解对话中

- [ ] **`ui.loading.transcriptUpdatedReanalyzing`**
  - **EN:** Transcript updated, re-analyzing…
  - **ZH-CN:** 对话记录已更新，正在重新分析…

## Merge scope & progress (`ui.merge`, 14 keys)

- [ ] **`ui.merge.cache.check`**
  - **EN:** Checking merge cache…
  - **ZH-CN:** 正在检查合并缓存…

- [ ] **`ui.merge.cache.hitRender`**
  - **EN:** Merge cache hit, generating mind map…
  - **ZH-CN:** 命中合并缓存，正在生成思维导图…

- [ ] **`ui.merge.cache.write`**
  - **EN:** Writing merge cache…
  - **ZH-CN:** 正在写入合并缓存…

- [ ] **`ui.merge.llm.heartbeat`**
  - **EN:** Calling LLM to merge topics…
  - **ZH-CN:** 正在调用 LLM 合并主题…

- [ ] **`ui.merge.manualSelect.placeholder`**
  - **EN:** Select sessions to merge (all selected by default)
  - **ZH-CN:** 选择参与合并的会话（默认全选）

- [ ] **`ui.merge.progress.preparing`**
  - **EN:** Preparing LLM merge…
  - **ZH-CN:** 正在准备 LLM 合并…

- [ ] **`ui.merge.progress.title`**
  - **EN:** Agent Mind Map: Merging topics…
  - **ZH-CN:** Agent Mind Map: 正在合并主题…

- [ ] **`ui.merge.scope.all.desc`**
  - **EN:** Merge all sessions across all projects in the library
  - **ZH-CN:** 合并库中所有项目的所有会话

- [ ] **`ui.merge.scope.all.label`**
  - **EN:** All projects
  - **ZH-CN:** 全部项目

- [ ] **`ui.merge.scope.current.desc`**
  - **EN:** Merge all analyzed sessions from the current workspace
  - **ZH-CN:** 合并当前 workspace 的所有已分析会话

- [ ] **`ui.merge.scope.current.label`**
  - **EN:** Current project ({0})
  - **ZH-CN:** 当前项目 ({0})

- [ ] **`ui.merge.scope.placeholder`**
  - **EN:** Select LLM merge scope
  - **ZH-CN:** 选择 LLM 合并范围

- [ ] **`ui.merge.scope.select.desc`**
  - **EN:** Choose sessions to include in the merge
  - **ZH-CN:** 多选要参与合并的会话

- [ ] **`ui.merge.scope.select.label`**
  - **EN:** Select sessions…
  - **ZH-CN:** 手动选择会话…

## Ontology / concept cache (`ui.ontology`, 7 keys)

- [ ] **`ui.ontology.cache.check`**
  - **EN:** Checking concept ontology cache…
  - **ZH-CN:** 正在检查概念本体缓存…

- [ ] **`ui.ontology.cache.hit`**
  - **EN:** Concept ontology cache hit…
  - **ZH-CN:** 命中概念本体缓存…

- [ ] **`ui.ontology.cacheCleared`**
  - **EN:** Agent Mind Map: Cleared {0} ontology cache file(s). Next open of Concept Mind Map will re-extract and refine segment equivalences.
  - **ZH-CN:** Agent Mind Map: 已清除 {0} 个 ontology 缓存文件。下次打开 Concept Mind Map 将重新抽取并精炼同义段。

- [ ] **`ui.ontology.extract`**
  - **EN:** Extracting concept ontology…
  - **ZH-CN:** 正在抽取概念本体…

- [ ] **`ui.ontology.extract.heartbeat`**
  - **EN:** Extracting concept ontology…
  - **ZH-CN:** 正在抽取概念本体…

- [ ] **`ui.ontology.refine.heartbeat`**
  - **EN:** Refining concept segment equivalences…
  - **ZH-CN:** 正在精炼概念同义段…

- [ ] **`ui.ontology.topicPaths.step`**
  - **EN:** Inferring topic paths ({0}/{1})…
  - **ZH-CN:** 正在推断 topic-paths（{0}/{1}）…

## Pick session (`ui.pickSession`, 1 keys)

- [ ] **`ui.pickSession.placeholder`**
  - **EN:** Select a {0} chat session
  - **ZH-CN:** 选择一个 {0} 对话会话

## Progress notifications (`ui.progress`, 15 keys)

- [ ] **`ui.progress.analyzingSession.title`**
  - **EN:** Agent Mind Map: Analyzing session…
  - **ZH-CN:** Agent Mind Map: 正在分析会话…

- [ ] **`ui.progress.applyConceptPaths`**
  - **EN:** Applying concept paths…
  - **ZH-CN:** 正在应用概念路径…

- [ ] **`ui.progress.batch.complete`**
  - **EN:** {0} · {1} (completed {2}/{3})
  - **ZH-CN:** 第 {0} 条 · {1}（已完成 {2}/{3}）

- [ ] **`ui.progress.batch.header`**
  - **EN:** {0} · {1}
  - **ZH-CN:** {0} · {1}

- [ ] **`ui.progress.batch.position`**
  - **EN:** {0}/{1}
  - **ZH-CN:** 第 {0}/{1} 条

- [ ] **`ui.progress.buildingMindMap.title`**
  - **EN:** Agent Mind Map: Building mind map…
  - **ZH-CN:** Agent Mind Map: 正在构建思维导图…

- [ ] **`ui.progress.cacheHitRender`**
  - **EN:** Cache hit, generating mind map…
  - **ZH-CN:** 命中缓存，正在生成思维导图…

- [ ] **`ui.progress.checkLibraryCache`**
  - **EN:** Checking library cache…
  - **ZH-CN:** 正在检查分析库缓存…

- [ ] **`ui.progress.generateMindMap`**
  - **EN:** Generating mind map…
  - **ZH-CN:** 正在生成思维导图…

- [ ] **`ui.progress.heartbeat.wait`**
  - **EN:** {0} (waiting {1} second(s))
  - **ZH-CN:** {0}（已等待 {1} 秒）

- [ ] **`ui.progress.loadLibrary`**
  - **EN:** Loading analysis library…
  - **ZH-CN:** 正在加载分析库…

- [ ] **`ui.progress.preparingMindMap`**
  - **EN:** Preparing mind map…
  - **ZH-CN:** 正在准备思维导图…

- [ ] **`ui.progress.readTranscript`**
  - **EN:** Reading transcript…
  - **ZH-CN:** 正在读取对话记录…

- [ ] **`ui.progress.renderMindMap`**
  - **EN:** Rendering mind map…
  - **ZH-CN:** 正在渲染思维导图…

- [ ] **`ui.progress.writeLibrary`**
  - **EN:** Writing to library…
  - **ZH-CN:** 正在写入分析库…

## Search (`ui.search`, 1 keys)

- [ ] **`ui.search.placeholder`**
  - **EN:** Search topics, titles, and keywords…
  - **ZH-CN:** 搜索主题、标题、要点关键词…

## Model picker (`ui.selectModel`, 4 keys)

- [ ] **`ui.selectModel.applied`**
  - **EN:** Agent Mind Map: Model set to {0}.
  - **ZH-CN:** Agent Mind Map: 模型已设为 {0}。

- [ ] **`ui.selectModel.custom.label`**
  - **EN:** Custom model name…
  - **ZH-CN:** 自定义模型名称…

- [ ] **`ui.selectModel.custom.placeholder`**
  - **EN:** Model name (e.g. claude-sonnet-4-6)
  - **ZH-CN:** 模型名称（如 claude-sonnet-4-6）

- [ ] **`ui.selectModel.placeholder`**
  - **EN:** Select a model for LLM requests
  - **ZH-CN:** 选择 LLM 请求使用的模型

## UI settings (`ui.uiSetting`, 1 keys)

- [ ] **`ui.uiSetting.noWorkspace`**
  - **EN:** Agent Mind Map: Open a workspace folder first to write UI settings into .vscode/settings.json.
  - **ZH-CN:** Agent Mind Map: 请先打开文件夹工作区，才能将样式写入 .vscode/settings.json。

## Warnings (`ui.warning`, 2 keys)

- [ ] **`ui.warning.openMindMapFirst`**
  - **EN:** Agent Mind Map: Open a mind map first.
  - **ZH-CN:** Agent Mind Map: 请先打开思维导图。

- [ ] **`ui.warning.openWorkspaceFolderFirst`**
  - **EN:** Agent Mind Map: Open a workspace folder first.
  - **ZH-CN:** Agent Mind Map: 请先打开文件夹工作区。

## Webview loading (`webview.loading`, 1 keys)

- [ ] **`webview.loading.title`**
  - **EN:** Generating mind map…
  - **ZH-CN:** 正在生成思维导图…

## Webview context menu (`webview.menu`, 13 keys)

- [ ] **`webview.menu.direction.left`**
  - **EN:** Left
  - **ZH-CN:** 向左

- [ ] **`webview.menu.direction.right`**
  - **EN:** Right
  - **ZH-CN:** 向右

- [ ] **`webview.menu.direction.side`**
  - **EN:** Both sides (right then left)
  - **ZH-CN:** 两侧（先右后左）

- [ ] **`webview.menu.direction.sideLr`**
  - **EN:** Both sides (left then right)
  - **ZH-CN:** 两侧（从左到右）

- [ ] **`webview.menu.download`**
  - **EN:** Download mind map & transcripts…
  - **ZH-CN:** 下载思维导图与对话…

- [ ] **`webview.menu.model.default`**
  - **EN:** Default
  - **ZH-CN:** 默认

- [ ] **`webview.menu.model.more`**
  - **EN:** More models…
  - **ZH-CN:** 更多模型…

- [ ] **`webview.menu.preset.auto`**
  - **EN:** Follow editor
  - **ZH-CN:** 跟随编辑器

- [ ] **`webview.menu.preset.dark`**
  - **EN:** Dark
  - **ZH-CN:** 深色

- [ ] **`webview.menu.preset.light`**
  - **EN:** Light
  - **ZH-CN:** 浅色

- [ ] **`webview.menu.section.direction`**
  - **EN:** Layout direction
  - **ZH-CN:** 布局方向

- [ ] **`webview.menu.section.model`**
  - **EN:** Model
  - **ZH-CN:** 模型

- [ ] **`webview.menu.section.theme`**
  - **EN:** Theme
  - **ZH-CN:** 主题

## Sign-off

- [ ] Spot-checked in Extension Development Host with `agentMindmap.ui.locale` set to this locale.
- [ ] Updated [REVIEW-STATUS.md](./REVIEW-STATUS.md) for this locale.
