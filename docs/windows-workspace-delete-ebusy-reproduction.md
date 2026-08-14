# Windows workspace deletion `EBUSY` investigation

Diagnostic handoff for an intermittent packaged-desktop failure where deleting
a workspace reports:

```text
Failed to verify worktree removal at <path>:
EBUSY: resource busy or locked, rmdir '<path>'
```

Do not implement a fix until this failure can be reproduced through Superset.
The original watcher theory and a controlled external process test have both
failed to reproduce it in the packaged app.

## Observed failure

Verified on Windows with packaged Superset `1.20.2` on 2026-08-13.

Two CRM-1337 workspace deletions failed in one app session. After each failure:

- `git worktree list --porcelain` no longer contained the target. Git had
  successfully unregistered it.
- One target was an empty directory. The other retained most of its checkout.
- Both live workspace rows were restored by the archive-first delete saga.
- Neither workspace had a remaining `terminal_sessions` row.
- No live process exposed either target as its current working directory when
  processes were inspected after the failure.
- The same isolated `fs-watcher-subprocess.js` process remained alive.

This locates the surfaced error after Git registration removal, during residual
filesystem cleanup. It does not identify which Windows handle owned the
directory at the failing instant. A PC restart consistently clears the
condition and lets Superset delete workspaces again, but the narrower process or
handle responsible has not been established.

## Delete branch is not the trigger

The delete dialog's **Delete branch** option is processed after worktree
removal and residual directory cleanup. The reported exception is thrown during
that earlier cleanup, before branch deletion can run.

Test both checkbox states when gathering natural evidence, but do not treat the
checkbox as a likely cause of this `EBUSY` failure.

## Failed reproduction attempts

### Suspending the filesystem watcher

Tested on packaged Superset `1.20.2` on 2026-08-14:

1. Created a disposable CRM workspace containing about 80,001 files.
2. Opened its Files tab and confirmed the recursive watcher was active.
3. Suspended the `Superset.exe` child running
   `fs-watcher-subprocess.js`.
4. Deleted the workspace through the normal v2 UI.

Deletion succeeded completely. Git registration and the entire worktree
directory disappeared, no deletion error was logged, and the watcher was then
resumed. Suspending an established Files watcher is therefore not a
deterministic reproduction on this build.

This does not rule out a narrower watcher startup or release race, but it means
the former watcher-handshake fix must not be restored based on this experiment.

### External process with the worktree as its current directory

On 2026-08-14, a separate PowerShell process was parked in a disposable
workspace directory while the workspace was deleted through Superset. The
workspace still deleted successfully.

The same general condition does make an isolated call to Node's
`fs.rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })`
fail with the exact `EBUSY` and `rmdir` message while another process uses a
plain test directory as its current directory. The identical removal succeeds
as soon as that process exits.

That raw filesystem probe demonstrates a valid Windows failure mechanism, but
it is not a reproduction of the Superset bug. The full Git worktree removal
sequence behaves differently, so do not use this probe as evidence for a PTY
fix.

## Current hypotheses

The deletion path requests terminal and watcher cleanup, runs
`git worktree remove --force --force`, verifies that Git unregistered the
worktree, and then retries residual Node removal five times at 100 ms intervals.
The observed failure means some transient condition lasted beyond that short
retry window.

Plausible sources still requiring evidence are:

- a Superset PTY descendant that survives long enough to overlap removal;
- a watcher handle during subscription startup or asynchronous release;
- Git, a setup script, a package manager, or an agent still touching files;
- antivirus, indexing, backup, or another external filesystem filter;
- a Windows filesystem timing issue that depends on a long-lived app session.

Relevant code:

- `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts`
- `packages/host-service/src/events/event-bus.ts`
- `packages/host-service/src/events/git-watcher.ts`
- `packages/workspace-fs/src/subprocess/subprocess-watcher-manager.ts`
- `packages/workspace-fs/src/subprocess/run-subprocess.ts`
- `packages/host-service/src/workers/tasks/git.ts`
- `packages/host-service/src/workers/tasks/filesystem.ts`

## Next reproduction strategy

Prefer capturing the next natural failure over adding a speculative fix.

