# French (fr) — UI translation review

> Auto-generated from `extension/l10n/bundle.l10n.fr.json`. Regenerate with `npm run checklist:l10n`.

| Field        | Value                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| Locale ID    | `fr`                                                                             |
| Native name  | Français                                                                         |
| Bundle       | [`extension/l10n/bundle.l10n.fr.json`](../../extension/l10n/bundle.l10n.fr.json) |
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
  - **FR:** (Some topics have invalid conceptPath; re-open the session or run Analyze All Sessions with force re-analyze.)

- [ ] **`mindmap.concept.empty.noConceptPath`**
  - **EN:** (No topics with conceptPath in the library; re-open a session or run Analyze All Sessions with force re-analyze.)
  - **FR:** (No topics with conceptPath in the library; re-open a session or run Analyze All Sessions with force re-analyze.)

- [ ] **`mindmap.concept.empty.noSessions`**
  - **EN:** (No analyzed sessions in the library; run Open Latest Session or Analyze Project Sessions first.)
  - **FR:** (Aucune session analysée in the library; run Open Latest Session or Analyze Project Sessions first.)

- [ ] **`mindmap.concept.noDetails`**
  - **EN:** (No details)
  - **FR:** (Aucun détail)

- [ ] **`mindmap.concept.titleAll`**
  - **EN:** Concept Mind Map · All
  - **FR:** Carte mentale des concepts · All

- [ ] **`mindmap.concept.uncategorized`**
  - **EN:** Uncategorized ({0})
  - **FR:** Non classé ({0})

## Merged mind map (`mindmap.merge`, 3 keys)

- [ ] **`mindmap.merge.empty.noSessions`**
  - **EN:** (No analyzed sessions in the library)
  - **FR:** (Aucune session analysée in the library)

- [ ] **`mindmap.merge.projectPrefix`**
  - **EN:** Project: {0}
  - **FR:** Project: {0}

- [ ] **`mindmap.merge.titleAll`**
  - **EN:** Agent Mind Map · All
  - **FR:** Agent Mind Map · All

## Turn view labels (`mindmap.turn`, 3 keys)

- [ ] **`mindmap.turn.conclusion`**
  - **EN:** Conclusion
  - **FR:** Conclusion

- [ ] **`mindmap.turn.research`**
  - **EN:** Research
  - **FR:** Recherche

- [ ] **`mindmap.turn.sessionDefault`**
  - **EN:** Agent Session
  - **FR:** Session agent

## Unexpected errors (`notify.unexpected`, 1 keys)

- [ ] **`notify.unexpected`**
  - **EN:** Agent Mind Map: An unexpected error occurred: {0}
  - **FR:** Agent Mind Map: Une erreur inattendue s’est produite : {0}

## Batch analyze (`ui.batch`, 23 keys)

- [ ] **`ui.batch.emptyOnDisk`**
  - **EN:** Agent Mind Map: No agent transcripts found on disk for current project ({0}).
  - **FR:** Agent Mind Map: No agent transcripts found on disk for current project ({0}).

- [ ] **`ui.batch.failedSuffix`**
  - **EN:** {0} session(s) failed.
  - **FR:** {0} session(s) failed.

- [ ] **`ui.batch.item.cacheHit`**
  - **EN:** Cache hit
  - **FR:** Cache trouvé

- [ ] **`ui.batch.item.done`**
  - **EN:** Analysis completed
  - **FR:** Analyse terminée

- [ ] **`ui.batch.item.failed`**
  - **EN:** Analysis failed
  - **FR:** Échec de l’analyse

- [ ] **`ui.batch.item.fallbackTurnView`**
  - **EN:** Fell back to chronological view
  - **FR:** Fell back to chronological view

- [ ] **`ui.batch.item.start`**
  - **EN:** Start analyzing
  - **FR:** Démarrer l’analyse

- [ ] **`ui.batch.mode.force.desc`**
  - **EN:** Clear this project's library, merge snapshots, and ontology cache, then re-run the LLM for every session
  - **FR:** Clear this project's library, merge snapshots, and ontology cache, then re-run the LLM for every session

- [ ] **`ui.batch.mode.force.label`**
  - **EN:** Force re-analyze all
  - **FR:** Forcer la réanalyse de tout

