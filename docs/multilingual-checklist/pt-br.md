# Brazilian Portuguese (pt-br) — UI translation review

> Auto-generated from `extension/l10n/bundle.l10n.pt-br.json`. Regenerate with `npm run checklist:l10n`.

| Field        | Value                                                                                  |
| ------------ | -------------------------------------------------------------------------------------- |
| Locale ID    | `pt-br`                                                                                |
| Native name  | Português (Brasil)                                                                     |
| Bundle       | [`extension/l10n/bundle.l10n.pt-br.json`](../../extension/l10n/bundle.l10n.pt-br.json) |
| Keys         | 154                                                                                    |
| Review tier  | AI-assisted initial draft — needs native-speaker review.                               |
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
  - **PT-BR:** (Some topics have invalid conceptPath; re-open the session or run Analyze All Sessions with force re-analyze.)

- [ ] **`mindmap.concept.empty.noConceptPath`**
  - **EN:** (No topics with conceptPath in the library; re-open a session or run Analyze All Sessions with force re-analyze.)
  - **PT-BR:** (No topics with conceptPath in the library; re-open a session or run Analyze All Sessions with force re-analyze.)

- [ ] **`mindmap.concept.empty.noSessions`**
  - **EN:** (No analyzed sessions in the library; run Open Latest Session or Analyze Project Sessions first.)
  - **PT-BR:** (Não há sessões analisadas in the library; run Open Latest Session or Analyze Project Sessions first.)

- [ ] **`mindmap.concept.noDetails`**
  - **EN:** (No details)
  - **PT-BR:** (Sem detalhes)

- [ ] **`mindmap.concept.titleAll`**
  - **EN:** Concept Mind Map · All
  - **PT-BR:** Mapa mental de conceitos · All

- [ ] **`mindmap.concept.uncategorized`**
  - **EN:** Uncategorized ({0})
  - **PT-BR:** Sem categoria ({0})

## Merged mind map (`mindmap.merge`, 3 keys)

- [ ] **`mindmap.merge.empty.noSessions`**
  - **EN:** (No analyzed sessions in the library)
  - **PT-BR:** (Não há sessões analisadas in the library)

- [ ] **`mindmap.merge.projectPrefix`**
  - **EN:** Project: {0}
  - **PT-BR:** Project: {0}

- [ ] **`mindmap.merge.titleAll`**
  - **EN:** Agent Mind Map · All
  - **PT-BR:** Agent Mind Map · All

## Turn view labels (`mindmap.turn`, 3 keys)

- [ ] **`mindmap.turn.conclusion`**
  - **EN:** Conclusion
  - **PT-BR:** Conclusão

- [ ] **`mindmap.turn.research`**
  - **EN:** Research
  - **PT-BR:** Pesquisa

- [ ] **`mindmap.turn.sessionDefault`**
  - **EN:** Agent Session
  - **PT-BR:** Sessão do agente

## Unexpected errors (`notify.unexpected`, 1 keys)

- [ ] **`notify.unexpected`**
  - **EN:** Agent Mind Map: An unexpected error occurred: {0}
  - **PT-BR:** Agent Mind Map: Ocorreu um erro inesperado: {0}

## Batch analyze (`ui.batch`, 23 keys)

- [ ] **`ui.batch.emptyOnDisk`**
  - **EN:** Agent Mind Map: No agent transcripts found on disk for current project ({0}).
  - **PT-BR:** Agent Mind Map: No agent transcripts found on disk for current project ({0}).

- [ ] **`ui.batch.failedSuffix`**
  - **EN:** {0} session(s) failed.
  - **PT-BR:** {0} session(s) failed.

- [ ] **`ui.batch.item.cacheHit`**
  - **EN:** Cache hit
  - **PT-BR:** Cache encontrado

- [ ] **`ui.batch.item.done`**
  - **EN:** Analysis completed
  - **PT-BR:** Análise concluída

