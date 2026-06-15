# German (de) — UI translation review

> Auto-generated from `extension/l10n/bundle.l10n.de.json`. Regenerate with `npm run checklist:l10n`.

| Field        | Value                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| Locale ID    | `de`                                                                             |
| Native name  | Deutsch                                                                          |
| Bundle       | [`extension/l10n/bundle.l10n.de.json`](../../extension/l10n/bundle.l10n.de.json) |
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
  - **DE:** (Some topics have invalid conceptPath; re-open the session or run Analyze All Sessions with force re-analyze.)

- [ ] **`mindmap.concept.empty.noConceptPath`**
  - **EN:** (No topics with conceptPath in the library; re-open a session or run Analyze All Sessions with force re-analyze.)
  - **DE:** (No topics with conceptPath in the library; re-open a session or run Analyze All Sessions with force re-analyze.)

- [ ] **`mindmap.concept.empty.noSessions`**
  - **EN:** (No analyzed sessions in the library; run Open Latest Session or Analyze Project Sessions first.)
  - **DE:** (Keine analysierten Sitzungen in the library; run Open Latest Session or Analyze Project Sessions first.)

- [ ] **`mindmap.concept.noDetails`**
  - **EN:** (No details)
  - **DE:** (Keine Details)

- [ ] **`mindmap.concept.titleAll`**
  - **EN:** Concept Mind Map · All
  - **DE:** Konzept-Mindmap · All

- [ ] **`mindmap.concept.uncategorized`**
  - **EN:** Uncategorized ({0})
  - **DE:** Nicht kategorisiert ({0})

## Merged mind map (`mindmap.merge`, 3 keys)

- [ ] **`mindmap.merge.empty.noSessions`**
  - **EN:** (No analyzed sessions in the library)
  - **DE:** (Keine analysierten Sitzungen in the library)

- [ ] **`mindmap.merge.projectPrefix`**
  - **EN:** Project: {0}
  - **DE:** Project: {0}

- [ ] **`mindmap.merge.titleAll`**
  - **EN:** Agent Mind Map · All
  - **DE:** Agent Mind Map · All

## Turn view labels (`mindmap.turn`, 3 keys)

- [ ] **`mindmap.turn.conclusion`**
  - **EN:** Conclusion
  - **DE:** Fazit

- [ ] **`mindmap.turn.research`**
  - **EN:** Research
  - **DE:** Recherche

- [ ] **`mindmap.turn.sessionDefault`**
  - **EN:** Agent Session
  - **DE:** Agent-Sitzung

## Unexpected errors (`notify.unexpected`, 1 keys)

- [ ] **`notify.unexpected`**
  - **EN:** Agent Mind Map: An unexpected error occurred: {0}
  - **DE:** Agent Mind Map: Ein unerwarteter Fehler ist aufgetreten: {0}

## Batch analyze (`ui.batch`, 23 keys)

- [ ] **`ui.batch.emptyOnDisk`**
  - **EN:** Agent Mind Map: No agent transcripts found on disk for current project ({0}).
  - **DE:** Agent Mind Map: No agent transcripts found on disk for current project ({0}).

- [ ] **`ui.batch.failedSuffix`**
  - **EN:** {0} session(s) failed.
  - **DE:** {0} session(s) failed.

- [ ] **`ui.batch.item.cacheHit`**
  - **EN:** Cache hit
  - **DE:** Cache-Treffer

- [ ] **`ui.batch.item.done`**
  - **EN:** Analysis completed
  - **DE:** Analyse abgeschlossen

- [ ] **`ui.batch.item.failed`**
  - **EN:** Analysis failed
  - **DE:** Analyse fehlgeschlagen

- [ ] **`ui.batch.item.fallbackTurnView`**
  - **EN:** Fell back to chronological view
  - **DE:** Fell back to chronological view

- [ ] **`ui.batch.item.start`**
  - **EN:** Start analyzing
  - **DE:** Analyse starten

- [ ] **`ui.batch.mode.force.desc`**
  - **EN:** Clear this project's library, merge snapshots, and ontology cache, then re-run the LLM for every session
  - **DE:** Clear this project's library, merge snapshots, and ontology cache, then re-run the LLM for every session

- [ ] **`ui.batch.mode.force.label`**
  - **EN:** Force re-analyze all
  - **DE:** Alle erneut analysieren