- [ ] **`ui.batch.mode.skipCached.desc`**
  - **EN:** Only analyze transcripts missing or stale in the library
  - **FR:** Only analyze transcripts missing or stale in the library

- [ ] **`ui.batch.mode.skipCached.label`**
  - **EN:** Skip cached sessions
  - **FR:** Ignorer les sessions en cache

- [ ] **`ui.batch.noOntologyEquivalences`**
  - **EN:** Agent Mind Map: Concept synonym rules were not generated. Run Analyze All Sessions (Current Project) again for full merge.
  - **FR:** Agent Mind Map: Concept synonym rules were not generated. Run Analyze All Sessions (Current Project) again for full merge.

- [ ] **`ui.batch.noOntologyEquivalencesDisabled`**
  - **EN:** Agent Mind Map: Batch merge used mechanical path rules only. Enable agentMindmap.library.batchRefineOntology and run Analyze All Sessions again to refine synonyms.
  - **FR:** Agent Mind Map: Batch merge used mechanical path rules only. Enable agentMindmap.library.batchRefineOntology and run Analyze All Sessions again to refine synonyms.

- [ ] **`ui.batch.pickMode.placeholder`**
  - **EN:** Batch analyze agent sessions in current project
  - **FR:** Analyse par lot agent sessions in current project

- [ ] **`ui.batch.progress.finalRefine`**
  - **EN:** Final concept synonym refine…
  - **FR:** Final concept synonym refine…

- [ ] **`ui.batch.progress.finished`**
  - **EN:** Batch finished: {0} total, {1} succeeded, {2} cached, {3} failed
  - **FR:** Batch finished: {0} total, {1} succeeded, {2} cached, {3} failed

- [ ] **`ui.batch.progress.mergingConceptMap`**
  - **EN:** Merging concept mind map (analyzed {0} session(s))…
  - **FR:** Fusion de la carte mentale des concepts (analyzed {0} session(s))…

- [ ] **`ui.batch.progress.refineOntology`**
  - **EN:** Refining concept synonyms (batch {0}, {1}/{2} sessions)…
  - **FR:** Refining concept synonyms (batch {0}, {1}/{2} sessions)…

- [ ] **`ui.batch.progress.scanSessions`**
  - **EN:** Scanning agent sessions for current project…
  - **FR:** Analyse des sessions agent for current project…

- [ ] **`ui.batch.progress.start`**
  - **EN:** {0} session(s) total, starting batch analysis…
  - **FR:** {0} session(s) total, starting batch analysis…

- [ ] **`ui.batch.progress.title`**
  - **EN:** Agent Mind Map: Batch analyze & merge…
  - **FR:** Agent Mind Map: Analyse par lot & merge…

- [ ] **`ui.batch.summary`**
  - **EN:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached.
  - **FR:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached.

- [ ] **`ui.batch.summary.withFailures`**
  - **EN:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached, {3} failed ({4}{5}).
  - **FR:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached, {3} failed ({4}{5}).

## Browse sessions (`ui.browse`, 1 keys)

- [ ] **`ui.browse.placeholder`**
  - **EN:** Pick an analyzed session to open (from library)
  - **FR:** Pick an analyzed session to open (from library)

## CLI install guide (`ui.cliInstall`, 15 keys)

- [ ] **`ui.cliInstall.action.copyCommand`**
  - **EN:** Copy install command
  - **FR:** Copier la commande d’installation

- [ ] **`ui.cliInstall.action.openDocs`**
  - **EN:** Open install docs
  - **FR:** Ouvrir la documentation d’installation

- [ ] **`ui.cliInstall.action.openSettings`**
  - **EN:** Open CLI settings
  - **FR:** Ouvrir les paramètres CLI

- [ ] **`ui.cliInstall.claude.installBody`**
  - **EN:** Follow the official guide: {0}
  - **FR:** Follow the official guide: {0}

- [ ] **`ui.cliInstall.copied`**
  - **EN:** Agent Mind Map: Install command copied to clipboard.
  - **FR:** Agent Mind Map: Install command copié dans le presse-papiers.

- [ ] **`ui.cliInstall.cursor.auth`**
  - **EN:** 3. First run may require sign-in: agent login (or follow the browser link).
  - **FR:** 3. First run may require sign-in: agent login (or follow the browser link).

