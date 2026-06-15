# Korean (ko) — UI translation review

> Auto-generated from `extension/l10n/bundle.l10n.ko.json`. Regenerate with `npm run checklist:l10n`.

| Field        | Value                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| Locale ID    | `ko`                                                                             |
| Native name  | 한국어                                                                           |
| Bundle       | [`extension/l10n/bundle.l10n.ko.json`](../../extension/l10n/bundle.l10n.ko.json) |
| Keys         | 154                                                                              |
| Review tier  | AI-assisted initial draft — needs native-speaker review.                         |
| Status       | ☐ Not started · ☐ In progress · ☐ Reviewed                                       |
| Reviewer     | _@github-username_                                                               |
| Review PR    | \_#\_\_\_                                                                        |
| Last updated | _YYYY-MM-DD_                                                                     |

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
  - **KO:** (Some topics have invalid conceptPath; re-open the session or run Analyze All Sessions with force re-analyze.)

- [ ] **`mindmap.concept.empty.noConceptPath`**
  - **EN:** (No topics with conceptPath in the library; re-open a session or run Analyze All Sessions with force re-analyze.)
  - **KO:** (No topics with conceptPath in the library; re-open a session or run Analyze All Sessions with force re-analyze.)

- [ ] **`mindmap.concept.empty.noSessions`**
  - **EN:** (No analyzed sessions in the library; run Open Latest Session or Analyze Project Sessions first.)
  - **KO:** (분석된 세션이 없습니다 in the library; run Open Latest Session or Analyze Project Sessions first.)

- [ ] **`mindmap.concept.noDetails`**
  - **EN:** (No details)
  - **KO:** (세부 정보 없음)

- [ ] **`mindmap.concept.titleAll`**
  - **EN:** Concept Mind Map · All
  - **KO:** 개념 마인드맵 · All

- [ ] **`mindmap.concept.uncategorized`**
  - **EN:** Uncategorized ({0})
  - **KO:** 분류 없음 ({0})

## Merged mind map (`mindmap.merge`, 3 keys)

- [ ] **`mindmap.merge.empty.noSessions`**
  - **EN:** (No analyzed sessions in the library)
  - **KO:** (분석된 세션이 없습니다 in the library)

- [ ] **`mindmap.merge.projectPrefix`**
  - **EN:** Project: {0}
  - **KO:** Project: {0}

- [ ] **`mindmap.merge.titleAll`**
  - **EN:** Agent Mind Map · All
  - **KO:** Agent Mind Map · All

## Turn view labels (`mindmap.turn`, 3 keys)

- [ ] **`mindmap.turn.conclusion`**
  - **EN:** Conclusion
  - **KO:** 결론

- [ ] **`mindmap.turn.research`**
  - **EN:** Research
  - **KO:** 조사

- [ ] **`mindmap.turn.sessionDefault`**
  - **EN:** Agent Session
  - **KO:** 에이전트 세션

## Unexpected errors (`notify.unexpected`, 1 keys)

- [ ] **`notify.unexpected`**
  - **EN:** Agent Mind Map: An unexpected error occurred: {0}
  - **KO:** Agent Mind Map: 예기치 않은 오류가 발생했습니다: {0}

## Batch analyze (`ui.batch`, 23 keys)

- [ ] **`ui.batch.emptyOnDisk`**
  - **EN:** Agent Mind Map: No agent transcripts found on disk for current project ({0}).
  - **KO:** Agent Mind Map: No agent transcripts found on disk for current project ({0}).

- [ ] **`ui.batch.failedSuffix`**
  - **EN:** {0} session(s) failed.
  - **KO:** {0} session(s) failed.

- [ ] **`ui.batch.item.cacheHit`**
  - **EN:** Cache hit
  - **KO:** 캐시 적중

- [ ] **`ui.batch.item.done`**
  - **EN:** Analysis completed
  - **KO:** 분석 완료

- [ ] **`ui.batch.item.failed`**
  - **EN:** Analysis failed
  - **KO:** 분석 실패

- [ ] **`ui.batch.item.fallbackTurnView`**
  - **EN:** Fell back to chronological view
  - **KO:** Fell back to chronological view

- [ ] **`ui.batch.item.start`**
  - **EN:** Start analyzing
  - **KO:** 분석 시작