- [ ] **`ui.batch.item.failed`**
  - **EN:** Analysis failed
  - **PT-BR:** Falha na análise

- [ ] **`ui.batch.item.fallbackTurnView`**
  - **EN:** Fell back to chronological view
  - **PT-BR:** Fell back to chronological view

- [ ] **`ui.batch.item.start`**
  - **EN:** Start analyzing
  - **PT-BR:** Iniciar análise

- [ ] **`ui.batch.mode.force.desc`**
  - **EN:** Clear this project's library, merge snapshots, and ontology cache, then re-run the LLM for every session
  - **PT-BR:** Clear this project's library, merge snapshots, and ontology cache, then re-run the LLM for every session

- [ ] **`ui.batch.mode.force.label`**
  - **EN:** Force re-analyze all
  - **PT-BR:** Forçar reanálise de tudo

- [ ] **`ui.batch.mode.skipCached.desc`**
  - **EN:** Only analyze transcripts missing or stale in the library
  - **PT-BR:** Only analyze transcripts missing or stale in the library

- [ ] **`ui.batch.mode.skipCached.label`**
  - **EN:** Skip cached sessions
  - **PT-BR:** Ignorar sessões em cache

- [ ] **`ui.batch.noOntologyEquivalences`**
  - **EN:** Agent Mind Map: Concept synonym rules were not generated. Run Analyze All Sessions (Current Project) again for full merge.
  - **PT-BR:** Agent Mind Map: Concept synonym rules were not generated. Run Analyze All Sessions (Current Project) again for full merge.

- [ ] **`ui.batch.noOntologyEquivalencesDisabled`**
  - **EN:** Agent Mind Map: Batch merge used mechanical path rules only. Enable agentMindmap.library.batchRefineOntology and run Analyze All Sessions again to refine synonyms.
  - **PT-BR:** Agent Mind Map: Batch merge used mechanical path rules only. Enable agentMindmap.library.batchRefineOntology and run Analyze All Sessions again to refine synonyms.

- [ ] **`ui.batch.pickMode.placeholder`**
  - **EN:** Batch analyze agent sessions in current project
  - **PT-BR:** Análise em lote agent sessions in current project

- [ ] **`ui.batch.progress.finalRefine`**
  - **EN:** Final concept synonym refine…
  - **PT-BR:** Final concept synonym refine…

- [ ] **`ui.batch.progress.finished`**
  - **EN:** Batch finished: {0} total, {1} succeeded, {2} cached, {3} failed
  - **PT-BR:** Batch finished: {0} total, {1} succeeded, {2} cached, {3} failed

- [ ] **`ui.batch.progress.mergingConceptMap`**
  - **EN:** Merging concept mind map (analyzed {0} session(s))…
  - **PT-BR:** Mesclando mapa mental de conceitos (analyzed {0} session(s))…

- [ ] **`ui.batch.progress.refineOntology`**
  - **EN:** Refining concept synonyms (batch {0}, {1}/{2} sessions)…
  - **PT-BR:** Refining concept synonyms (batch {0}, {1}/{2} sessions)…

- [ ] **`ui.batch.progress.scanSessions`**
  - **EN:** Scanning agent sessions for current project…
  - **PT-BR:** Verificando sessões do agente for current project…

- [ ] **`ui.batch.progress.start`**
  - **EN:** {0} session(s) total, starting batch analysis…
  - **PT-BR:** {0} session(s) total, starting batch analysis…

- [ ] **`ui.batch.progress.title`**
  - **EN:** Agent Mind Map: Batch analyze & merge…
  - **PT-BR:** Agent Mind Map: Análise em lote & merge…

- [ ] **`ui.batch.summary`**
  - **EN:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached.
  - **PT-BR:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached.

- [ ] **`ui.batch.summary.withFailures`**
  - **EN:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached, {3} failed ({4}{5}).
  - **PT-BR:** Agent Mind Map: {0} session(s) total, {1} newly analyzed, {2} cached, {3} failed ({4}{5}).