- [ ] **`ui.cliInstall.cursor.installUnix`**
  - **EN:** In a terminal: {0}
  - **FR:** In a terminal: {0}

- [ ] **`ui.cliInstall.cursor.installWin`**
  - **EN:** In PowerShell: {0}
  - **FR:** In PowerShell: {0}

- [ ] **`ui.cliInstall.step.auth`**
  - **EN:** 3. Sign in if prompted (see the install guide for headless / CI auth).
  - **FR:** 3. Connectez-vous si demandé (see the install guide for headless / CI auth).

- [ ] **`ui.cliInstall.step.cliPath`**
  - **EN:** 4. If auto-detect still fails, set Settings → {0} to the full path of the agent or claude executable.
  - **FR:** 4. If auto-detect still fails, set Settings → {0} to the full path of the agent or claude executable.

- [ ] **`ui.cliInstall.step.install`**
  - **EN:** 1. Install the CLI
  - **FR:** 1. Installer la CLI

- [ ] **`ui.cliInstall.step.libraryNote`**
  - **EN:** 5. Turn-only (chronological) views are not saved. Re-run batch analyze after the CLI works to build Concept Mind Map.
  - **FR:** 5. Turn-only (chronological) views are not saved. Re-run batch analyze after the CLI works to build Carte mentale des concepts.

- [ ] **`ui.cliInstall.step.verify`**
  - **EN:** 2. Verify in a terminal: {0}
  - **FR:** 2. Vérifier dans un terminal: {0}

- [ ] **`ui.cliInstall.summary.claude`**
  - **EN:** Agent Mind Map: Claude Code CLI not found — sessions cannot be saved to the library.
  - **FR:** Agent Mind Map: Claude Code CLI not found — sessions cannot be saved to the library.

- [ ] **`ui.cliInstall.summary.cursor`**
  - **EN:** Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library.
  - **FR:** Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library.

## Code references (`ui.codeRefs`, 1 keys)

- [ ] **`ui.codeRefs.pendingRefresh`**
  - **EN:** Agent Mind Map: Code descriptions are ready. Click Refresh in the mind map to update.
  - **FR:** Agent Mind Map: Code descriptions are ready. Click Refresh in the mind map to update.

## Commands (`ui.command`, 1 keys)

- [ ] **`ui.command.refresh.done`**
  - **EN:** Agent Mind Map refreshed.
  - **FR:** Agent Mind Map actualisé.

## Concept path hints (`ui.concept`, 2 keys)

- [ ] **`ui.concept.noConceptPathAll`**
  - **EN:** Agent Mind Map: All topics in the library have no conceptPath (likely analyzed before upgrade). Re-open the session or run Analyze All Sessions with force re-analyze.
  - **FR:** Agent Mind Map: All topics in the library have no conceptPath (likely analyzed before upgrade). Re-open the session or run Analyze All Sessions with force re-analyze.

- [ ] **`ui.concept.someMissingConceptPath`**
  - **EN:** Agent Mind Map: {0} topic(s) missing conceptPath were placed under the “Uncategorized” branch.
  - **FR:** Agent Mind Map: {0} topic(s) missing conceptPath were placed under the “Non classé” branch.

## Debug commands (`ui.debug`, 6 keys)

- [ ] **`ui.debug.cursorOnly`**
  - **EN:** Agent Mind Map: This debug command is only available when agentMindmap.host is Cursor.
  - **FR:** Agent Mind Map: This debug command is only available when agentMindmap.host is Cursor.

- [ ] **`ui.debug.inspectComposer.pickSession.placeholder`**
  - **EN:** Pick a session to inspect its entry in composer.composerHeaders
  - **FR:** Pick a session to inspect its entry in composer.composerHeaders

- [ ] **`ui.debug.pickStateKey.placeholder`**
  - **EN:** Pick a state.vscdb key to view its full value
  - **FR:** Pick a state.vscdb key to view its full value

- [ ] **`ui.debug.stateKeyMissing`**
  - **EN:** Agent Mind Map: key {0} does not exist or failed to read.
  - **FR:** Agent Mind Map: key {0} does not exist or failed to read.

- [ ] **`ui.debug.testJump.pickSession.placeholder`**
  - **EN:** Pick a session as the simulated click target
  - **FR:** Pick a session as the simulated click target

