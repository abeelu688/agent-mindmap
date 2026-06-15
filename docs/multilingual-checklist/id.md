# Indonesian (id) — UI translation review

> Auto-generated from `extension/l10n/bundle.l10n.id.json`. Regenerate with `npm run checklist:l10n`.

| Field        | Value                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| Locale ID    | `id`                                                                             |
| Native name  | Bahasa Indonesia                                                                 |
| Bundle       | [`extension/l10n/bundle.l10n.id.json`](../../extension/l10n/bundle.l10n.id.json) |
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
  - **ID:** (Some topics have invalid conceptPath; re-open the session or run Analyze All Sessions with force re-analyze.)

- [ ] **`mindmap.concept.empty.noConceptPath`**
  - **EN:** (No topics with conceptPath in the library; re-open a session or run Analyze All Sessions with force re-analyze.)
  - **ID:** (No topics with conceptPath in the library; re-open a session or run Analyze All Sessions with force re-analyze.)

- [ ] **`mindmap.concept.empty.noSessions`**
  - **EN:** (No analyzed sessions in the library; run Open Latest Session or Analyze Project Sessions first.)
  - **ID:** (Tidak ada sesi yang dianalisis in the library; run Open Latest Session or Analyze Project Sessions first.)

- [ ] **`mindmap.concept.noDetails`**
  - **EN:** (No details)
  - **ID:** (Tidak ada detail)

- [ ] **`mindmap.concept.titleAll`**
  - **EN:** Concept Mind Map · All
  - **ID:** Mind Map Konsep · All

- [ ] **`mindmap.concept.uncategorized`**
  - **EN:** Uncategorized ({0})
  - **ID:** Tanpa kategori ({0})

## Merged mind map (`mindmap.merge`, 3 keys)

- [ ] **`mindmap.merge.empty.noSessions`**
  - **EN:** (No analyzed sessions in the library)
  - **ID:** (Tidak ada sesi yang dianalisis in the library)

- [ ] **`mindmap.merge.projectPrefix`**
  - **EN:** Project: {0}
  - **ID:** Project: {0}

- [ ] **`mindmap.merge.titleAll`**
  - **EN:** Agent Mind Map · All
  - **ID:** Agent Mind Map · All

## Turn view labels (`mindmap.turn`, 3 keys)

- [ ] **`mindmap.turn.conclusion`**
  - **EN:** Conclusion
  - **ID:** Kesimpulan

- [ ] **`mindmap.turn.research`**
  - **EN:** Research
  - **ID:** Riset

- [ ] **`mindmap.turn.sessionDefault`**
  - **EN:** Agent Session
  - **ID:** Sesi Agent

## Unexpected errors (`notify.unexpected`, 1 keys)

- [ ] **`notify.unexpected`**
  - **EN:** Agent Mind Map: An unexpected error occurred: {0}
  - **ID:** Agent Mind Map: Terjadi kesalahan tak terduga: {0}

## Batch analyze (`ui.batch`, 23 keys)

- [ ] **`ui.batch.emptyOnDisk`**
  - **EN:** Agent Mind Map: No agent transcripts found on disk for current project ({0}).
  - **ID:** Agent Mind Map: No agent transcripts found on disk for current project ({0}).

- [ ] **`ui.batch.failedSuffix`**
  - **EN:** {0} session(s) failed.
  - **ID:** {0} session(s) failed.

- [ ] **`ui.batch.item.cacheHit`**
  - **EN:** Cache hit
  - **ID:** Cache ditemukan

- [ ] **`ui.batch.item.done`**
  - **EN:** Analysis completed
  - **ID:** Analisis selesai

- [ ] **`ui.batch.item.failed`**
  - **EN:** Analysis failed
  - **ID:** Analisis gagal

- [ ] **`ui.batch.item.fallbackTurnView`**
  - **EN:** Fell back to chronological view
  - **ID:** Fell back to chronological view

- [ ] **`ui.batch.item.start`**
  - **EN:** Start analyzing
  - **ID:** Mulai analisis

- [ ] **`ui.batch.mode.force.desc`**
  - **EN:** Clear this project's library, merge snapshots, and ontology cache, then re-run the LLM for every session
  - **ID:** Clear this project's library, merge snapshots, and ontology cache, then re-run the LLM for every session