## Browse sessions (`ui.browse`, 1 keys)

- [ ] **`ui.browse.placeholder`**
  - **EN:** Pick an analyzed session to open (from library)
  - **PT-BR:** Pick an analyzed session to open (from library)

## CLI install guide (`ui.cliInstall`, 15 keys)

- [ ] **`ui.cliInstall.action.copyCommand`**
  - **EN:** Copy install command
  - **PT-BR:** Copiar comando de instalação

- [ ] **`ui.cliInstall.action.openDocs`**
  - **EN:** Open install docs
  - **PT-BR:** Abrir documentação de instalação

- [ ] **`ui.cliInstall.action.openSettings`**
  - **EN:** Open CLI settings
  - **PT-BR:** Abrir configurações da CLI

- [ ] **`ui.cliInstall.claude.installBody`**
  - **EN:** Follow the official guide: {0}
  - **PT-BR:** Follow the official guide: {0}

- [ ] **`ui.cliInstall.copied`**
  - **EN:** Agent Mind Map: Install command copied to clipboard.
  - **PT-BR:** Agent Mind Map: Install command copiado para a área de transferência.

- [ ] **`ui.cliInstall.cursor.auth`**
  - **EN:** 3. First run may require sign-in: agent login (or follow the browser link).
  - **PT-BR:** 3. First run may require sign-in: agent login (or follow the browser link).

- [ ] **`ui.cliInstall.cursor.installUnix`**
  - **EN:** In a terminal: {0}
  - **PT-BR:** In a terminal: {0}

- [ ] **`ui.cliInstall.cursor.installWin`**
  - **EN:** In PowerShell: {0}
  - **PT-BR:** In PowerShell: {0}

- [ ] **`ui.cliInstall.step.auth`**
  - **EN:** 3. Sign in if prompted (see the install guide for headless / CI auth).
  - **PT-BR:** 3. Entre se solicitado (see the install guide for headless / CI auth).

- [ ] **`ui.cliInstall.step.cliPath`**
  - **EN:** 4. If auto-detect still fails, set Settings → {0} to the full path of the agent or claude executable.
  - **PT-BR:** 4. If auto-detect still fails, set Settings → {0} to the full path of the agent or claude executable.

- [ ] **`ui.cliInstall.step.install`**
  - **EN:** 1. Install the CLI
  - **PT-BR:** 1. Instale a CLI

- [ ] **`ui.cliInstall.step.libraryNote`**
  - **EN:** 5. Turn-only (chronological) views are not saved. Re-run batch analyze after the CLI works to build Concept Mind Map.
  - **PT-BR:** 5. Turn-only (chronological) views are not saved. Re-run batch analyze after the CLI works to build Mapa mental de conceitos.

- [ ] **`ui.cliInstall.step.verify`**
  - **EN:** 2. Verify in a terminal: {0}
  - **PT-BR:** 2. Verifique em um terminal: {0}

- [ ] **`ui.cliInstall.summary.claude`**
  - **EN:** Agent Mind Map: Claude Code CLI not found — sessions cannot be saved to the library.
  - **PT-BR:** Agent Mind Map: Claude Code CLI not found — sessions cannot be saved to the library.

- [ ] **`ui.cliInstall.summary.cursor`**
  - **EN:** Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library.
  - **PT-BR:** Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library.

## Code references (`ui.codeRefs`, 1 keys)

- [ ] **`ui.codeRefs.pendingRefresh`**
  - **EN:** Agent Mind Map: Code descriptions are ready. Click Refresh in the mind map to update.
  - **PT-BR:** Agent Mind Map: Code descriptions are ready. Click Refresh in the mind map to update.

## Commands (`ui.command`, 1 keys)

- [ ] **`ui.command.refresh.done`**
  - **EN:** Agent Mind Map refreshed.
  - **PT-BR:** Agent Mind Map atualizado.

## Concept path hints (`ui.concept`, 2 keys)