- [ ] **`ui.batch.mode.force.desc`**
  - **EN:** Clear this project's library, merge snapshots, and ontology cache, then re-run the LLM for every session
  - **KO:** Clear this project's library, merge snapshots, and ontology cache, then re-run the LLM for every session

- [ ] **`ui.batch.mode.force.label`**
  - **EN:** Force re-analyze all
  - **KO:** 모두 강제 재분석

- [ ] **`ui.batch.mode.skipCached.desc`**
  - **EN:** Only analyze transcripts missing or stale in the library
  - **KO:** Only analyze transcripts missing or stale in the library

- [ ] **`ui.batch.mode.skipCached.label`**
  - **EN:** Skip cached sessions
  - **KO:** 캐시된 세션 건너뛰기

- [ ] **`ui.batch.noOntologyEquivalences`**
  - **EN:** Agent Mind Map: Concept synonym rules were not generated. Run Analyze All Sessions (Current Project) again for full merge.
  - **KO:** Agent Mind Map: Concept synonym rules were not generated. Run Analyze All Sessions (Current Project) again for full merge.

- [ ] **`ui.batch.noOntologyEquivalencesDisabled`**
  - **EN:** Agent Mind Map: Batch merge used mechanical path rules only. Enable agentMindmap.library.batchRefineOntology and run Analyze All Sessions again to refine synonyms.
  - **KO:** Agent Mind Map: Batch merge used mechanical path rules only. Enable agentMindmap.library.batchRefineOntology and run Analyze All Sessions again to refine synonyms.

- [ ] **`ui.batch.pickMode.placeholder`**
  - **EN:** Batch analyze agent sessions in current project
  - **KO:** 일괄 분석 agent sessions in current project

- [ ] **`ui.batch.progress.finalRefine`**
  - **EN:** Final concept synonym refine…
  - **KO:** Final concept synonym refine…

- [ ] **`ui.batch.progress.finished`**
  - **EN:** Batch finished: {0} total, {1} succeeded, {2} cached, {3} failed
  - **KO:** Batch finished: {0} total, {1} succeeded, {2} cached, {3} failed

- [ ] **`ui.batch.progress.mergingConceptMap`**
  - **EN:** Merging concept mind map (analyzed {0} session(s))…
  - **KO:** 개념 마인드맵 병합 중 (analyzed {0} session(s))…

- [ ] **`ui.batch.progress.refineOntology`**
  - **EN:** Refining concept synonyms (batch {0}, {1}/{2} sessions)…
  - **KO:** Refining concept synonyms (batch {0}, {1}/{2} sessions)…

- [ ] **`ui.batch.progress.scanSessions`**
  - **EN:** Scanning agent sessions for current project…
  - **KO:** 에이전트 세션 스캔 중 for current project…

- [ ] **`ui.batch.progress.start`**
  - **EN:** {0} session(s) total, starting batch analysis…
  - **KO:** {0} session(s) total, starting batch analysis…

- [ ] **`ui.batch.progress.title`**
  - **EN:** Agent Mind Map: Batch analyze & merge…
  - **KO:** Agent Mind Map: 일괄 분석 & merge…

- [ ] **`ui.batch.summary`**
  - **EN:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached.
  - **KO:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached.

- [ ] **`ui.batch.summary.withFailures`**
  - **EN:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached, {3} failed ({4}{5}).
  - **KO:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached, {3} failed ({4}{5}).

## Browse sessions (`ui.browse`, 1 keys)

- [ ] **`ui.browse.placeholder`**
  - **EN:** Pick an analyzed session to open (from library)
  - **KO:** Pick an analyzed session to open (from library)

## CLI install guide (`ui.cliInstall`, 15 keys)

- [ ] **`ui.cliInstall.action.copyCommand`**
  - **EN:** Copy install command
  - **KO:** 설치 명령 복사

- [ ] **`ui.cliInstall.action.openDocs`**
  - **EN:** Open install docs
  - **KO:** 설치 문서 열기

- [ ] **`ui.cliInstall.action.openSettings`**
  - **EN:** Open CLI settings
  - **KO:** CLI 설정 열기

- [ ] **`ui.cliInstall.claude.installBody`**
  - **EN:** Follow the official guide: {0}
  - **KO:** Follow the official guide: {0}

- [ ] **`ui.cliInstall.copied`**
  - **EN:** Agent Mind Map: Install command copied to clipboard.
  - **KO:** Agent Mind Map: Install command 클립보드에 복사됨.