- [ ] **`ui.batch.mode.skipCached.desc`**
  - **EN:** Only analyze transcripts missing or stale in the library
  - **DE:** Only analyze transcripts missing or stale in the library

- [ ] **`ui.batch.mode.skipCached.label`**
  - **EN:** Skip cached sessions
  - **DE:** Zwischengespeicherte Sitzungen überspringen

- [ ] **`ui.batch.noOntologyEquivalences`**
  - **EN:** Agent Mind Map: Concept synonym rules were not generated. Run Analyze All Sessions (Current Project) again for full merge.
  - **DE:** Agent Mind Map: Concept synonym rules were not generated. Run Analyze All Sessions (Current Project) again for full merge.

- [ ] **`ui.batch.noOntologyEquivalencesDisabled`**
  - **EN:** Agent Mind Map: Batch merge used mechanical path rules only. Enable agentMindmap.library.batchRefineOntology and run Analyze All Sessions again to refine synonyms.
  - **DE:** Agent Mind Map: Batch merge used mechanical path rules only. Enable agentMindmap.library.batchRefineOntology and run Analyze All Sessions again to refine synonyms.

- [ ] **`ui.batch.pickMode.placeholder`**
  - **EN:** Batch analyze agent sessions in current project
  - **DE:** Stapelanalyse agent sessions in current project

- [ ] **`ui.batch.progress.finalRefine`**
  - **EN:** Final concept synonym refine…
  - **DE:** Final concept synonym refine…

- [ ] **`ui.batch.progress.finished`**
  - **EN:** Batch finished: {0} total, {1} succeeded, {2} cached, {3} failed
  - **DE:** Batch finished: {0} total, {1} succeeded, {2} cached, {3} failed

- [ ] **`ui.batch.progress.mergingConceptMap`**
  - **EN:** Merging concept mind map (analyzed {0} session(s))…
  - **DE:** Konzept-Mindmap wird zusammengeführt (analyzed {0} session(s))…

- [ ] **`ui.batch.progress.refineOntology`**
  - **EN:** Refining concept synonyms (batch {0}, {1}/{2} sessions)…
  - **DE:** Refining concept synonyms (batch {0}, {1}/{2} sessions)…

- [ ] **`ui.batch.progress.scanSessions`**
  - **EN:** Scanning agent sessions for current project…
  - **DE:** Agent-Sitzungen werden gescannt for current project…

- [ ] **`ui.batch.progress.start`**
  - **EN:** {0} session(s) total, starting batch analysis…
  - **DE:** {0} session(s) total, starting batch analysis…

- [ ] **`ui.batch.progress.title`**
  - **EN:** Agent Mind Map: Batch analyze & merge…
  - **DE:** Agent Mind Map: Stapelanalyse & merge…

- [ ] **`ui.batch.summary`**
  - **EN:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached.
  - **DE:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached.

- [ ] **`ui.batch.summary.withFailures`**
  - **EN:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached, {3} failed ({4}{5}).
  - **DE:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached, {3} failed ({4}{5}).

## Browse sessions (`ui.browse`, 1 keys)

- [ ] **`ui.browse.placeholder`**
  - **EN:** Pick an analyzed session to open (from library)
  - **DE:** Pick an analyzed session to open (from library)

## CLI install guide (`ui.cliInstall`, 15 keys)

- [ ] **`ui.cliInstall.action.copyCommand`**
  - **EN:** Copy install command
  - **DE:** Installationsbefehl kopieren

- [ ] **`ui.cliInstall.action.openDocs`**
  - **EN:** Open install docs
  - **DE:** Installationsdokumentation öffnen

- [ ] **`ui.cliInstall.action.openSettings`**
  - **EN:** Open CLI settings
  - **DE:** CLI-Einstellungen öffnen

- [ ] **`ui.cliInstall.claude.installBody`**
  - **EN:** Follow the official guide: {0}
  - **DE:** Follow the official guide: {0}

- [ ] **`ui.cliInstall.copied`**
  - **EN:** Agent Mind Map: Install command copied to clipboard.
  - **DE:** Agent Mind Map: Install command in die Zwischenablage kopiert.

- [ ] **`ui.cliInstall.cursor.auth`**
  - **EN:** 3. First run may require sign-in: agent login (or follow the browser link).
  - **DE:** 3. First run may require sign-in: agent login (or follow the browser link).