- [ ] **`ui.concept.noConceptPathAll`**
  - **EN:** Agent Mind Map: All topics in the library have no conceptPath (likely analyzed before upgrade). Re-open the session or run Analyze All Sessions with force re-analyze.
  - **PT-BR:** Agent Mind Map: All topics in the library have no conceptPath (likely analyzed before upgrade). Re-open the session or run Analyze All Sessions with force re-analyze.

- [ ] **`ui.concept.someMissingConceptPath`**
  - **EN:** Agent Mind Map: {0} topic(s) missing conceptPath were placed under the “Uncategorized” branch.
  - **PT-BR:** Agent Mind Map: {0} topic(s) missing conceptPath were placed under the “Sem categoria” branch.

## Debug commands (`ui.debug`, 6 keys)

- [ ] **`ui.debug.cursorOnly`**
  - **EN:** Agent Mind Map: This debug command is only available when agentMindmap.host is Cursor.
  - **PT-BR:** Agent Mind Map: This debug command is only available when agentMindmap.host is Cursor.

- [ ] **`ui.debug.inspectComposer.pickSession.placeholder`**
  - **EN:** Pick a session to inspect its entry in composer.composerHeaders
  - **PT-BR:** Pick a session to inspect its entry in composer.composerHeaders

- [ ] **`ui.debug.pickStateKey.placeholder`**
  - **EN:** Pick a state.vscdb key to view its full value
  - **PT-BR:** Pick a state.vscdb key to view its full value

- [ ] **`ui.debug.stateKeyMissing`**
  - **EN:** Agent Mind Map: key {0} does not exist or failed to read.
  - **PT-BR:** Agent Mind Map: key {0} does not exist or failed to read.

- [ ] **`ui.debug.testJump.pickSession.placeholder`**
  - **EN:** Pick a session as the simulated click target
  - **PT-BR:** Pick a session as the simulated click target

- [ ] **`ui.debug.tryOpenShapes.placeholder`**
  - **EN:** Pick a session to debug glass.openAgentById argument shapes
  - **PT-BR:** Pick a session to debug glass.openAgentById argument shapes

## Download & export (`ui.download`, 7 keys)

- [ ] **`ui.download.choice.openInBrowser`**
  - **EN:** Open in browser
  - **PT-BR:** Abrir no navegador

- [ ] **`ui.download.choice.showInExplorer`**
  - **EN:** Show in file manager
  - **PT-BR:** Mostrar no gerenciador de arquivos

- [ ] **`ui.download.exportFailed`**
  - **EN:** Agent Mind Map: Export failed: {0}
  - **PT-BR:** Agent Mind Map: Falha ao exportar: {0}

- [ ] **`ui.download.exported.summary`**
  - **EN:** Exported mind map and {0} transcript(s) to the selected folder.
  - **PT-BR:** Mapa mental e {0} transcrição(ões) exportados para a pasta selecionada.

- [ ] **`ui.download.exporting.title`**
  - **EN:** Agent Mind Map: Exporting…
  - **PT-BR:** Agent Mind Map: Exportando…

- [ ] **`ui.download.pickFolderLabel`**
  - **EN:** Select download folder
  - **PT-BR:** Selecione a pasta de download

- [ ] **`ui.download.pickPackageFolderLabel`**
  - **EN:** Select offline package folder
  - **PT-BR:** Selecione a pasta do pacote offline

## JSON export (`ui.exportJson`, 1 keys)

- [ ] **`ui.exportJson.exported`**
  - **EN:** Exported mind map to docs/agent-mindmaps/{0}
  - **PT-BR:** Exported mind map to docs/agent-mindmaps/{0}

## Jump to transcript (`ui.jump`, 12 keys)

- [ ] **`ui.jump.diagnose.placeholder`**
  - **EN:** Found {0} command(s) (recorded to Mind Map logs)
  - **PT-BR:** Found {0} command(s) (recorded to Mind Map logs)