- [ ] **`ui.cliInstall.cursor.auth`**
  - **EN:** 3. First run may require sign-in: agent login (or follow the browser link).
  - **KO:** 3. First run may require sign-in: agent login (or follow the browser link).

- [ ] **`ui.cliInstall.cursor.installUnix`**
  - **EN:** In a terminal: {0}
  - **KO:** In a terminal: {0}

- [ ] **`ui.cliInstall.cursor.installWin`**
  - **EN:** In PowerShell: {0}
  - **KO:** In PowerShell: {0}

- [ ] **`ui.cliInstall.step.auth`**
  - **EN:** 3. Sign in if prompted (see the install guide for headless / CI auth).
  - **KO:** 3. 요청되면 로그인 (see the install guide for headless / CI auth).

- [ ] **`ui.cliInstall.step.cliPath`**
  - **EN:** 4. If auto-detect still fails, set Settings → {0} to the full path of the agent or claude executable.
  - **KO:** 4. If auto-detect still fails, set Settings → {0} to the full path of the agent or claude executable.

- [ ] **`ui.cliInstall.step.install`**
  - **EN:** 1. Install the CLI
  - **KO:** 1. CLI 설치

- [ ] **`ui.cliInstall.step.libraryNote`**
  - **EN:** 5. Turn-only (chronological) views are not saved. Re-run batch analyze after the CLI works to build Concept Mind Map.
  - **KO:** 5. Turn-only (chronological) views are not saved. Re-run batch analyze after the CLI works to build 개념 마인드맵.

- [ ] **`ui.cliInstall.step.verify`**
  - **EN:** 2. Verify in a terminal: {0}
  - **KO:** 2. 터미널에서 확인: {0}

- [ ] **`ui.cliInstall.summary.claude`**
  - **EN:** Agent Mind Map: Claude Code CLI not found — sessions cannot be saved to the library.
  - **KO:** Agent Mind Map: Claude Code CLI not found — sessions cannot be saved to the library.

- [ ] **`ui.cliInstall.summary.cursor`**
  - **EN:** Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library.
  - **KO:** Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library.

## Code references (`ui.codeRefs`, 1 keys)

- [ ] **`ui.codeRefs.pendingRefresh`**
  - **EN:** Agent Mind Map: Code descriptions are ready. Click Refresh in the mind map to update.
  - **KO:** Agent Mind Map: Code descriptions are ready. Click Refresh in the mind map to update.

## Commands (`ui.command`, 1 keys)

- [ ] **`ui.command.refresh.done`**
  - **EN:** Agent Mind Map refreshed.
  - **KO:** Agent Mind Map 새로 고침됨.

## Concept path hints (`ui.concept`, 2 keys)

- [ ] **`ui.concept.noConceptPathAll`**
  - **EN:** Agent Mind Map: All topics in the library have no conceptPath (likely analyzed before upgrade). Re-open the session or run Analyze All Sessions with force re-analyze.
  - **KO:** Agent Mind Map: All topics in the library have no conceptPath (likely analyzed before upgrade). Re-open the session or run Analyze All Sessions with force re-analyze.

- [ ] **`ui.concept.someMissingConceptPath`**
  - **EN:** Agent Mind Map: {0} topic(s) missing conceptPath were placed under the “Uncategorized” branch.
  - **KO:** Agent Mind Map: {0} topic(s) missing conceptPath were placed under the “분류 없음” branch.

## Debug commands (`ui.debug`, 6 keys)

- [ ] **`ui.debug.cursorOnly`**
  - **EN:** Agent Mind Map: This debug command is only available when agentMindmap.host is Cursor.
  - **KO:** Agent Mind Map: This debug command is only available when agentMindmap.host is Cursor.

- [ ] **`ui.debug.inspectComposer.pickSession.placeholder`**
  - **EN:** Pick a session to inspect its entry in composer.composerHeaders
  - **KO:** Pick a session to inspect its entry in composer.composerHeaders

- [ ] **`ui.debug.pickStateKey.placeholder`**
  - **EN:** Pick a state.vscdb key to view its full value
  - **KO:** Pick a state.vscdb key to view its full value

- [ ] **`ui.debug.stateKeyMissing`**
  - **EN:** Agent Mind Map: key {0} does not exist or failed to read.
  - **KO:** Agent Mind Map: key {0} does not exist or failed to read.