- [ ] **`ui.debug.tryOpenShapes.placeholder`**
  - **EN:** Pick a session to debug glass.openAgentById argument shapes
  - **FR:** Pick a session to debug glass.openAgentById argument shapes

## Download & export (`ui.download`, 7 keys)

- [ ] **`ui.download.choice.openInBrowser`**
  - **EN:** Open in browser
  - **FR:** Ouvrir dans le navigateur

- [ ] **`ui.download.choice.showInExplorer`**
  - **EN:** Show in file manager
  - **FR:** Afficher dans le gestionnaire de fichiers

- [ ] **`ui.download.exportFailed`**
  - **EN:** Agent Mind Map: Export failed: {0}
  - **FR:** Agent Mind Map: Échec de l’exportation : {0}

- [ ] **`ui.download.exported.summary`**
  - **EN:** Exported mind map and {0} transcript(s) to the selected folder.
  - **FR:** Carte mentale et {0} transcription(s) exportées dans le dossier sélectionné.

- [ ] **`ui.download.exporting.title`**
  - **EN:** Agent Mind Map: Exporting…
  - **FR:** Agent Mind Map: Exportation…

- [ ] **`ui.download.pickFolderLabel`**
  - **EN:** Select download folder
  - **FR:** Sélectionner le dossier de téléchargement

- [ ] **`ui.download.pickPackageFolderLabel`**
  - **EN:** Select offline package folder
  - **FR:** Sélectionner le dossier du paquet hors ligne

## JSON export (`ui.exportJson`, 1 keys)

- [ ] **`ui.exportJson.exported`**
  - **EN:** Exported mind map to docs/agent-mindmaps/{0}
  - **FR:** Exported mind map to docs/agent-mindmaps/{0}

## Jump to transcript (`ui.jump`, 12 keys)

- [ ] **`ui.jump.diagnose.placeholder`**
  - **EN:** Found {0} command(s) (recorded to Mind Map logs)
  - **FR:** Found {0} command(s) (recorded to Mind Map logs)

- [ ] **`ui.jump.loading`**
  - **EN:** Loading transcript…
  - **FR:** Chargement de la transcription…

- [ ] **`ui.jump.missingTranscriptPath`**
  - **EN:** Agent Mind Map: Cannot open transcript (missing transcript path).
  - **FR:** Agent Mind Map: Cannot open transcript (missing transcript path).

- [ ] **`ui.jump.openById.allFailed`**
  - **EN:** Agent Mind Map: Tried all shapes and none worked. Please check the logs.
  - **FR:** Agent Mind Map: Toutes les formes ont été essayées sans succès. Consultez les journaux.

- [ ] **`ui.jump.openById.confirmNo`**
  - **EN:** ❌ No, try next
  - **FR:** ❌ Non, essayer le suivant

- [ ] **`ui.jump.openById.confirmYes`**
  - **EN:** ✅ Yes, stop
  - **FR:** ✅ Oui, arrêter

- [ ] **`ui.jump.openById.remembered`**
  - **EN:** Agent Mind Map: Remembered shape {0} (please send this back to the developer).
  - **FR:** Agent Mind Map: Remembered shape {0} (please send this back to the developer).

- [ ] **`ui.jump.openById.shapePrompt`**
  - **EN:** Agent Mind Map · Called {0} {1} → {2}. Did it open the correct Agent?
  - **FR:** Agent Mind Map · {0} {1} → {2} appelé. Le bon Agent s’est-il ouvert ?

- [ ] **`ui.jump.openByIdUnsupported`**
  - **EN:** Agent Mind Map: The current {0} environment does not support opening the native Agent panel by ID.
  - **FR:** Agent Mind Map: The current {0} environment does not support opening the native Agent panel by ID.

- [ ] **`ui.jump.openPicker.placeholder`**
  - **EN:** Select a session / question to open
  - **FR:** Sélectionnez une session / question à ouvrir

- [ ] **`ui.jump.qTagMissing`**
  - **EN:** Agent Mind Map: Q{0} referenced by this node does not exist in the current transcript ({1} user question(s) total). Opening the whole session instead.
  - **FR:** Agent Mind Map: Q{0} referenced by this node does not exist in the current transcript ({1} user question(s) total). Opening the whole session instead.

- [ ] **`ui.jump.readTranscriptFailed`**
  - **EN:** Agent Mind Map: Failed to read transcript: {0}
  - **FR:** Agent Mind Map: Failed to read transcript: {0}