- [ ] **`ui.jump.loading`**
  - **EN:** Loading transcript…
  - **PT-BR:** Carregando transcrição…

- [ ] **`ui.jump.missingTranscriptPath`**
  - **EN:** Agent Mind Map: Cannot open transcript (missing transcript path).
  - **PT-BR:** Agent Mind Map: Cannot open transcript (missing transcript path).

- [ ] **`ui.jump.openById.allFailed`**
  - **EN:** Agent Mind Map: Tried all shapes and none worked. Please check the logs.
  - **PT-BR:** Agent Mind Map: Todos os formatos foram tentados e nenhum funcionou. Verifique os logs.

- [ ] **`ui.jump.openById.confirmNo`**
  - **EN:** ❌ No, try next
  - **PT-BR:** ❌ Não, tentar o próximo

- [ ] **`ui.jump.openById.confirmYes`**
  - **EN:** ✅ Yes, stop
  - **PT-BR:** ✅ Sim, parar

- [ ] **`ui.jump.openById.remembered`**
  - **EN:** Agent Mind Map: Remembered shape {0} (please send this back to the developer).
  - **PT-BR:** Agent Mind Map: Remembered shape {0} (please send this back to the developer).

- [ ] **`ui.jump.openById.shapePrompt`**
  - **EN:** Agent Mind Map · Called {0} {1} → {2}. Did it open the correct Agent?
  - **PT-BR:** Agent Mind Map · Chamou {0} {1} → {2}. Abriu o Agent correto?

- [ ] **`ui.jump.openByIdUnsupported`**
  - **EN:** Agent Mind Map: The current {0} environment does not support opening the native Agent panel by ID.
  - **PT-BR:** Agent Mind Map: The current {0} environment does not support opening the native Agent panel by ID.

- [ ] **`ui.jump.openPicker.placeholder`**
  - **EN:** Select a session / question to open
  - **PT-BR:** Selecione uma sessão / pergunta para abrir

- [ ] **`ui.jump.qTagMissing`**
  - **EN:** Agent Mind Map: Q{0} referenced by this node does not exist in the current transcript ({1} user question(s) total). Opening the whole session instead.
  - **PT-BR:** Agent Mind Map: Q{0} referenced by this node does not exist in the current transcript ({1} user question(s) total). Opening the whole session instead.

- [ ] **`ui.jump.readTranscriptFailed`**
  - **EN:** Agent Mind Map: Failed to read transcript: {0}
  - **PT-BR:** Agent Mind Map: Failed to read transcript: {0}

## Library messages (`ui.library`, 5 keys)

- [ ] **`ui.library.empty.currentProject`**
  - **EN:** Agent Mind Map: No analyzed sessions in the library for current project ({0}).
  - **PT-BR:** Agent Mind Map: Não há sessões analisadas in the library for current project ({0}).

- [ ] **`ui.library.empty.hint`**
  - **EN:** Agent Mind Map: Library is empty. Analyze at least one session first (e.g. “Open Latest Session”).
  - **PT-BR:** Agent Mind Map: A biblioteca está vazia. Analyze at least one session first (e.g. “Open Latest Session”).

- [ ] **`ui.library.empty.llmTurnFallbackGeneric`**
  - **EN:** Agent Mind Map: LLM summarization failed for every session. Turn-only views are not saved to the library, so Concept Mind Map stays empty.
  - **PT-BR:** Agent Mind Map: LLM summarization failed for every session. Turn-only views are not saved to the library, so Mapa mental de conceitos stays empty.

- [ ] **`ui.library.empty.noRecordsAfterAnalyze`**
  - **EN:** Agent Mind Map: After analysis, the library still has no usable records for current project ({0}).
  - **PT-BR:** Agent Mind Map: After analysis, the library still has no usable records for current project ({0}).

- [ ] **`ui.library.merge.emptyResult`**
  - **EN:** Agent Mind Map: Merge result is empty for current project ({0}).
  - **PT-BR:** Agent Mind Map: Merge result is empty for current project ({0}).