- [ ] **`ui.cliInstall.cursor.installUnix`**
  - **EN:** In a terminal: {0}
  - **DE:** In a terminal: {0}

- [ ] **`ui.cliInstall.cursor.installWin`**
  - **EN:** In PowerShell: {0}
  - **DE:** In PowerShell: {0}

- [ ] **`ui.cliInstall.step.auth`**
  - **EN:** 3. Sign in if prompted (see the install guide for headless / CI auth).
  - **DE:** 3. Bei Aufforderung anmelden (see the install guide for headless / CI auth).

- [ ] **`ui.cliInstall.step.cliPath`**
  - **EN:** 4. If auto-detect still fails, set Settings → {0} to the full path of the agent or claude executable.
  - **DE:** 4. If auto-detect still fails, set Settings → {0} to the full path of the agent or claude executable.

- [ ] **`ui.cliInstall.step.install`**
  - **EN:** 1. Install the CLI
  - **DE:** 1. CLI installieren

- [ ] **`ui.cliInstall.step.libraryNote`**
  - **EN:** 5. Turn-only (chronological) views are not saved. Re-run batch analyze after the CLI works to build Concept Mind Map.
  - **DE:** 5. Turn-only (chronological) views are not saved. Re-run batch analyze after the CLI works to build Konzept-Mindmap.

- [ ] **`ui.cliInstall.step.verify`**
  - **EN:** 2. Verify in a terminal: {0}
  - **DE:** 2. Im Terminal prüfen: {0}

- [ ] **`ui.cliInstall.summary.claude`**
  - **EN:** Agent Mind Map: Claude Code CLI not found — sessions cannot be saved to the library.
  - **DE:** Agent Mind Map: Claude Code CLI not found — sessions cannot be saved to the library.

- [ ] **`ui.cliInstall.summary.cursor`**
  - **EN:** Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library.
  - **DE:** Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library.

## Code references (`ui.codeRefs`, 1 keys)

- [ ] **`ui.codeRefs.pendingRefresh`**
  - **EN:** Agent Mind Map: Code descriptions are ready. Click Refresh in the mind map to update.
  - **DE:** Agent Mind Map: Code descriptions are ready. Click Refresh in the mind map to update.

## Commands (`ui.command`, 1 keys)

- [ ] **`ui.command.refresh.done`**
  - **EN:** Agent Mind Map refreshed.
  - **DE:** Agent Mind Map aktualisiert.

## Concept path hints (`ui.concept`, 2 keys)

- [ ] **`ui.concept.noConceptPathAll`**
  - **EN:** Agent Mind Map: All topics in the library have no conceptPath (likely analyzed before upgrade). Re-open the session or run Analyze All Sessions with force re-analyze.
  - **DE:** Agent Mind Map: All topics in the library have no conceptPath (likely analyzed before upgrade). Re-open the session or run Analyze All Sessions with force re-analyze.

- [ ] **`ui.concept.someMissingConceptPath`**
  - **EN:** Agent Mind Map: {0} topic(s) missing conceptPath were placed under the “Uncategorized” branch.
  - **DE:** Agent Mind Map: {0} topic(s) missing conceptPath were placed under the “Nicht kategorisiert” branch.

## Debug commands (`ui.debug`, 6 keys)

- [ ] **`ui.debug.cursorOnly`**
  - **EN:** Agent Mind Map: This debug command is only available when agentMindmap.host is Cursor.
  - **DE:** Agent Mind Map: This debug command is only available when agentMindmap.host is Cursor.

- [ ] **`ui.debug.inspectComposer.pickSession.placeholder`**
  - **EN:** Pick a session to inspect its entry in composer.composerHeaders
  - **DE:** Pick a session to inspect its entry in composer.composerHeaders

- [ ] **`ui.debug.pickStateKey.placeholder`**
  - **EN:** Pick a state.vscdb key to view its full value
  - **DE:** Pick a state.vscdb key to view its full value

- [ ] **`ui.debug.stateKeyMissing`**
  - **EN:** Agent Mind Map: key {0} does not exist or failed to read.
  - **DE:** Agent Mind Map: key {0} does not exist or failed to read.

- [ ] **`ui.debug.testJump.pickSession.placeholder`**
  - **EN:** Pick a session as the simulated click target
  - **DE:** Pick a session as the simulated click target