## Library messages (`ui.library`, 5 keys)

- [ ] **`ui.library.empty.currentProject`**
  - **EN:** Agent Mind Map: No analyzed sessions in the library for current project ({0}).
  - **FR:** Agent Mind Map: Aucune session analysée in the library for current project ({0}).

- [ ] **`ui.library.empty.hint`**
  - **EN:** Agent Mind Map: Library is empty. Analyze at least one session first (e.g. “Open Latest Session”).
  - **FR:** Agent Mind Map: La bibliothèque est vide. Analyze at least one session first (e.g. “Open Latest Session”).

- [ ] **`ui.library.empty.llmTurnFallbackGeneric`**
  - **EN:** Agent Mind Map: LLM summarization failed for every session. Turn-only views are not saved to the library, so Concept Mind Map stays empty.
  - **FR:** Agent Mind Map: LLM summarization failed for every session. Turn-only views are not saved to the library, so Carte mentale des concepts stays empty.

- [ ] **`ui.library.empty.noRecordsAfterAnalyze`**
  - **EN:** Agent Mind Map: After analysis, the library still has no usable records for current project ({0}).
  - **FR:** Agent Mind Map: After analysis, the library still has no usable records for current project ({0}).

- [ ] **`ui.library.merge.emptyResult`**
  - **EN:** Agent Mind Map: Merge result is empty for current project ({0}).
  - **FR:** Agent Mind Map: Merge result is empty for current project ({0}).

## LLM progress (`ui.llm`, 5 keys)

- [ ] **`ui.llm.attempt`**
  - **EN:** LLM attempt {0}/{1}…
  - **FR:** LLM attempt {0}/{1}…

- [ ] **`ui.llm.cacheHit`**
  - **EN:** LLM cache hit…
  - **FR:** LLM cache hit…

- [ ] **`ui.llm.failed.fallback`**
  - **EN:** Falling back to chronological view.
  - **FR:** Retour à la vue chronologique.

- [ ] **`ui.llm.failed.message`**
  - **EN:** Agent Mind Map: LLM summarization failed ({0}). {1}
  - **FR:** Agent Mind Map: LLM summarization failed ({0}). {1}

- [ ] **`ui.llm.outline.heartbeat`**
  - **EN:** Generating outline…
  - **FR:** Generating outline…

## Loading states (`ui.loading`, 3 keys)

- [ ] **`ui.loading.forceReanalyzing`**
  - **EN:** Force re-analyzing…
  - **FR:** Nouvelle analyse forcée…

- [ ] **`ui.loading.preparing`**
  - **EN:** Understanding conversation…
  - **FR:** Compréhension de la conversation…

- [ ] **`ui.loading.transcriptUpdatedReanalyzing`**
  - **EN:** Transcript updated, re-analyzing…
  - **FR:** Transcription mise à jour, nouvelle analyse…

## Merge scope & progress (`ui.merge`, 14 keys)

- [ ] **`ui.merge.cache.check`**
  - **EN:** Checking merge cache…
  - **FR:** Checking merge cache…

- [ ] **`ui.merge.cache.hitRender`**
  - **EN:** Merge cache hit, generating mind map…
  - **FR:** Merge cache hit, generating mind map…

- [ ] **`ui.merge.cache.write`**
  - **EN:** Writing merge cache…
  - **FR:** Writing merge cache…

- [ ] **`ui.merge.llm.heartbeat`**
  - **EN:** Calling LLM to merge topics…
  - **FR:** Calling LLM to merge topics…

- [ ] **`ui.merge.manualSelect.placeholder`**
  - **EN:** Select sessions to merge (all selected by default)
  - **FR:** Select sessions to merge (all selected by default)

- [ ] **`ui.merge.progress.preparing`**
  - **EN:** Preparing LLM merge…
  - **FR:** Preparing LLM merge…

- [ ] **`ui.merge.progress.title`**
  - **EN:** Agent Mind Map: Merging topics…
  - **FR:** Agent Mind Map: Merging topics…

- [ ] **`ui.merge.scope.all.desc`**
  - **EN:** Merge all sessions across all projects in the library
  - **FR:** Merge all sessions across all projects in the library

- [ ] **`ui.merge.scope.all.label`**
  - **EN:** All projects
  - **FR:** All projects