## LLM progress (`ui.llm`, 5 keys)

- [ ] **`ui.llm.attempt`**
  - **EN:** LLM attempt {0}/{1}…
  - **PT-BR:** LLM attempt {0}/{1}…

- [ ] **`ui.llm.cacheHit`**
  - **EN:** LLM cache hit…
  - **PT-BR:** LLM cache hit…

- [ ] **`ui.llm.failed.fallback`**
  - **EN:** Falling back to chronological view.
  - **PT-BR:** Voltando para a visualização cronológica.

- [ ] **`ui.llm.failed.message`**
  - **EN:** Agent Mind Map: LLM summarization failed ({0}). {1}
  - **PT-BR:** Agent Mind Map: LLM summarization failed ({0}). {1}

- [ ] **`ui.llm.outline.heartbeat`**
  - **EN:** Generating outline…
  - **PT-BR:** Generating outline…

## Loading states (`ui.loading`, 3 keys)

- [ ] **`ui.loading.forceReanalyzing`**
  - **EN:** Force re-analyzing…
  - **PT-BR:** Forçando reanálise…

- [ ] **`ui.loading.preparing`**
  - **EN:** Understanding conversation…
  - **PT-BR:** Entendendo a conversa…

- [ ] **`ui.loading.transcriptUpdatedReanalyzing`**
  - **EN:** Transcript updated, re-analyzing…
  - **PT-BR:** Transcrição atualizada, reanalisando…

## Merge scope & progress (`ui.merge`, 14 keys)

- [ ] **`ui.merge.cache.check`**
  - **EN:** Checking merge cache…
  - **PT-BR:** Checking merge cache…

- [ ] **`ui.merge.cache.hitRender`**
  - **EN:** Merge cache hit, generating mind map…
  - **PT-BR:** Merge cache hit, generating mind map…

- [ ] **`ui.merge.cache.write`**
  - **EN:** Writing merge cache…
  - **PT-BR:** Writing merge cache…

- [ ] **`ui.merge.llm.heartbeat`**
  - **EN:** Calling LLM to merge topics…
  - **PT-BR:** Calling LLM to merge topics…

- [ ] **`ui.merge.manualSelect.placeholder`**
  - **EN:** Select sessions to merge (all selected by default)
  - **PT-BR:** Select sessions to merge (all selected by default)

- [ ] **`ui.merge.progress.preparing`**
  - **EN:** Preparing LLM merge…
  - **PT-BR:** Preparing LLM merge…

- [ ] **`ui.merge.progress.title`**
  - **EN:** Agent Mind Map: Merging topics…
  - **PT-BR:** Agent Mind Map: Merging topics…

- [ ] **`ui.merge.scope.all.desc`**
  - **EN:** Merge all sessions across all projects in the library
  - **PT-BR:** Merge all sessions across all projects in the library

- [ ] **`ui.merge.scope.all.label`**
  - **EN:** All projects
  - **PT-BR:** All projects

- [ ] **`ui.merge.scope.current.desc`**
  - **EN:** Merge all analyzed sessions from the current workspace
  - **PT-BR:** Merge all analyzed sessions from the current workspace

- [ ] **`ui.merge.scope.current.label`**
  - **EN:** Current project ({0})
  - **PT-BR:** Current project ({0})

- [ ] **`ui.merge.scope.placeholder`**
  - **EN:** Select LLM merge scope
  - **PT-BR:** Select LLM merge scope

- [ ] **`ui.merge.scope.select.desc`**
  - **EN:** Choose sessions to include in the merge
  - **PT-BR:** Choose sessions to include in the merge

- [ ] **`ui.merge.scope.select.label`**
  - **EN:** Select sessions…
  - **PT-BR:** Select sessions…

## Ontology / concept cache (`ui.ontology`, 7 keys)

- [ ] **`ui.ontology.cache.check`**
  - **EN:** Checking concept ontology cache…
  - **PT-BR:** Checking concept ontology cache…