- [ ] **`ui.debug.tryOpenShapes.placeholder`**
  - **EN:** Pick a session to debug glass.openAgentById argument shapes
  - **DE:** Pick a session to debug glass.openAgentById argument shapes

## Download & export (`ui.download`, 7 keys)

- [ ] **`ui.download.choice.openInBrowser`**
  - **EN:** Open in browser
  - **DE:** Im Browser öffnen

- [ ] **`ui.download.choice.showInExplorer`**
  - **EN:** Show in file manager
  - **DE:** Im Dateimanager anzeigen

- [ ] **`ui.download.exportFailed`**
  - **EN:** Agent Mind Map: Export failed: {0}
  - **DE:** Agent Mind Map: Export fehlgeschlagen: {0}

- [ ] **`ui.download.exported.summary`**
  - **EN:** Exported mind map and {0} transcript(s) to the selected folder.
  - **DE:** Mindmap und {0} Transkript(e) wurden in den ausgewählten Ordner exportiert.

- [ ] **`ui.download.exporting.title`**
  - **EN:** Agent Mind Map: Exporting…
  - **DE:** Agent Mind Map: Export wird ausgeführt…

- [ ] **`ui.download.pickFolderLabel`**
  - **EN:** Select download folder
  - **DE:** Download-Ordner auswählen

- [ ] **`ui.download.pickPackageFolderLabel`**
  - **EN:** Select offline package folder
  - **DE:** Offline-Paketordner auswählen

## JSON export (`ui.exportJson`, 1 keys)

- [ ] **`ui.exportJson.exported`**
  - **EN:** Exported mind map to docs/agent-mindmaps/{0}
  - **DE:** Exported mind map to docs/agent-mindmaps/{0}

## Jump to transcript (`ui.jump`, 12 keys)

- [ ] **`ui.jump.diagnose.placeholder`**
  - **EN:** Found {0} command(s) (recorded to Mind Map logs)
  - **DE:** Found {0} command(s) (recorded to Mind Map logs)

- [ ] **`ui.jump.loading`**
  - **EN:** Loading transcript…
  - **DE:** Transkript wird geladen…

- [ ] **`ui.jump.missingTranscriptPath`**
  - **EN:** Agent Mind Map: Cannot open transcript (missing transcript path).
  - **DE:** Agent Mind Map: Cannot open transcript (missing transcript path).

- [ ] **`ui.jump.openById.allFailed`**
  - **EN:** Agent Mind Map: Tried all shapes and none worked. Please check the logs.
  - **DE:** Agent Mind Map: Alle Formen wurden versucht, keine funktionierte. Bitte prüfen Sie die Logs.

- [ ] **`ui.jump.openById.confirmNo`**
  - **EN:** ❌ No, try next
  - **DE:** ❌ Nein, nächsten versuchen

- [ ] **`ui.jump.openById.confirmYes`**
  - **EN:** ✅ Yes, stop
  - **DE:** ✅ Ja, stoppen

- [ ] **`ui.jump.openById.remembered`**
  - **EN:** Agent Mind Map: Remembered shape {0} (please send this back to the developer).
  - **DE:** Agent Mind Map: Remembered shape {0} (please send this back to the developer).

- [ ] **`ui.jump.openById.shapePrompt`**
  - **EN:** Agent Mind Map · Called {0} {1} → {2}. Did it open the correct Agent?
  - **DE:** Agent Mind Map · {0} {1} → {2} wurde aufgerufen. Wurde der richtige Agent geöffnet?

- [ ] **`ui.jump.openByIdUnsupported`**
  - **EN:** Agent Mind Map: The current {0} environment does not support opening the native Agent panel by ID.
  - **DE:** Agent Mind Map: The current {0} environment does not support opening the native Agent panel by ID.

- [ ] **`ui.jump.openPicker.placeholder`**
  - **EN:** Select a session / question to open
  - **DE:** Sitzung / Frage zum Öffnen auswählen

- [ ] **`ui.jump.qTagMissing`**
  - **EN:** Agent Mind Map: Q{0} referenced by this node does not exist in the current transcript ({1} user question(s) total). Opening the whole session instead.
  - **DE:** Agent Mind Map: Q{0} referenced by this node does not exist in the current transcript ({1} user question(s) total). Opening the whole session instead.