- [ ] **`ui.merge.scope.current.desc`**
  - **EN:** Merge all analyzed sessions from the current workspace
  - **FR:** Merge all analyzed sessions from the current workspace

- [ ] **`ui.merge.scope.current.label`**
  - **EN:** Current project ({0})
  - **FR:** Current project ({0})

- [ ] **`ui.merge.scope.placeholder`**
  - **EN:** Select LLM merge scope
  - **FR:** Select LLM merge scope

- [ ] **`ui.merge.scope.select.desc`**
  - **EN:** Choose sessions to include in the merge
  - **FR:** Choose sessions to include in the merge

- [ ] **`ui.merge.scope.select.label`**
  - **EN:** Select sessions…
  - **FR:** Select sessions…

## Ontology / concept cache (`ui.ontology`, 7 keys)

- [ ] **`ui.ontology.cache.check`**
  - **EN:** Checking concept ontology cache…
  - **FR:** Checking concept ontology cache…

- [ ] **`ui.ontology.cache.hit`**
  - **EN:** Concept ontology cache hit…
  - **FR:** Concept ontology cache hit…

- [ ] **`ui.ontology.cacheCleared`**
  - **EN:** Agent Mind Map: Cleared {0} ontology cache file(s). Next open of Concept Mind Map will re-extract and refine segment equivalences.
  - **FR:** Agent Mind Map: Cleared {0} ontology cache file(s). Next open of Carte mentale des concepts will re-extract and refine segment equivalences.

- [ ] **`ui.ontology.extract`**
  - **EN:** Extracting concept ontology…
  - **FR:** Extracting concept ontology…

- [ ] **`ui.ontology.extract.heartbeat`**
  - **EN:** Extracting concept ontology…
  - **FR:** Extracting concept ontology…

- [ ] **`ui.ontology.refine.heartbeat`**
  - **EN:** Refining concept segment equivalences…
  - **FR:** Refining concept segment equivalences…

- [ ] **`ui.ontology.topicPaths.step`**
  - **EN:** Inferring topic paths ({0}/{1})…
  - **FR:** Inferring topic paths ({0}/{1})…

## Pick session (`ui.pickSession`, 1 keys)

- [ ] **`ui.pickSession.placeholder`**
  - **EN:** Select a {0} chat session
  - **FR:** Sélectionnez une session de chat {0}

## Progress notifications (`ui.progress`, 15 keys)

- [ ] **`ui.progress.analyzingSession.title`**
  - **EN:** Agent Mind Map: Analyzing session…
  - **FR:** Agent Mind Map: Analyse de la session…

- [ ] **`ui.progress.applyConceptPaths`**
  - **EN:** Applying concept paths…
  - **FR:** Applying concept paths…

- [ ] **`ui.progress.batch.complete`**
  - **EN:** {0} · {1} (completed {2}/{3})
  - **FR:** {0} · {1} ({2}/{3} terminé)

- [ ] **`ui.progress.batch.header`**
  - **EN:** {0} · {1}
  - **FR:** {0} · {1}

- [ ] **`ui.progress.batch.position`**
  - **EN:** {0}/{1}
  - **FR:** {0}/{1}

- [ ] **`ui.progress.buildingMindMap.title`**
  - **EN:** Agent Mind Map: Building mind map…
  - **FR:** Agent Mind Map: Building mind map…

- [ ] **`ui.progress.cacheHitRender`**
  - **EN:** Cache hit, generating mind map…
  - **FR:** Cache trouvé, generating mind map…

- [ ] **`ui.progress.checkLibraryCache`**
  - **EN:** Checking library cache…
  - **FR:** Vérification du cache de bibliothèque…

- [ ] **`ui.progress.generateMindMap`**
  - **EN:** Generating mind map…
  - **FR:** Génération de la carte mentale…

- [ ] **`ui.progress.heartbeat.wait`**
  - **EN:** {0} (waiting {1} second(s))
  - **FR:** {0} (attente de {1} seconde(s))

- [ ] **`ui.progress.loadLibrary`**
  - **EN:** Loading analysis library…
  - **FR:** Chargement de la bibliothèque d’analyse…

- [ ] **`ui.progress.preparingMindMap`**
  - **EN:** Preparing mind map…
  - **FR:** Préparation de la carte mentale…