- [ ] **`ui.batch.mode.force.label`**
  - **EN:** Force re-analyze all
  - **ID:** Paksa analisis ulang semua

- [ ] **`ui.batch.mode.skipCached.desc`**
  - **EN:** Only analyze transcripts missing or stale in the library
  - **ID:** Only analyze transcripts missing or stale in the library

- [ ] **`ui.batch.mode.skipCached.label`**
  - **EN:** Skip cached sessions
  - **ID:** Lewati sesi cache

- [ ] **`ui.batch.noOntologyEquivalences`**
  - **EN:** Agent Mind Map: Concept synonym rules were not generated. Run Analyze All Sessions (Current Project) again for full merge.
  - **ID:** Agent Mind Map: Concept synonym rules were not generated. Run Analyze All Sessions (Current Project) again for full merge.

- [ ] **`ui.batch.noOntologyEquivalencesDisabled`**
  - **EN:** Agent Mind Map: Batch merge used mechanical path rules only. Enable agentMindmap.library.batchRefineOntology and run Analyze All Sessions again to refine synonyms.
  - **ID:** Agent Mind Map: Batch merge used mechanical path rules only. Enable agentMindmap.library.batchRefineOntology and run Analyze All Sessions again to refine synonyms.

- [ ] **`ui.batch.pickMode.placeholder`**
  - **EN:** Batch analyze agent sessions in current project
  - **ID:** Analisis batch agent sessions in current project

- [ ] **`ui.batch.progress.finalRefine`**
  - **EN:** Final concept synonym refine…
  - **ID:** Final concept synonym refine…

- [ ] **`ui.batch.progress.finished`**
  - **EN:** Batch finished: {0} total, {1} succeeded, {2} cached, {3} failed
  - **ID:** Batch finished: {0} total, {1} succeeded, {2} cached, {3} failed

- [ ] **`ui.batch.progress.mergingConceptMap`**
  - **EN:** Merging concept mind map (analyzed {0} session(s))…
  - **ID:** Menggabungkan mind map konsep (analyzed {0} session(s))…

- [ ] **`ui.batch.progress.refineOntology`**
  - **EN:** Refining concept synonyms (batch {0}, {1}/{2} sessions)…
  - **ID:** Refining concept synonyms (batch {0}, {1}/{2} sessions)…

- [ ] **`ui.batch.progress.scanSessions`**
  - **EN:** Scanning agent sessions for current project…
  - **ID:** Memindai sesi agent for current project…

- [ ] **`ui.batch.progress.start`**
  - **EN:** {0} session(s) total, starting batch analysis…
  - **ID:** {0} session(s) total, starting batch analysis…

- [ ] **`ui.batch.progress.title`**
  - **EN:** Agent Mind Map: Batch analyze & merge…
  - **ID:** Agent Mind Map: Analisis batch & merge…

- [ ] **`ui.batch.summary`**
  - **EN:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached.
  - **ID:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached.

- [ ] **`ui.batch.summary.withFailures`**
  - **EN:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached, {3} failed ({4}{5}).
  - **ID:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached, {3} failed ({4}{5}).

## Browse sessions (`ui.browse`, 1 keys)

- [ ] **`ui.browse.placeholder`**
  - **EN:** Pick an analyzed session to open (from library)
  - **ID:** Pick an analyzed session to open (from library)

## CLI install guide (`ui.cliInstall`, 15 keys)

- [ ] **`ui.cliInstall.action.copyCommand`**
  - **EN:** Copy install command
  - **ID:** Salin perintah instalasi

- [ ] **`ui.cliInstall.action.openDocs`**
  - **EN:** Open install docs
  - **ID:** Buka dokumentasi instalasi

- [ ] **`ui.cliInstall.action.openSettings`**
  - **EN:** Open CLI settings
  - **ID:** Buka pengaturan CLI

- [ ] **`ui.cliInstall.claude.installBody`**
  - **EN:** Follow the official guide: {0}
  - **ID:** Follow the official guide: {0}

- [ ] **`ui.cliInstall.copied`**
  - **EN:** Agent Mind Map: Install command copied to clipboard.
  - **ID:** Agent Mind Map: Install command disalin ke papan klip.

- [ ] **`ui.cliInstall.cursor.auth`**
  - **EN:** 3. First run may require sign-in: agent login (or follow the browser link).
  - **ID:** 3. First run may require sign-in: agent login (or follow the browser link).