- [ ] **`ui.jump.readTranscriptFailed`**
  - **EN:** Agent Mind Map: Failed to read transcript: {0}
  - **DE:** Agent Mind Map: Failed to read transcript: {0}

## Library messages (`ui.library`, 5 keys)

- [ ] **`ui.library.empty.currentProject`**
  - **EN:** Agent Mind Map: No analyzed sessions in the library for current project ({0}).
  - **DE:** Agent Mind Map: Keine analysierten Sitzungen in the library for current project ({0}).

- [ ] **`ui.library.empty.hint`**
  - **EN:** Agent Mind Map: Library is empty. Analyze at least one session first (e.g. “Open Latest Session”).
  - **DE:** Agent Mind Map: Die Bibliothek ist leer. Analyze at least one session first (e.g. “Open Latest Session”).

- [ ] **`ui.library.empty.llmTurnFallbackGeneric`**
  - **EN:** Agent Mind Map: LLM summarization failed for every session. Turn-only views are not saved to the library, so Concept Mind Map stays empty.
  - **DE:** Agent Mind Map: LLM summarization failed for every session. Turn-only views are not saved to the library, so Konzept-Mindmap stays empty.

- [ ] **`ui.library.empty.noRecordsAfterAnalyze`**
  - **EN:** Agent Mind Map: After analysis, the library still has no usable records for current project ({0}).
  - **DE:** Agent Mind Map: After analysis, the library still has no usable records for current project ({0}).

- [ ] **`ui.library.merge.emptyResult`**
  - **EN:** Agent Mind Map: Merge result is empty for current project ({0}).
  - **DE:** Agent Mind Map: Merge result is empty for current project ({0}).

## LLM progress (`ui.llm`, 5 keys)

- [ ] **`ui.llm.attempt`**
  - **EN:** LLM attempt {0}/{1}…
  - **DE:** LLM attempt {0}/{1}…

- [ ] **`ui.llm.cacheHit`**
  - **EN:** LLM cache hit…
  - **DE:** LLM cache hit…

- [ ] **`ui.llm.failed.fallback`**
  - **EN:** Falling back to chronological view.
  - **DE:** Wechsel zur chronologischen Ansicht.

- [ ] **`ui.llm.failed.message`**
  - **EN:** Agent Mind Map: LLM summarization failed ({0}). {1}
  - **DE:** Agent Mind Map: LLM summarization failed ({0}). {1}

- [ ] **`ui.llm.outline.heartbeat`**
  - **EN:** Generating outline…
  - **DE:** Generating outline…

## Loading states (`ui.loading`, 3 keys)

- [ ] **`ui.loading.forceReanalyzing`**
  - **EN:** Force re-analyzing…
  - **DE:** Erneute Analyse erzwingen…

- [ ] **`ui.loading.preparing`**
  - **EN:** Understanding conversation…
  - **DE:** Unterhaltung wird verstanden…

- [ ] **`ui.loading.transcriptUpdatedReanalyzing`**
  - **EN:** Transcript updated, re-analyzing…
  - **DE:** Transkript aktualisiert, erneute Analyse…

## Merge scope & progress (`ui.merge`, 14 keys)

- [ ] **`ui.merge.cache.check`**
  - **EN:** Checking merge cache…
  - **DE:** Checking merge cache…

- [ ] **`ui.merge.cache.hitRender`**
  - **EN:** Merge cache hit, generating mind map…
  - **DE:** Merge cache hit, generating mind map…

- [ ] **`ui.merge.cache.write`**
  - **EN:** Writing merge cache…
  - **DE:** Writing merge cache…

- [ ] **`ui.merge.llm.heartbeat`**
  - **EN:** Calling LLM to merge topics…
  - **DE:** Calling LLM to merge topics…

- [ ] **`ui.merge.manualSelect.placeholder`**
  - **EN:** Select sessions to merge (all selected by default)
  - **DE:** Select sessions to merge (all selected by default)

- [ ] **`ui.merge.progress.preparing`**
  - **EN:** Preparing LLM merge…
  - **DE:** Preparing LLM merge…

- [ ] **`ui.merge.progress.title`**
  - **EN:** Agent Mind Map: Merging topics…
  - **DE:** Agent Mind Map: Merging topics…

- [ ] **`ui.merge.scope.all.desc`**
  - **EN:** Merge all sessions across all projects in the library
  - **DE:** Merge all sessions across all projects in the library

