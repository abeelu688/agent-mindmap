# PR Plan: Push-to-Team by Command, Not Auto

> **Repo**: `agent-mindmap` (TypeScript extension)
> **Scope**: Remove all automatic push triggers; add a manual command to push local sessions to the team service.
> **Motivation**: Dashboard shows 0 projects / 0 sessions because automatic push is unreliable and uncontrollable. The user wants explicit control over when data is pushed to the server.
> **Status legend**: ⬜ not started

---

## Current automatic push triggers (all to be removed)

| #   | Location                                                        | What it does                                                                                       | Remove? |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------- |
| A   | `TeamStore.upsertRecord()` (`shared/src/store/teamStore.ts:76`) | `void this.queue.enqueue(record)` — fire-and-forget push after every local write                   | ✅      |
| B   | `PushQueue.enqueue()` (`extension/src/store/pushQueue.ts:57`)   | `void this.drain()` — auto-triggers network push immediately after writing pending flag            | ✅      |
| C   | `extension.ts:268`                                              | `drainAllPushQueues()` on activation                                                               | ✅      |
| D   | `extension.ts:275`                                              | `runBulkPushIfNeededNow(context)` on activation — one-shot bulk push on first team-mode enablement | ✅      |

---

## PR sequence

### P1 — Remove automatic push triggers

**Goal**: `TeamStore.upsertRecord()` writes locally only; no network calls happen without explicit user action.

**Changes**:

1. **`shared/src/store/teamStore.ts`** — `upsertRecord()`:
   - Remove `void this.queue.enqueue(record).catch(...)` (line 76).
   - Keep local write: `const result = await this.local.upsertRecord(record)`.
   - The `queue` constructor param and field stay (the command in P2 will use it).

2. **`extension/src/store/pushQueue.ts`** — `enqueue()`:
   - Remove `void this.drain()` (line 57).
   - `enqueue()` now only writes the `push-pending:<slug>` kv flag — it does **not** trigger a network call.
   - Update the method JSDoc to reflect this.

3. **`extension/src/extension.ts`** — activation:
   - Remove `drainAllPushQueues()` call (line 268) and its import.
   - Remove `runBulkPushIfNeededNow(context)` call (line 275).
   - Keep `disposePushQueues()` in `deactivate()` — it cancels retry timers from a command-triggered push that's still in flight during shutdown.

4. **`extension/src/store/storeClient.ts`** — cleanup:
   - `drainAllPushQueues()` stays (P2 command uses it), but remove `runBulkPushIfNeeded` import since it's no longer called from activation.
   - Remove `runBulkPushIfNeededNow()` export; keep `drainAllPushQueues()` and `disposePushQueues()`.

5. **`extension/src/store/bulkPush.ts`** — simplify:
   - Remove the `bulkPushDone` globalState check. The command in P2 replaces this — every invocation pushes unpushed records (idempotent via watermark).
   - Remove `BULK_PUSH_DONE_KEY` constant.
   - Keep `setPendingFlagsForAllProjects()` — the P2 command reuses it.
   - Rename `runBulkPushIfNeeded()` → `pushLocalRecordsToTeam()` (no longer "bulk push if needed", just "push").
   - Simplify `BulkPushResult` type: remove `skipped: "already-done"` variant (no more flag). Keep `skipped: "team-mode-off" | "no-local-store"`, `noop`, `done`.

**Tests**:

- `test/store/pushQueue.test.ts`: update tests that relied on `enqueue` auto-triggering drain. After P1, `enqueue` only writes the pending flag; `drain()` must be called explicitly. Add a test that `enqueue` does NOT call `fetch`.
- `test/store/remoteStore.test.ts`: no changes (RemoteStore is untouched).
- `test/mcpShared.test.ts`: verify TeamStore.upsertRecord doesn't trigger network.

---

### P2 — Add "Push to Team Service" command

**Goal**: A VS Code command that the user explicitly triggers to push all unpushed local sessions to the team service.

**New file**: `extension/src/commands/pushToTeam.ts`

**Command logic** (`commandPushToTeam`):

```
1. Check team mode is enabled (isTeamModeEnabled()).
   Not enabled → show warning "Team mode is not configured." → return.
2. Get local SqliteStore (getLocalSqliteStore()).
   Not available → show error → return.
3. List all local records (local.listAllRecords()).
   Empty → show info "No local sessions to push." → return.
4. Compute unpushed count: records where analyzedAt > watermark for their project.
   If 0 → show info "All sessions are already pushed." → return.
5. Set pending flags for all projects with unpushed records
   (setPendingFlagsForAllProjects from bulkPush.ts).
6. Show progress notification, drain all push queues:
   await vscode.window.withProgress({
     location: ProgressLocation.Notification,
     title: "Agent Mind Map: Pushing sessions to team service…",
     cancellable: false,
   }, () => drainAllPushQueues());
7. Show result: "Pushed N sessions to team service."
```

**Command registration**:

- `extension/package.json` → `contributes.commands`:

  ```json
  {
    "command": "agent-mindmap.pushToTeam",
    "title": "Agent Mind Map: Push Sessions to Team Service",
    "category": "Agent Mind Map"
  }
  ```

- `extension/src/extension.ts` → register command:
  ```ts
  vscode.commands.registerCommand(
    "agent-mindmap.pushToTeam",
    wrapCommand(() => commandPushToTeam(context))
  );
  ```