- [ ] **`ui.ontology.cache.hit`**
  - **EN:** Concept ontology cache hit…
  - **PT-BR:** Concept ontology cache hit…

- [ ] **`ui.ontology.cacheCleared`**
  - **EN:** Agent Mind Map: Cleared {0} ontology cache file(s). Next open of Concept Mind Map will re-extract and refine segment equivalences.
  - **PT-BR:** Agent Mind Map: Cleared {0} ontology cache file(s). Next open of Mapa mental de conceitos will re-extract and refine segment equivalences.

- [ ] **`ui.ontology.extract`**
  - **EN:** Extracting concept ontology…
  - **PT-BR:** Extracting concept ontology…

- [ ] **`ui.ontology.extract.heartbeat`**
  - **EN:** Extracting concept ontology…
  - **PT-BR:** Extracting concept ontology…

- [ ] **`ui.ontology.refine.heartbeat`**
  - **EN:** Refining concept segment equivalences…
  - **PT-BR:** Refining concept segment equivalences…

- [ ] **`ui.ontology.topicPaths.step`**
  - **EN:** Inferring topic paths ({0}/{1})…
  - **PT-BR:** Inferring topic paths ({0}/{1})…

## Pick session (`ui.pickSession`, 1 keys)

- [ ] **`ui.pickSession.placeholder`**
  - **EN:** Select a {0} chat session
  - **PT-BR:** Selecione uma sessão de chat {0}

## Progress notifications (`ui.progress`, 15 keys)

- [ ] **`ui.progress.analyzingSession.title`**
  - **EN:** Agent Mind Map: Analyzing session…
  - **PT-BR:** Agent Mind Map: Analisando sessão…

- [ ] **`ui.progress.applyConceptPaths`**
  - **EN:** Applying concept paths…
  - **PT-BR:** Applying concept paths…

- [ ] **`ui.progress.batch.complete`**
  - **EN:** {0} · {1} (completed {2}/{3})
  - **PT-BR:** {0} · {1} ({2}/{3} concluído)

- [ ] **`ui.progress.batch.header`**
  - **EN:** {0} · {1}
  - **PT-BR:** {0} · {1}

- [ ] **`ui.progress.batch.position`**
  - **EN:** {0}/{1}
  - **PT-BR:** {0}/{1}

- [ ] **`ui.progress.buildingMindMap.title`**
  - **EN:** Agent Mind Map: Building mind map…
  - **PT-BR:** Agent Mind Map: Building mind map…

- [ ] **`ui.progress.cacheHitRender`**
  - **EN:** Cache hit, generating mind map…
  - **PT-BR:** Cache encontrado, generating mind map…

- [ ] **`ui.progress.checkLibraryCache`**
  - **EN:** Checking library cache…
  - **PT-BR:** Verificando cache da biblioteca…

- [ ] **`ui.progress.generateMindMap`**
  - **EN:** Generating mind map…
  - **PT-BR:** Gerando mapa mental…

- [ ] **`ui.progress.heartbeat.wait`**
  - **EN:** {0} (waiting {1} second(s))
  - **PT-BR:** {0} (aguardando {1} segundo(s))

- [ ] **`ui.progress.loadLibrary`**
  - **EN:** Loading analysis library…
  - **PT-BR:** Carregando biblioteca de análises…

- [ ] **`ui.progress.preparingMindMap`**
  - **EN:** Preparing mind map…
  - **PT-BR:** Preparando mapa mental…

- [ ] **`ui.progress.readTranscript`**
  - **EN:** Reading transcript…
  - **PT-BR:** Lendo transcrição…

- [ ] **`ui.progress.renderMindMap`**
  - **EN:** Rendering mind map…
  - **PT-BR:** Renderizando mapa mental…

- [ ] **`ui.progress.writeLibrary`**
  - **EN:** Writing to library…
  - **PT-BR:** Gravando na biblioteca…

## Search (`ui.search`, 1 keys)