- [ ] **`ui.merge.scope.all.label`**
  - **EN:** All projects
  - **DE:** All projects

- [ ] **`ui.merge.scope.current.desc`**
  - **EN:** Merge all analyzed sessions from the current workspace
  - **DE:** Merge all analyzed sessions from the current workspace

- [ ] **`ui.merge.scope.current.label`**
  - **EN:** Current project ({0})
  - **DE:** Current project ({0})

- [ ] **`ui.merge.scope.placeholder`**
  - **EN:** Select LLM merge scope
  - **DE:** Select LLM merge scope

- [ ] **`ui.merge.scope.select.desc`**
  - **EN:** Choose sessions to include in the merge
  - **DE:** Choose sessions to include in the merge

- [ ] **`ui.merge.scope.select.label`**
  - **EN:** Select sessions…
  - **DE:** Select sessions…

## Ontology / concept cache (`ui.ontology`, 7 keys)

- [ ] **`ui.ontology.cache.check`**
  - **EN:** Checking concept ontology cache…
  - **DE:** Checking concept ontology cache…

- [ ] **`ui.ontology.cache.hit`**
  - **EN:** Concept ontology cache hit…
  - **DE:** Concept ontology cache hit…

- [ ] **`ui.ontology.cacheCleared`**
  - **EN:** Agent Mind Map: Cleared {0} ontology cache file(s). Next open of Concept Mind Map will re-extract and refine segment equivalences.
  - **DE:** Agent Mind Map: Cleared {0} ontology cache file(s). Next open of Konzept-Mindmap will re-extract and refine segment equivalences.

- [ ] **`ui.ontology.extract`**
  - **EN:** Extracting concept ontology…
  - **DE:** Extracting concept ontology…

- [ ] **`ui.ontology.extract.heartbeat`**
  - **EN:** Extracting concept ontology…
  - **DE:** Extracting concept ontology…

- [ ] **`ui.ontology.refine.heartbeat`**
  - **EN:** Refining concept segment equivalences…
  - **DE:** Refining concept segment equivalences…

- [ ] **`ui.ontology.topicPaths.step`**
  - **EN:** Inferring topic paths ({0}/{1})…
  - **DE:** Inferring topic paths ({0}/{1})…

## Pick session (`ui.pickSession`, 1 keys)

- [ ] **`ui.pickSession.placeholder`**
  - **EN:** Select a {0} chat session
  - **DE:** {0}-Chat-Sitzung auswählen

## Progress notifications (`ui.progress`, 15 keys)

- [ ] **`ui.progress.analyzingSession.title`**
  - **EN:** Agent Mind Map: Analyzing session…
  - **DE:** Agent Mind Map: Sitzung wird analysiert…

- [ ] **`ui.progress.applyConceptPaths`**
  - **EN:** Applying concept paths…
  - **DE:** Applying concept paths…

- [ ] **`ui.progress.batch.complete`**
  - **EN:** {0} · {1} (completed {2}/{3})
  - **DE:** {0} · {1} ({2}/{3} abgeschlossen)

- [ ] **`ui.progress.batch.header`**
  - **EN:** {0} · {1}
  - **DE:** {0} · {1}

- [ ] **`ui.progress.batch.position`**
  - **EN:** {0}/{1}
  - **DE:** {0}/{1}

- [ ] **`ui.progress.buildingMindMap.title`**
  - **EN:** Agent Mind Map: Building mind map…
  - **DE:** Agent Mind Map: Building mind map…

- [ ] **`ui.progress.cacheHitRender`**
  - **EN:** Cache hit, generating mind map…
  - **DE:** Cache-Treffer, generating mind map…

- [ ] **`ui.progress.checkLibraryCache`**
  - **EN:** Checking library cache…
  - **DE:** Bibliothekscache wird geprüft…

- [ ] **`ui.progress.generateMindMap`**
  - **EN:** Generating mind map…
  - **DE:** Mindmap wird generiert…

- [ ] **`ui.progress.heartbeat.wait`**
  - **EN:** {0} (waiting {1} second(s))
  - **DE:** {0} (warte {1} Sekunde(n))

- [ ] **`ui.progress.loadLibrary`**
  - **EN:** Loading analysis library…
  - **DE:** Analysebibliothek wird geladen…

- [ ] **`ui.progress.preparingMindMap`**
  - **EN:** Preparing mind map…
  - **DE:** Mindmap wird vorbereitet…