- [ ] **`ui.cliInstall.cursor.installUnix`**
  - **EN:** In a terminal: {0}
  - **ID:** In a terminal: {0}

- [ ] **`ui.cliInstall.cursor.installWin`**
  - **EN:** In PowerShell: {0}
  - **ID:** In PowerShell: {0}

- [ ] **`ui.cliInstall.step.auth`**
  - **EN:** 3. Sign in if prompted (see the install guide for headless / CI auth).
  - **ID:** 3. Masuk jika diminta (see the install guide for headless / CI auth).

- [ ] **`ui.cliInstall.step.cliPath`**
  - **EN:** 4. If auto-detect still fails, set Settings → {0} to the full path of the agent or claude executable.
  - **ID:** 4. If auto-detect still fails, set Settings → {0} to the full path of the agent or claude executable.

- [ ] **`ui.cliInstall.step.install`**
  - **EN:** 1. Install the CLI
  - **ID:** 1. Instal CLI

- [ ] **`ui.cliInstall.step.libraryNote`**
  - **EN:** 5. Turn-only (chronological) views are not saved. Re-run batch analyze after the CLI works to build Concept Mind Map.
  - **ID:** 5. Turn-only (chronological) views are not saved. Re-run batch analyze after the CLI works to build Mind Map Konsep.

- [ ] **`ui.cliInstall.step.verify`**
  - **EN:** 2. Verify in a terminal: {0}
  - **ID:** 2. Verifikasi di terminal: {0}

- [ ] **`ui.cliInstall.summary.claude`**
  - **EN:** Agent Mind Map: Claude Code CLI not found — sessions cannot be saved to the library.
  - **ID:** Agent Mind Map: Claude Code CLI not found — sessions cannot be saved to the library.

- [ ] **`ui.cliInstall.summary.cursor`**
  - **EN:** Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library.
  - **ID:** Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library.

## Code references (`ui.codeRefs`, 1 keys)

- [ ] **`ui.codeRefs.pendingRefresh`**
  - **EN:** Agent Mind Map: Code descriptions are ready. Click Refresh in the mind map to update.
  - **ID:** Agent Mind Map: Code descriptions are ready. Click Refresh in the mind map to update.

## Commands (`ui.command`, 1 keys)

- [ ] **`ui.command.refresh.done`**
  - **EN:** Agent Mind Map refreshed.
  - **ID:** Agent Mind Map diperbarui.

## Concept path hints (`ui.concept`, 2 keys)

- [ ] **`ui.concept.noConceptPathAll`**
  - **EN:** Agent Mind Map: All topics in the library have no conceptPath (likely analyzed before upgrade). Re-open the session or run Analyze All Sessions with force re-analyze.
  - **ID:** Agent Mind Map: All topics in the library have no conceptPath (likely analyzed before upgrade). Re-open the session or run Analyze All Sessions with force re-analyze.

- [ ] **`ui.concept.someMissingConceptPath`**
  - **EN:** Agent Mind Map: {0} topic(s) missing conceptPath were placed under the “Uncategorized” branch.
  - **ID:** Agent Mind Map: {0} topic(s) missing conceptPath were placed under the “Tanpa kategori” branch.

## Debug commands (`ui.debug`, 6 keys)

- [ ] **`ui.debug.cursorOnly`**
  - **EN:** Agent Mind Map: This debug command is only available when agentMindmap.host is Cursor.
  - **ID:** Agent Mind Map: This debug command is only available when agentMindmap.host is Cursor.

- [ ] **`ui.debug.inspectComposer.pickSession.placeholder`**
  - **EN:** Pick a session to inspect its entry in composer.composerHeaders
  - **ID:** Pick a session to inspect its entry in composer.composerHeaders

- [ ] **`ui.debug.pickStateKey.placeholder`**
  - **EN:** Pick a state.vscdb key to view its full value
  - **ID:** Pick a state.vscdb key to view its full value

- [ ] **`ui.debug.stateKeyMissing`**
  - **EN:** Agent Mind Map: key {0} does not exist or failed to read.
  - **ID:** Agent Mind Map: key {0} does not exist or failed to read.

- [ ] **`ui.debug.testJump.pickSession.placeholder`**
  - **EN:** Pick a session as the simulated click target
  - **ID:** Pick a session as the simulated click target