- [ ] **`ui.debug.testJump.pickSession.placeholder`**
  - **EN:** Pick a session as the simulated click target
  - **KO:** Pick a session as the simulated click target

- [ ] **`ui.debug.tryOpenShapes.placeholder`**
  - **EN:** Pick a session to debug glass.openAgentById argument shapes
  - **KO:** Pick a session to debug glass.openAgentById argument shapes

## Download & export (`ui.download`, 7 keys)

- [ ] **`ui.download.choice.openInBrowser`**
  - **EN:** Open in browser
  - **KO:** 브라우저에서 열기

- [ ] **`ui.download.choice.showInExplorer`**
  - **EN:** Show in file manager
  - **KO:** 파일 관리자에 표시

- [ ] **`ui.download.exportFailed`**
  - **EN:** Agent Mind Map: Export failed: {0}
  - **KO:** Agent Mind Map: 내보내기 실패: {0}

- [ ] **`ui.download.exported.summary`**
  - **EN:** Exported mind map and {0} transcript(s) to the selected folder.
  - **KO:** 마인드맵과 {0}개의 대화 기록을 선택한 폴더로 내보냈습니다.

- [ ] **`ui.download.exporting.title`**
  - **EN:** Agent Mind Map: Exporting…
  - **KO:** Agent Mind Map: 내보내는 중…

- [ ] **`ui.download.pickFolderLabel`**
  - **EN:** Select download folder
  - **KO:** 다운로드 폴더 선택

- [ ] **`ui.download.pickPackageFolderLabel`**
  - **EN:** Select offline package folder
  - **KO:** 오프라인 패키지 폴더 선택

## JSON export (`ui.exportJson`, 1 keys)

- [ ] **`ui.exportJson.exported`**
  - **EN:** Exported mind map to docs/agent-mindmaps/{0}
  - **KO:** Exported mind map to docs/agent-mindmaps/{0}

## Jump to transcript (`ui.jump`, 12 keys)

- [ ] **`ui.jump.diagnose.placeholder`**
  - **EN:** Found {0} command(s) (recorded to Mind Map logs)
  - **KO:** Found {0} command(s) (recorded to Mind Map logs)

- [ ] **`ui.jump.loading`**
  - **EN:** Loading transcript…
  - **KO:** 대화 기록 로드 중…

- [ ] **`ui.jump.missingTranscriptPath`**
  - **EN:** Agent Mind Map: Cannot open transcript (missing transcript path).
  - **KO:** Agent Mind Map: Cannot open transcript (missing transcript path).

- [ ] **`ui.jump.openById.allFailed`**
  - **EN:** Agent Mind Map: Tried all shapes and none worked. Please check the logs.
  - **KO:** Agent Mind Map: 모든 형식을 시도했지만 작동하지 않았습니다. 로그를 확인하세요.

- [ ] **`ui.jump.openById.confirmNo`**
  - **EN:** ❌ No, try next
  - **KO:** ❌ 아니요, 다음 시도

- [ ] **`ui.jump.openById.confirmYes`**
  - **EN:** ✅ Yes, stop
  - **KO:** ✅ 예, 중지

- [ ] **`ui.jump.openById.remembered`**
  - **EN:** Agent Mind Map: Remembered shape {0} (please send this back to the developer).
  - **KO:** Agent Mind Map: Remembered shape {0} (please send this back to the developer).

- [ ] **`ui.jump.openById.shapePrompt`**
  - **EN:** Agent Mind Map · Called {0} {1} → {2}. Did it open the correct Agent?
  - **KO:** Agent Mind Map · {0} {1} → {2} 호출됨. 올바른 Agent가 열렸나요?

- [ ] **`ui.jump.openByIdUnsupported`**
  - **EN:** Agent Mind Map: The current {0} environment does not support opening the native Agent panel by ID.
  - **KO:** Agent Mind Map: The current {0} environment does not support opening the native Agent panel by ID.

- [ ] **`ui.jump.openPicker.placeholder`**
  - **EN:** Select a session / question to open
  - **KO:** 열 세션 / 질문 선택

- [ ] **`ui.jump.qTagMissing`**
  - **EN:** Agent Mind Map: Q{0} referenced by this node does not exist in the current transcript ({1} user question(s) total). Opening the whole session instead.
  - **KO:** Agent Mind Map: Q{0} referenced by this node does not exist in the current transcript ({1} user question(s) total). Opening the whole session instead.