- [ ] **`ui.progress.readTranscript`**
  - **EN:** Reading transcript…
  - **FR:** Lecture de la transcription…

- [ ] **`ui.progress.renderMindMap`**
  - **EN:** Rendering mind map…
  - **FR:** Rendu de la carte mentale…

- [ ] **`ui.progress.writeLibrary`**
  - **EN:** Writing to library…
  - **FR:** Écriture dans la bibliothèque…

## Search (`ui.search`, 1 keys)

- [ ] **`ui.search.placeholder`**
  - **EN:** Search topics, titles, and keywords…
  - **FR:** Rechercher des sujets, titres et mots-clés…

## Model picker (`ui.selectModel`, 4 keys)

- [ ] **`ui.selectModel.applied`**
  - **EN:** Agent Mind Map: Model set to {0}.
  - **FR:** Agent Mind Map: Modèle set to {0}.

- [ ] **`ui.selectModel.custom.label`**
  - **EN:** Custom model name…
  - **FR:** Nom de modèle personnalisé…

- [ ] **`ui.selectModel.custom.placeholder`**
  - **EN:** Model name (e.g. claude-sonnet-4-6)
  - **FR:** Modèle name (e.g. claude-sonnet-4-6)

- [ ] **`ui.selectModel.placeholder`**
  - **EN:** Select a model for LLM requests
  - **FR:** Sélectionner un modèle pour les requêtes LLM

## UI settings (`ui.uiSetting`, 1 keys)

- [ ] **`ui.uiSetting.noWorkspace`**
  - **EN:** Agent Mind Map: Open a workspace folder first to write UI settings into .vscode/settings.json.
  - **FR:** Agent Mind Map: Ouvrez d’abord un dossier de workspace to write UI settings into .vscode/settings.json.

## Warnings (`ui.warning`, 2 keys)

- [ ] **`ui.warning.openMindMapFirst`**
  - **EN:** Agent Mind Map: Open a mind map first.
  - **FR:** Agent Mind Map: Ouvrez d’abord une carte mentale.

- [ ] **`ui.warning.openWorkspaceFolderFirst`**
  - **EN:** Agent Mind Map: Open a workspace folder first.
  - **FR:** Agent Mind Map: Ouvrez d’abord un dossier de workspace.

## Webview loading (`webview.loading`, 1 keys)

- [ ] **`webview.loading.title`**
  - **EN:** Generating mind map…
  - **FR:** Génération de la carte mentale…

## Webview context menu (`webview.menu`, 13 keys)

- [ ] **`webview.menu.direction.left`**
  - **EN:** Left
  - **FR:** Gauche

- [ ] **`webview.menu.direction.right`**
  - **EN:** Right
  - **FR:** Droite

- [ ] **`webview.menu.direction.side`**
  - **EN:** Both sides (right then left)
  - **FR:** Deux côtés (right then left)

- [ ] **`webview.menu.direction.sideLr`**
  - **EN:** Both sides (left then right)
  - **FR:** Deux côtés (left then right)

- [ ] **`webview.menu.download`**
  - **EN:** Download mind map & transcripts…
  - **FR:** Télécharger la carte mentale et les transcriptions…

- [ ] **`webview.menu.model.default`**
  - **EN:** Default
  - **FR:** Par défaut

- [ ] **`webview.menu.model.more`**
  - **EN:** More models…
  - **FR:** Plus de modèles…

- [ ] **`webview.menu.preset.auto`**
  - **EN:** Follow editor
  - **FR:** Suivre l’éditeur

- [ ] **`webview.menu.preset.dark`**
  - **EN:** Dark
  - **FR:** Sombre

- [ ] **`webview.menu.preset.light`**
  - **EN:** Light
  - **FR:** Clair

- [ ] **`webview.menu.section.direction`**
  - **EN:** Layout direction
  - **FR:** Direction de disposition

- [ ] **`webview.menu.section.model`**
  - **EN:** Model
  - **FR:** Modèle

- [ ] **`webview.menu.section.theme`**
  - **EN:** Theme
  - **FR:** Thème

## Sign-off

- [ ] Spot-checked in Extension Development Host with `agentMindmap.ui.locale` set to this locale.
- [ ] Updated [REVIEW-STATUS.md](./REVIEW-STATUS.md) for this locale.