- [ ] **`ui.debug.tryOpenShapes.placeholder`**
  - **EN:** Pick a session to debug glass.openAgentById argument shapes
  - **ID:** Pick a session to debug glass.openAgentById argument shapes

## Download & export (`ui.download`, 7 keys)

- [ ] **`ui.download.choice.openInBrowser`**
  - **EN:** Open in browser
  - **ID:** Buka di browser

- [ ] **`ui.download.choice.showInExplorer`**
  - **EN:** Show in file manager
  - **ID:** Tampilkan di pengelola file

- [ ] **`ui.download.exportFailed`**
  - **EN:** Agent Mind Map: Export failed: {0}
  - **ID:** Agent Mind Map: Ekspor gagal: {0}

- [ ] **`ui.download.exported.summary`**
  - **EN:** Exported mind map and {0} transcript(s) to the selected folder.
  - **ID:** Mind map dan {0} transkrip diekspor ke folder yang dipilih.

- [ ] **`ui.download.exporting.title`**
  - **EN:** Agent Mind Map: Exporting…
  - **ID:** Agent Mind Map: Mengekspor…

- [ ] **`ui.download.pickFolderLabel`**
  - **EN:** Select download folder
  - **ID:** Pilih folder unduhan

- [ ] **`ui.download.pickPackageFolderLabel`**
  - **EN:** Select offline package folder
  - **ID:** Pilih folder paket offline

## JSON export (`ui.exportJson`, 1 keys)

- [ ] **`ui.exportJson.exported`**
  - **EN:** Exported mind map to docs/agent-mindmaps/{0}
  - **ID:** Exported mind map to docs/agent-mindmaps/{0}

## Jump to transcript (`ui.jump`, 12 keys)

- [ ] **`ui.jump.diagnose.placeholder`**
  - **EN:** Found {0} command(s) (recorded to Mind Map logs)
  - **ID:** Found {0} command(s) (recorded to Mind Map logs)

- [ ] **`ui.jump.loading`**
  - **EN:** Loading transcript…
  - **ID:** Memuat transkrip…

- [ ] **`ui.jump.missingTranscriptPath`**
  - **EN:** Agent Mind Map: Cannot open transcript (missing transcript path).
  - **ID:** Agent Mind Map: Cannot open transcript (missing transcript path).

- [ ] **`ui.jump.openById.allFailed`**
  - **EN:** Agent Mind Map: Tried all shapes and none worked. Please check the logs.
  - **ID:** Agent Mind Map: Semua bentuk sudah dicoba dan tidak ada yang berhasil. Periksa log.

- [ ] **`ui.jump.openById.confirmNo`**
  - **EN:** ❌ No, try next
  - **ID:** ❌ Tidak, coba berikutnya

- [ ] **`ui.jump.openById.confirmYes`**
  - **EN:** ✅ Yes, stop
  - **ID:** ✅ Ya, berhenti

- [ ] **`ui.jump.openById.remembered`**
  - **EN:** Agent Mind Map: Remembered shape {0} (please send this back to the developer).
  - **ID:** Agent Mind Map: Remembered shape {0} (please send this back to the developer).

- [ ] **`ui.jump.openById.shapePrompt`**
  - **EN:** Agent Mind Map · Called {0} {1} → {2}. Did it open the correct Agent?
  - **ID:** Agent Mind Map · Memanggil {0} {1} → {2}. Apakah Agent yang benar terbuka?

- [ ] **`ui.jump.openByIdUnsupported`**
  - **EN:** Agent Mind Map: The current {0} environment does not support opening the native Agent panel by ID.
  - **ID:** Agent Mind Map: The current {0} environment does not support opening the native Agent panel by ID.

- [ ] **`ui.jump.openPicker.placeholder`**
  - **EN:** Select a session / question to open
  - **ID:** Pilih sesi / pertanyaan untuk dibuka

- [ ] **`ui.jump.qTagMissing`**
  - **EN:** Agent Mind Map: Q{0} referenced by this node does not exist in the current transcript ({1} user question(s) total). Opening the whole session instead.
  - **ID:** Agent Mind Map: Q{0} referenced by this node does not exist in the current transcript ({1} user question(s) total). Opening the whole session instead.