- [ ] **`ui.jump.readTranscriptFailed`**
  - **EN:** Agent Mind Map: Failed to read transcript: {0}
  - **KO:** Agent Mind Map: Failed to read transcript: {0}

## Library messages (`ui.library`, 5 keys)

- [ ] **`ui.library.empty.currentProject`**
  - **EN:** Agent Mind Map: No analyzed sessions in the library for current project ({0}).
  - **KO:** Agent Mind Map: 분석된 세션이 없습니다 in the library for current project ({0}).

- [ ] **`ui.library.empty.hint`**
  - **EN:** Agent Mind Map: Library is empty. Analyze at least one session first (e.g. “Open Latest Session”).
  - **KO:** Agent Mind Map: 라이브러리가 비어 있습니다. Analyze at least one session first (e.g. “Open Latest Session”).

- [ ] **`ui.library.empty.llmTurnFallbackGeneric`**
  - **EN:** Agent Mind Map: LLM summarization failed for every session. Turn-only views are not saved to the library, so Concept Mind Map stays empty.
  - **KO:** Agent Mind Map: LLM summarization failed for every session. Turn-only views are not saved to the library, so 개념 마인드맵 stays empty.

- [ ] **`ui.library.empty.noRecordsAfterAnalyze`**
  - **EN:** Agent Mind Map: After analysis, the library still has no usable records for current project ({0}).
  - **KO:** Agent Mind Map: After analysis, the library still has no usable records for current project ({0}).

- [ ] **`ui.library.merge.emptyResult`**
  - **EN:** Agent Mind Map: Merge result is empty for current project ({0}).
  - **KO:** Agent Mind Map: Merge result is empty for current project ({0}).

## LLM progress (`ui.llm`, 5 keys)

- [ ] **`ui.llm.attempt`**
  - **EN:** LLM attempt {0}/{1}…
  - **KO:** LLM attempt {0}/{1}…

- [ ] **`ui.llm.cacheHit`**
  - **EN:** LLM cache hit…
  - **KO:** LLM cache hit…

- [ ] **`ui.llm.failed.fallback`**
  - **EN:** Falling back to chronological view.
  - **KO:** 시간순 보기로 전환합니다.

- [ ] **`ui.llm.failed.message`**
  - **EN:** Agent Mind Map: LLM summarization failed ({0}). {1}
  - **KO:** Agent Mind Map: LLM summarization failed ({0}). {1}

- [ ] **`ui.llm.outline.heartbeat`**
  - **EN:** Generating outline…
  - **KO:** Generating outline…

## Loading states (`ui.loading`, 3 keys)

- [ ] **`ui.loading.forceReanalyzing`**
  - **EN:** Force re-analyzing…
  - **KO:** 강제 재분석 중…

- [ ] **`ui.loading.preparing`**
  - **EN:** Understanding conversation…
  - **KO:** 대화 파악 중…

- [ ] **`ui.loading.transcriptUpdatedReanalyzing`**
  - **EN:** Transcript updated, re-analyzing…
  - **KO:** 대화 기록이 업데이트되어 다시 분석 중…

## Merge scope & progress (`ui.merge`, 14 keys)

- [ ] **`ui.merge.cache.check`**
  - **EN:** Checking merge cache…
  - **KO:** Checking merge cache…

- [ ] **`ui.merge.cache.hitRender`**
  - **EN:** Merge cache hit, generating mind map…
  - **KO:** Merge cache hit, generating mind map…

- [ ] **`ui.merge.cache.write`**
  - **EN:** Writing merge cache…
  - **KO:** Writing merge cache…

- [ ] **`ui.merge.llm.heartbeat`**
  - **EN:** Calling LLM to merge topics…
  - **KO:** Calling LLM to merge topics…

- [ ] **`ui.merge.manualSelect.placeholder`**
  - **EN:** Select sessions to merge (all selected by default)
  - **KO:** Select sessions to merge (all selected by default)

- [ ] **`ui.merge.progress.preparing`**
  - **EN:** Preparing LLM merge…
  - **KO:** Preparing LLM merge…

- [ ] **`ui.merge.progress.title`**
  - **EN:** Agent Mind Map: Merging topics…
  - **KO:** Agent Mind Map: Merging topics…

- [ ] **`ui.merge.scope.all.desc`**
  - **EN:** Merge all sessions across all projects in the library
  - **KO:** Merge all sessions across all projects in the library