- [ ] **`ui.search.placeholder`**
  - **EN:** Search topics, titles, and keywords…
  - **PT-BR:** Pesquisar tópicos, títulos e palavras-chave…

## Model picker (`ui.selectModel`, 4 keys)

- [ ] **`ui.selectModel.applied`**
  - **EN:** Agent Mind Map: Model set to {0}.
  - **PT-BR:** Agent Mind Map: Modelo set to {0}.

- [ ] **`ui.selectModel.custom.label`**
  - **EN:** Custom model name…
  - **PT-BR:** Nome de modelo personalizado…

- [ ] **`ui.selectModel.custom.placeholder`**
  - **EN:** Model name (e.g. claude-sonnet-4-6)
  - **PT-BR:** Modelo name (e.g. claude-sonnet-4-6)

- [ ] **`ui.selectModel.placeholder`**
  - **EN:** Select a model for LLM requests
  - **PT-BR:** Selecione um modelo para requisições LLM

## UI settings (`ui.uiSetting`, 1 keys)

- [ ] **`ui.uiSetting.noWorkspace`**
  - **EN:** Agent Mind Map: Open a workspace folder first to write UI settings into .vscode/settings.json.
  - **PT-BR:** Agent Mind Map: Abra uma pasta de workspace primeiro to write UI settings into .vscode/settings.json.

## Warnings (`ui.warning`, 2 keys)

- [ ] **`ui.warning.openMindMapFirst`**
  - **EN:** Agent Mind Map: Open a mind map first.
  - **PT-BR:** Agent Mind Map: Abra um mapa mental primeiro.

- [ ] **`ui.warning.openWorkspaceFolderFirst`**
  - **EN:** Agent Mind Map: Open a workspace folder first.
  - **PT-BR:** Agent Mind Map: Abra uma pasta de workspace primeiro.

## Webview loading (`webview.loading`, 1 keys)

- [ ] **`webview.loading.title`**
  - **EN:** Generating mind map…
  - **PT-BR:** Gerando mapa mental…

## Webview context menu (`webview.menu`, 13 keys)

- [ ] **`webview.menu.direction.left`**
  - **EN:** Left
  - **PT-BR:** Esquerda

- [ ] **`webview.menu.direction.right`**
  - **EN:** Right
  - **PT-BR:** Direita

- [ ] **`webview.menu.direction.side`**
  - **EN:** Both sides (right then left)
  - **PT-BR:** Ambos os lados (right then left)

- [ ] **`webview.menu.direction.sideLr`**
  - **EN:** Both sides (left then right)
  - **PT-BR:** Ambos os lados (left then right)

- [ ] **`webview.menu.download`**
  - **EN:** Download mind map & transcripts…
  - **PT-BR:** Baixar mapa mental e transcrições…

- [ ] **`webview.menu.model.default`**
  - **EN:** Default
  - **PT-BR:** Padrão

- [ ] **`webview.menu.model.more`**
  - **EN:** More models…
  - **PT-BR:** Mais modelos…

- [ ] **`webview.menu.preset.auto`**
  - **EN:** Follow editor
  - **PT-BR:** Seguir editor

- [ ] **`webview.menu.preset.dark`**
  - **EN:** Dark
  - **PT-BR:** Escuro

- [ ] **`webview.menu.preset.light`**
  - **EN:** Light
  - **PT-BR:** Claro

- [ ] **`webview.menu.section.direction`**
  - **EN:** Layout direction
  - **PT-BR:** Direção do layout

- [ ] **`webview.menu.section.model`**
  - **EN:** Model
  - **PT-BR:** Modelo

- [ ] **`webview.menu.section.theme`**
  - **EN:** Theme
  - **PT-BR:** Tema

## Sign-off

- [ ] Spot-checked in Extension Development Host with `agentMindmap.ui.locale` set to this locale.
- [ ] Updated [REVIEW-STATUS.md](./REVIEW-STATUS.md) for this locale.