- [ ] **`ui.jump.readTranscriptFailed`**
  - **EN:** Agent Mind Map: Failed to read transcript: {0}
  - **ID:** Agent Mind Map: Failed to read transcript: {0}

## Library messages (`ui.library`, 5 keys)

- [ ] **`ui.library.empty.currentProject`**
  - **EN:** Agent Mind Map: No analyzed sessions in the library for current project ({0}).
  - **ID:** Agent Mind Map: Tidak ada sesi yang dianalisis in the library for current project ({0}).

- [ ] **`ui.library.empty.hint`**
  - **EN:** Agent Mind Map: Library is empty. Analyze at least one session first (e.g. “Open Latest Session”).
  - **ID:** Agent Mind Map: Pustaka kosong. Analyze at least one session first (e.g. “Open Latest Session”).

- [ ] **`ui.library.empty.llmTurnFallbackGeneric`**
  - **EN:** Agent Mind Map: LLM summarization failed for every session. Turn-only views are not saved to the library, so Concept Mind Map stays empty.
  - **ID:** Agent Mind Map: LLM summarization failed for every session. Turn-only views are not saved to the library, so Mind Map Konsep stays empty.

- [ ] **`ui.library.empty.noRecordsAfterAnalyze`**
  - **EN:** Agent Mind Map: After analysis, the library still has no usable records for current project ({0}).
  - **ID:** Agent Mind Map: After analysis, the library still has no usable records for current project ({0}).

- [ ] **`ui.library.merge.emptyResult`**
  - **EN:** Agent Mind Map: Merge result is empty for current project ({0}).
  - **ID:** Agent Mind Map: Merge result is empty for current project ({0}).

## LLM progress (`ui.llm`, 5 keys)

- [ ] **`ui.llm.attempt`**
  - **EN:** LLM attempt {0}/{1}…
  - **ID:** LLM attempt {0}/{1}…

- [ ] **`ui.llm.cacheHit`**
  - **EN:** LLM cache hit…
  - **ID:** LLM cache hit…

- [ ] **`ui.llm.failed.fallback`**
  - **EN:** Falling back to chronological view.
  - **ID:** Kembali ke tampilan kronologis.

- [ ] **`ui.llm.failed.message`**
  - **EN:** Agent Mind Map: LLM summarization failed ({0}). {1}
  - **ID:** Agent Mind Map: LLM summarization failed ({0}). {1}

- [ ] **`ui.llm.outline.heartbeat`**
  - **EN:** Generating outline…
  - **ID:** Generating outline…

## Loading states (`ui.loading`, 3 keys)

- [ ] **`ui.loading.forceReanalyzing`**
  - **EN:** Force re-analyzing…
  - **ID:** Paksa analisis ulang…

- [ ] **`ui.loading.preparing`**
  - **EN:** Understanding conversation…
  - **ID:** Memahami percakapan…

- [ ] **`ui.loading.transcriptUpdatedReanalyzing`**
  - **EN:** Transcript updated, re-analyzing…
  - **ID:** Transkrip diperbarui, menganalisis ulang…

## Merge scope & progress (`ui.merge`, 14 keys)

- [ ] **`ui.merge.cache.check`**
  - **EN:** Checking merge cache…
  - **ID:** Checking merge cache…

- [ ] **`ui.merge.cache.hitRender`**
  - **EN:** Merge cache hit, generating mind map…
  - **ID:** Merge cache hit, generating mind map…

- [ ] **`ui.merge.cache.write`**
  - **EN:** Writing merge cache…
  - **ID:** Writing merge cache…

- [ ] **`ui.merge.llm.heartbeat`**
  - **EN:** Calling LLM to merge topics…
  - **ID:** Calling LLM to merge topics…

- [ ] **`ui.merge.manualSelect.placeholder`**
  - **EN:** Select sessions to merge (all selected by default)
  - **ID:** Select sessions to merge (all selected by default)

- [ ] **`ui.merge.progress.preparing`**
  - **EN:** Preparing LLM merge…
  - **ID:** Preparing LLM merge…

- [ ] **`ui.merge.progress.title`**
  - **EN:** Agent Mind Map: Merging topics…
  - **ID:** Agent Mind Map: Merging topics…

- [ ] **`ui.merge.scope.all.desc`**
  - **EN:** Merge all sessions across all projects in the library
  - **ID:** Merge all sessions across all projects in the library