- [ ] **`ui.merge.scope.all.label`**
  - **EN:** All projects
  - **KO:** All projects

- [ ] **`ui.merge.scope.current.desc`**
  - **EN:** Merge all analyzed sessions from the current workspace
  - **KO:** Merge all analyzed sessions from the current workspace

- [ ] **`ui.merge.scope.current.label`**
  - **EN:** Current project ({0})
  - **KO:** Current project ({0})

- [ ] **`ui.merge.scope.placeholder`**
  - **EN:** Select LLM merge scope
  - **KO:** Select LLM merge scope

- [ ] **`ui.merge.scope.select.desc`**
  - **EN:** Choose sessions to include in the merge
  - **KO:** Choose sessions to include in the merge

- [ ] **`ui.merge.scope.select.label`**
  - **EN:** Select sessions…
  - **KO:** Select sessions…

## Ontology / concept cache (`ui.ontology`, 7 keys)

- [ ] **`ui.ontology.cache.check`**
  - **EN:** Checking concept ontology cache…
  - **KO:** Checking concept ontology cache…

- [ ] **`ui.ontology.cache.hit`**
  - **EN:** Concept ontology cache hit…
  - **KO:** Concept ontology cache hit…

- [ ] **`ui.ontology.cacheCleared`**
  - **EN:** Agent Mind Map: Cleared {0} ontology cache file(s). Next open of Concept Mind Map will re-extract and refine segment equivalences.
  - **KO:** Agent Mind Map: Cleared {0} ontology cache file(s). Next open of 개념 마인드맵 will re-extract and refine segment equivalences.

- [ ] **`ui.ontology.extract`**
  - **EN:** Extracting concept ontology…
  - **KO:** Extracting concept ontology…

- [ ] **`ui.ontology.extract.heartbeat`**
  - **EN:** Extracting concept ontology…
  - **KO:** Extracting concept ontology…

- [ ] **`ui.ontology.refine.heartbeat`**
  - **EN:** Refining concept segment equivalences…
  - **KO:** Refining concept segment equivalences…

- [ ] **`ui.ontology.topicPaths.step`**
  - **EN:** Inferring topic paths ({0}/{1})…
  - **KO:** Inferring topic paths ({0}/{1})…

## Pick session (`ui.pickSession`, 1 keys)

- [ ] **`ui.pickSession.placeholder`**
  - **EN:** Select a {0} chat session
  - **KO:** {0} 채팅 세션 선택

## Progress notifications (`ui.progress`, 15 keys)

- [ ] **`ui.progress.analyzingSession.title`**
  - **EN:** Agent Mind Map: Analyzing session…
  - **KO:** Agent Mind Map: 세션 분석 중…

- [ ] **`ui.progress.applyConceptPaths`**
  - **EN:** Applying concept paths…
  - **KO:** Applying concept paths…

- [ ] **`ui.progress.batch.complete`**
  - **EN:** {0} · {1} (completed {2}/{3})
  - **KO:** {0} · {1} ({2}/{3} 완료)

- [ ] **`ui.progress.batch.header`**
  - **EN:** {0} · {1}
  - **KO:** {0} · {1}

- [ ] **`ui.progress.batch.position`**
  - **EN:** {0}/{1}
  - **KO:** {0}/{1}

- [ ] **`ui.progress.buildingMindMap.title`**
  - **EN:** Agent Mind Map: Building mind map…
  - **KO:** Agent Mind Map: Building mind map…

- [ ] **`ui.progress.cacheHitRender`**
  - **EN:** Cache hit, generating mind map…
  - **KO:** 캐시 적중, generating mind map…

- [ ] **`ui.progress.checkLibraryCache`**
  - **EN:** Checking library cache…
  - **KO:** 라이브러리 캐시 확인 중…

- [ ] **`ui.progress.generateMindMap`**
  - **EN:** Generating mind map…
  - **KO:** 마인드맵 생성 중…

- [ ] **`ui.progress.heartbeat.wait`**
  - **EN:** {0} (waiting {1} second(s))
  - **KO:** {0} ({1}초 대기 중)

- [ ] **`ui.progress.loadLibrary`**
  - **EN:** Loading analysis library…
  - **KO:** 분석 라이브러리 로드 중…

- [ ] **`ui.progress.preparingMindMap`**
  - **EN:** Preparing mind map…
  - **KO:** 마인드맵 준비 중…