- [ ] **`ui.progress.readTranscript`**
  - **EN:** Reading transcript…
  - **DE:** Transkript wird gelesen…

- [ ] **`ui.progress.renderMindMap`**
  - **EN:** Rendering mind map…
  - **DE:** Mindmap wird gerendert…

- [ ] **`ui.progress.writeLibrary`**
  - **EN:** Writing to library…
  - **DE:** In Bibliothek schreiben…

## Search (`ui.search`, 1 keys)

- [ ] **`ui.search.placeholder`**
  - **EN:** Search topics, titles, and keywords…
  - **DE:** Designn, Titel und Schlüsselwörter suchen…

## Model picker (`ui.selectModel`, 4 keys)

- [ ] **`ui.selectModel.applied`**
  - **EN:** Agent Mind Map: Model set to {0}.
  - **DE:** Agent Mind Map: Modell set to {0}.

- [ ] **`ui.selectModel.custom.label`**
  - **EN:** Custom model name…
  - **DE:** Benutzerdefinierter Modellname…

- [ ] **`ui.selectModel.custom.placeholder`**
  - **EN:** Model name (e.g. claude-sonnet-4-6)
  - **DE:** Modell name (e.g. claude-sonnet-4-6)

- [ ] **`ui.selectModel.placeholder`**
  - **EN:** Select a model for LLM requests
  - **DE:** Modell für LLM-Anfragen auswählen

## UI settings (`ui.uiSetting`, 1 keys)

- [ ] **`ui.uiSetting.noWorkspace`**
  - **EN:** Agent Mind Map: Open a workspace folder first to write UI settings into .vscode/settings.json.
  - **DE:** Agent Mind Map: Öffnen Sie zuerst einen Workspace-Ordner to write UI settings into .vscode/settings.json.

## Warnings (`ui.warning`, 2 keys)

- [ ] **`ui.warning.openMindMapFirst`**
  - **EN:** Agent Mind Map: Open a mind map first.
  - **DE:** Agent Mind Map: Öffnen Sie zuerst eine Mindmap.

- [ ] **`ui.warning.openWorkspaceFolderFirst`**
  - **EN:** Agent Mind Map: Open a workspace folder first.
  - **DE:** Agent Mind Map: Öffnen Sie zuerst einen Workspace-Ordner.

## Webview loading (`webview.loading`, 1 keys)

- [ ] **`webview.loading.title`**
  - **EN:** Generating mind map…
  - **DE:** Mindmap wird generiert…

## Webview context menu (`webview.menu`, 13 keys)

- [ ] **`webview.menu.direction.left`**
  - **EN:** Left
  - **DE:** Links

- [ ] **`webview.menu.direction.right`**
  - **EN:** Right
  - **DE:** Rechts

- [ ] **`webview.menu.direction.side`**
  - **EN:** Both sides (right then left)
  - **DE:** Beide Seiten (right then left)

- [ ] **`webview.menu.direction.sideLr`**
  - **EN:** Both sides (left then right)
  - **DE:** Beide Seiten (left then right)

- [ ] **`webview.menu.download`**
  - **EN:** Download mind map & transcripts…
  - **DE:** Mindmap und Transkripte herunterladen…

- [ ] **`webview.menu.model.default`**
  - **EN:** Default
  - **DE:** Standard

- [ ] **`webview.menu.model.more`**
  - **EN:** More models…
  - **DE:** Weitere Modelle…

- [ ] **`webview.menu.preset.auto`**
  - **EN:** Follow editor
  - **DE:** Editor folgen

- [ ] **`webview.menu.preset.dark`**
  - **EN:** Dark
  - **DE:** Dunkel

- [ ] **`webview.menu.preset.light`**
  - **EN:** Light
  - **DE:** Hell

- [ ] **`webview.menu.section.direction`**
  - **EN:** Layout direction
  - **DE:** Layoutrichtung

- [ ] **`webview.menu.section.model`**
  - **EN:** Model
  - **DE:** Modell

- [ ] **`webview.menu.section.theme`**
  - **EN:** Theme
  - **DE:** Design

## Sign-off

- [ ] Spot-checked in Extension Development Host with `agentMindmap.ui.locale` set to this locale.
- [ ] Updated [REVIEW-STATUS.md](./REVIEW-STATUS.md) for this locale.