- [ ] **`ui.merge.scope.all.label`**
  - **EN:** All projects
  - **ID:** All projects

- [ ] **`ui.merge.scope.current.desc`**
  - **EN:** Merge all analyzed sessions from the current workspace
  - **ID:** Merge all analyzed sessions from the current workspace

- [ ] **`ui.merge.scope.current.label`**
  - **EN:** Current project ({0})
  - **ID:** Current project ({0})

- [ ] **`ui.merge.scope.placeholder`**
  - **EN:** Select LLM merge scope
  - **ID:** Select LLM merge scope

- [ ] **`ui.merge.scope.select.desc`**
  - **EN:** Choose sessions to include in the merge
  - **ID:** Choose sessions to include in the merge

- [ ] **`ui.merge.scope.select.label`**
  - **EN:** Select sessions…
  - **ID:** Select sessions…

## Ontology / concept cache (`ui.ontology`, 7 keys)

- [ ] **`ui.ontology.cache.check`**
  - **EN:** Checking concept ontology cache…
  - **ID:** Checking concept ontology cache…

- [ ] **`ui.ontology.cache.hit`**
  - **EN:** Concept ontology cache hit…
  - **ID:** Concept ontology cache hit…

- [ ] **`ui.ontology.cacheCleared`**
  - **EN:** Agent Mind Map: Cleared {0} ontology cache file(s). Next open of Concept Mind Map will re-extract and refine segment equivalences.
  - **ID:** Agent Mind Map: Cleared {0} ontology cache file(s). Next open of Mind Map Konsep will re-extract and refine segment equivalences.

- [ ] **`ui.ontology.extract`**
  - **EN:** Extracting concept ontology…
  - **ID:** Extracting concept ontology…

- [ ] **`ui.ontology.extract.heartbeat`**
  - **EN:** Extracting concept ontology…
  - **ID:** Extracting concept ontology…

- [ ] **`ui.ontology.refine.heartbeat`**
  - **EN:** Refining concept segment equivalences…
  - **ID:** Refining concept segment equivalences…

- [ ] **`ui.ontology.topicPaths.step`**
  - **EN:** Inferring topic paths ({0}/{1})…
  - **ID:** Inferring topic paths ({0}/{1})…

## Pick session (`ui.pickSession`, 1 keys)

- [ ] **`ui.pickSession.placeholder`**
  - **EN:** Select a {0} chat session
  - **ID:** Pilih sesi chat {0}

## Progress notifications (`ui.progress`, 15 keys)

- [ ] **`ui.progress.analyzingSession.title`**
  - **EN:** Agent Mind Map: Analyzing session…
  - **ID:** Agent Mind Map: Menganalisis sesi…

- [ ] **`ui.progress.applyConceptPaths`**
  - **EN:** Applying concept paths…
  - **ID:** Applying concept paths…

- [ ] **`ui.progress.batch.complete`**
  - **EN:** {0} · {1} (completed {2}/{3})
  - **ID:** {0} · {1} ({2}/{3} selesai)

- [ ] **`ui.progress.batch.header`**
  - **EN:** {0} · {1}
  - **ID:** {0} · {1}

- [ ] **`ui.progress.batch.position`**
  - **EN:** {0}/{1}
  - **ID:** {0}/{1}

- [ ] **`ui.progress.buildingMindMap.title`**
  - **EN:** Agent Mind Map: Building mind map…
  - **ID:** Agent Mind Map: Building mind map…

- [ ] **`ui.progress.cacheHitRender`**
  - **EN:** Cache hit, generating mind map…
  - **ID:** Cache ditemukan, generating mind map…

- [ ] **`ui.progress.checkLibraryCache`**
  - **EN:** Checking library cache…
  - **ID:** Memeriksa cache pustaka…

- [ ] **`ui.progress.generateMindMap`**
  - **EN:** Generating mind map…
  - **ID:** Membuat mind map…

- [ ] **`ui.progress.heartbeat.wait`**
  - **EN:** {0} (waiting {1} second(s))
  - **ID:** {0} (menunggu {1} detik)

- [ ] **`ui.progress.loadLibrary`**
  - **EN:** Loading analysis library…
  - **ID:** Memuat pustaka analisis…