1. Install or arrange Sysinternals Process Monitor or Handle before testing.
2. Run Process Monitor during normal packaged-app use, filtered to the
   disposable worktree root and sharing violations or access-denied results.
3. Exercise realistic long-lived states: completed and active setup scripts,
   terminals, agents, dev servers, Files tabs, and immediate deletion after
   stopping a process.
4. On failure, do not retry, close Superset, or reboot until evidence is
   captured.
5. Record the worktree path, workspace ID, checkbox state, active panes,
   terminal and agent PIDs, `git worktree list --porcelain`, remaining directory
   contents, host log timestamps, and the process responsible for the failing
   filesystem operation.
6. Try fully exiting Superset before rebooting. If that alone releases the
   directory, inspect the Superset process tree first. If it does not, inspect
   external filesystem filters and processes.

A complete verification gate must show the same real UI journey failing before
the fix and succeeding after it under equivalent process, watcher, and
filesystem observations.

## Resume checklist

Investigation paused on 2026-08-14. No Superset UI reproduction exists yet, and
no production fix should be attempted from the current evidence.

Resume with these options, in priority order:

1. **Capture normal use with Process Monitor.** Filter paths under
   `D:\stash\superset-wt`, retain sharing-violation, lock-violation, and
   access-denied results, and stop capture immediately after a natural failure.
   This is the best chance of identifying a short-lived owner that exits before
   manual inspection.
2. **Add diagnostic-only deletion logging.** Without changing cleanup timing or
   retry behavior, log phase timestamps, terminal IDs and PIDs, watcher cleanup
   requests, Git removal results, worktree registration, residual removal
   errors, and the remaining Superset process tree.
3. **Run a real packaged-UI soak matrix.** Repeatedly create and delete
   disposable workspaces while varying Files-tab state, terminal and agent
   activity, setup scripts, package managers, dev servers, time since process
   shutdown, and total app-session age. Record the delete-branch checkbox only
   as a control variable.
4. **Classify ownership after a natural failure.** Capture evidence first, then
   test whether fully exiting Superset releases the directory. If it does,
   isolate the host service, PTY daemon, and watcher processes. If it does not,
   inspect external tools and filesystem filters before rebooting.
5. **Use deliberate fault injection only to test recovery.** A diagnostic build
   may intentionally hold the directory before residual removal to exercise the
   rollback path, but that does not reproduce or explain the natural bug.

The first useful milestone is not a code fix. It is either a repeatable real UI
journey or a Process Monitor trace that identifies the process and operation at
the natural failure timestamp.

## Prior implementation and revert

The branch previously implemented a watcher synchronization mechanism:

- `f1ef8d488 fix(windows): Await workspace watcher cleanup`

It made watcher disposal awaitable and added an `unsubscribed` child-process
acknowledgement before directory removal. It was reverted the next day:

- `dd5676bd3 revert(windows): Drop watcher cleanup handshake`

The revert commit does not explain the runtime reason. Do not restore
`f1ef8d488` blindly. The suspended-watcher experiment above did not reproduce
the failure. If future evidence implicates watcher cleanup, first test:

- deletion while the watcher subscription is still starting;
- watcher-child crash or exit during unsubscribe;
- duplicate or already-removed subscriptions;
- bounded timeout behavior so deletion cannot hang forever;
- multiple workspaces sharing the watcher child;
- the natural failing journey that identifies the watcher as the lock owner.

## Diagnostic dead ends

- `superset` was not on the investigating PowerShell session's `PATH`, despite
  the packaged desktop and host service running. The packaged CLI was later
  found under the installed application's resources directory.
- Sysinternals `handle.exe` and Process Monitor were not installed.
- Windows Restart Manager returned access denied when asked to enumerate locks
  on the directory paths.
- `openfiles /query` did not identify the local handles.
- Process command lines are insufficient because shells and MCP sidecars omit
  their working directory. Reading each process PEB exposed current directories
  but found no surviving CRM-1337 process after the failures.
- Suspending an established filesystem watcher did not reproduce the error.
- Holding a disposable worktree as an external PowerShell current directory did
  not reproduce the error through Superset, even though it reproduced the same
  error against an isolated Node removal call.

Capture live handle evidence before selecting another fix.