**When clause** (optional, nice-to-have): command only appears in palette when team mode is enabled. Add a context key `agentMindmap:teamModeEnabled` set at activation, and use `"when": "agentMindmap:teamModeEnabled"` on the command. Can defer to a follow-up if it adds complexity.

**l10n** — add keys to both bundles:

| Key                     | English                                                                          | 中文                                                          |
| ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `team.push.notEnabled`  | Team mode is not configured. Set `agentMindmap.team.serverUrl` to enable.        | 团队模式未配置。请设置 `agentMindmap.team.serverUrl` 以启用。 |
| `team.push.noRecords`   | No local sessions to push.                                                       | 没有本地会话需要推送。                                        |
| `team.push.allPushed`   | All sessions are already pushed.                                                 | 所有会话已推送完毕。                                          |
| `team.push.title`       | Agent Mind Map: Pushing sessions to team service…                                | Agent Mind Map: 正在推送会话到团队服务…                       |
| `team.push.done`        | Pushed {0} sessions to team service.                                             | 已推送 {0} 个会话到团队服务。                                 |
| `team.push.partialFail` | Pushed {0} sessions. Some sessions failed — retry the command to push remaining. | 已推送 {0} 个会话。部分推送失败——请重试命令推送剩余记录。     |

**Tests**:

- New `test/commands/pushToTeam.test.ts`: mock `isTeamModeEnabled`, `getLocalSqliteStore`, `drainAllPushQueues`. Verify:
  - Team mode off → warning shown, no drain.
  - No records → info shown, no drain.
  - All pushed → info shown, no drain.
  - Has unpushed records → pending flags set, drain called, success message shown.
  - Partial failure → partial-fail message shown.

---

### P3 — Update PushQueue drain to not auto-retry

**Goal**: After a command-triggered push fails, don't schedule automatic retries. Let the user re-run the command instead.

**Changes**:

1. **`extension/src/store/pushQueue.ts`** — `drain()`:
   - Remove `scheduleRetry()` on failure. On `drainOnce()` error, just log a warning and stop.
   - Remove the `retryTimer`, `retryAttempts`, `scheduleRetry()`, `clearRetryTimer()` fields/methods.
   - Remove the `MAX_RETRIES_PER_DRAIN` constant.
   - Simplify the drain loop: try `drainOnce()`, if it fails → log + break (no retry).
   - The `dispose()` method becomes a no-op (no timers to clear). Keep it for API compatibility.

2. **`extension/src/store/pushQueue.ts`** — update `__testing`:
   - Remove `BACKOFF_BASE_MS`, `BACKOFF_MAX_MS`, `MAX_RETRIES_PER_DRAIN` exports.

**Rationale**: With auto-push, retries made sense (recover from transient network issues without user intervention). With manual push, the user sees the progress notification and the result message. If it fails, they re-run the command. Auto-retry in the background would be confusing — the user wouldn't know when it finishes or if it's still retrying.

**Alternative considered**: Keep retry but cap at 1 retry. Rejected — adds complexity for marginal benefit when the user can just re-run the command.

**Tests**:

- Update `test/store/pushQueue.test.ts`:
  - Remove test "drain retries on failure with backoff" (no longer applicable).
  - Add test: drain fails → watermark stays at last successful value, pending flag stays set, no retry scheduled.
  - Add test: user re-runs drain → picks up from watermark, pushes remaining.

---

## File change summary

| File                                    | PR    | Change                                                                                                   |
| --------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------- |
| `shared/src/store/teamStore.ts`         | P1    | Remove `queue.enqueue()` from `upsertRecord()`                                                           |
| `extension/src/store/pushQueue.ts`      | P1+P3 | Remove auto-drain from `enqueue()`, remove auto-retry from `drain()`                                     |
| `extension/src/store/bulkPush.ts`       | P1    | Remove `bulkPushDone` flag, rename to `pushLocalRecordsToTeam()`, keep `setPendingFlagsForAllProjects()` |
| `extension/src/store/storeClient.ts`    | P1    | Remove `runBulkPushIfNeededNow()`, remove activation auto-push, keep `drainAllPushQueues()`              |
| `extension/src/extension.ts`            | P1+P2 | Remove auto-push calls, register new command                                                             |
| `extension/src/commands/pushToTeam.ts`  | P2    | **New file** — command implementation                                                                    |
| `extension/package.json`                | P2    | Register `agent-mindmap.pushToTeam` command                                                              |
| `extension/l10n/bundle.l10n.json`       | P2    | Add l10n keys                                                                                            |
| `extension/l10n/bundle.l10n.zh-cn.json` | P2    | Add l10n keys                                                                                            |
| `test/store/pushQueue.test.ts`          | P1+P3 | Update tests for no-auto-drain, no-auto-retry                                                            |
| `test/commands/pushToTeam.test.ts`      | P2    | **New file** — command tests                                                                             |

---

## What stays the same

- **Local analysis**: pipeline runs locally, writes to SqliteStore — unchanged.
- **PushQueue watermark mechanism**: `push-watermark:<slug>` / `push-pending:<slug>` kv keys — unchanged. The command uses the same watermark to determine what's unpushed.
- **RemoteStore**: HTTP client with its own retry/backoff — unchanged.
- **TeamStore read paths**: all delegate to RemoteStore — unchanged.
- **TeamStore.upsertRecord() return value**: still returns local write result `{ revision }` — unchanged.

---

## Open question

- **Push per-project or all projects?** Current plan pushes all projects at once. If the user has many projects and only wants to push one, a future command variant could accept a project picker. For v1, "push all" is simpler and matches the dashboard's global view.