- [ ] **`ui.progress.readTranscript`**
  - **EN:** Reading transcript…
  - **KO:** 대화 기록 읽는 중…

- [ ] **`ui.progress.renderMindMap`**
  - **EN:** Rendering mind map…
  - **KO:** 마인드맵 렌더링 중…

- [ ] **`ui.progress.writeLibrary`**
  - **EN:** Writing to library…
  - **KO:** 라이브러리에 쓰는 중…

## Search (`ui.search`, 1 keys)

- [ ] **`ui.search.placeholder`**
  - **EN:** Search topics, titles, and keywords…
  - **KO:** 주제, 제목, 키워드 검색…

## Model picker (`ui.selectModel`, 4 keys)

- [ ] **`ui.selectModel.applied`**
  - **EN:** Agent Mind Map: Model set to {0}.
  - **KO:** Agent Mind Map: 모델 set to {0}.

- [ ] **`ui.selectModel.custom.label`**
  - **EN:** Custom model name…
  - **KO:** 사용자 지정 모델 이름…

- [ ] **`ui.selectModel.custom.placeholder`**
  - **EN:** Model name (e.g. claude-sonnet-4-6)
  - **KO:** 모델 name (e.g. claude-sonnet-4-6)

- [ ] **`ui.selectModel.placeholder`**
  - **EN:** Select a model for LLM requests
  - **KO:** LLM 요청 모델 선택

## UI settings (`ui.uiSetting`, 1 keys)

- [ ] **`ui.uiSetting.noWorkspace`**
  - **EN:** Agent Mind Map: Open a workspace folder first to write UI settings into .vscode/settings.json.
  - **KO:** Agent Mind Map: 먼저 작업 영역 폴더를 여세요 to write UI settings into .vscode/settings.json.

## Warnings (`ui.warning`, 2 keys)

- [ ] **`ui.warning.openMindMapFirst`**
  - **EN:** Agent Mind Map: Open a mind map first.
  - **KO:** Agent Mind Map: 먼저 마인드맵을 여세요.

- [ ] **`ui.warning.openWorkspaceFolderFirst`**
  - **EN:** Agent Mind Map: Open a workspace folder first.
  - **KO:** Agent Mind Map: 먼저 작업 영역 폴더를 여세요.

## Webview loading (`webview.loading`, 1 keys)

- [ ] **`webview.loading.title`**
  - **EN:** Generating mind map…
  - **KO:** 마인드맵 생성 중…

## Webview context menu (`webview.menu`, 13 keys)

- [ ] **`webview.menu.direction.left`**
  - **EN:** Left
  - **KO:** 왼쪽

- [ ] **`webview.menu.direction.right`**
  - **EN:** Right
  - **KO:** 오른쪽

- [ ] **`webview.menu.direction.side`**
  - **EN:** Both sides (right then left)
  - **KO:** 양쪽 (right then left)

- [ ] **`webview.menu.direction.sideLr`**
  - **EN:** Both sides (left then right)
  - **KO:** 양쪽 (left then right)

- [ ] **`webview.menu.download`**
  - **EN:** Download mind map & transcripts…
  - **KO:** 마인드맵 및 대화 기록 다운로드…

- [ ] **`webview.menu.model.default`**
  - **EN:** Default
  - **KO:** 기본값

- [ ] **`webview.menu.model.more`**
  - **EN:** More models…
  - **KO:** 더 많은 모델…

- [ ] **`webview.menu.preset.auto`**
  - **EN:** Follow editor
  - **KO:** 편집기 따르기

- [ ] **`webview.menu.preset.dark`**
  - **EN:** Dark
  - **KO:** 어둡게

- [ ] **`webview.menu.preset.light`**
  - **EN:** Light
  - **KO:** 밝게

- [ ] **`webview.menu.section.direction`**
  - **EN:** Layout direction
  - **KO:** 레이아웃 방향

- [ ] **`webview.menu.section.model`**
  - **EN:** Model
  - **KO:** 모델

- [ ] **`webview.menu.section.theme`**
  - **EN:** Theme
  - **KO:** 테마

## Sign-off

- [ ] Spot-checked in Extension Development Host with `agentMindmap.ui.locale` set to this locale.
- [ ] Updated [REVIEW-STATUS.md](./REVIEW-STATUS.md) for this locale.