- [ ] **`ui.progress.preparingMindMap`**
  - **EN:** Preparing mind map…
  - **ID:** Menyiapkan mind map…

- [ ] **`ui.progress.readTranscript`**
  - **EN:** Reading transcript…
  - **ID:** Membaca transkrip…

- [ ] **`ui.progress.renderMindMap`**
  - **EN:** Rendering mind map…
  - **ID:** Merender mind map…

- [ ] **`ui.progress.writeLibrary`**
  - **EN:** Writing to library…
  - **ID:** Menulis ke pustaka…

## Search (`ui.search`, 1 keys)

- [ ] **`ui.search.placeholder`**
  - **EN:** Search topics, titles, and keywords…
  - **ID:** Cari topik, judul, dan kata kunci…

## Model picker (`ui.selectModel`, 4 keys)

- [ ] **`ui.selectModel.applied`**
  - **EN:** Agent Mind Map: Model set to {0}.
  - **ID:** Agent Mind Map: Model diatur ke {0}.

- [ ] **`ui.selectModel.custom.label`**
  - **EN:** Custom model name…
  - **ID:** Nama model kustom…

- [ ] **`ui.selectModel.custom.placeholder`**
  - **EN:** Model name (e.g. claude-sonnet-4-6)
  - **ID:** Model name (e.g. claude-sonnet-4-6)

- [ ] **`ui.selectModel.placeholder`**
  - **EN:** Select a model for LLM requests
  - **ID:** Pilih model untuk permintaan LLM

## UI settings (`ui.uiSetting`, 1 keys)

- [ ] **`ui.uiSetting.noWorkspace`**
  - **EN:** Agent Mind Map: Open a workspace folder first to write UI settings into .vscode/settings.json.
  - **ID:** Agent Mind Map: Buka folder workspace terlebih dahulu to write UI settings into .vscode/settings.json.

## Warnings (`ui.warning`, 2 keys)

- [ ] **`ui.warning.openMindMapFirst`**
  - **EN:** Agent Mind Map: Open a mind map first.
  - **ID:** Agent Mind Map: Buka mind map terlebih dahulu.

- [ ] **`ui.warning.openWorkspaceFolderFirst`**
  - **EN:** Agent Mind Map: Open a workspace folder first.
  - **ID:** Agent Mind Map: Buka folder workspace terlebih dahulu.

## Webview loading (`webview.loading`, 1 keys)

- [ ] **`webview.loading.title`**
  - **EN:** Generating mind map…
  - **ID:** Membuat mind map…

## Webview context menu (`webview.menu`, 13 keys)

- [ ] **`webview.menu.direction.left`**
  - **EN:** Left
  - **ID:** Kiri

- [ ] **`webview.menu.direction.right`**
  - **EN:** Right
  - **ID:** Kanan

- [ ] **`webview.menu.direction.side`**
  - **EN:** Both sides (right then left)
  - **ID:** Kedua sisi (right then left)

- [ ] **`webview.menu.direction.sideLr`**
  - **EN:** Both sides (left then right)
  - **ID:** Kedua sisi (left then right)

- [ ] **`webview.menu.download`**
  - **EN:** Download mind map & transcripts…
  - **ID:** Unduh mind map & transkrip…

- [ ] **`webview.menu.model.default`**
  - **EN:** Default
  - **ID:** Default

- [ ] **`webview.menu.model.more`**
  - **EN:** More models…
  - **ID:** Model lainnya…

- [ ] **`webview.menu.preset.auto`**
  - **EN:** Follow editor
  - **ID:** Ikuti editor

- [ ] **`webview.menu.preset.dark`**
  - **EN:** Dark
  - **ID:** Gelap

- [ ] **`webview.menu.preset.light`**
  - **EN:** Light
  - **ID:** Terang

- [ ] **`webview.menu.section.direction`**
  - **EN:** Layout direction
  - **ID:** Arah tata letak

- [ ] **`webview.menu.section.model`**
  - **EN:** Model
  - **ID:** Model

- [ ] **`webview.menu.section.theme`**
  - **EN:** Theme
  - **ID:** Tema

## Sign-off

- [ ] Spot-checked in Extension Development Host with `agentMindmap.ui.locale` set to this locale.
- [ ] Updated [REVIEW-STATUS.md](./REVIEW-STATUS.md) for this locale.
