# Windows workspace deletion `EBUSY` reproduction

Diagnostic handoff for an intermittent packaged-desktop failure where deleting
a workspace reports:

```text
Failed to verify worktree removal at <path>:
EBUSY: resource busy or locked, rmdir '<path>'
```

## Observed state

Verified on Windows with packaged Superset `1.20.2` on 2026-08-13.

Two CRM-1337 workspace deletions failed in one app session. After each failure:

- `git worktree list --porcelain` no longer contained the target. Git had
  successfully unregistered it.
- One target was an empty directory. The other retained most of its checkout.
- Both live workspace rows were restored by the archive-first delete saga.
- Neither workspace had a remaining `terminal_sessions` row.
- No live process exposed either target as its current working directory.
- The same isolated `fs-watcher-subprocess.js` process remained alive.

This locates the surfaced error after Git registration removal, during residual
filesystem cleanup. It does not prove which individual Windows handle owned the
directory at the failing instant.

## Leading cause: watcher release race

The Windows watcher runs in a child process because the native
`ReadDirectoryChangesW` backend is isolated from the host service. Workspace
deletion currently starts watcher cleanup but does not wait for the child to
confirm that the native subscription has closed:

1. `workspaceCleanup.destroy` calls `ctx.eventBus.unwatchWorkspace(...)` and
   immediately continues to worktree removal.
2. `GitWatcher.startWorktreeWatch` calls `iterator.return()` without awaiting
   it.
3. `SubprocessWatcherManager.unsubscribe` sends an `unsubscribe` IPC message
   without waiting for a response.
4. The watcher child invokes the native unsubscribe asynchronously and sends no
   completion acknowledgement.
5. `git worktree remove --force --force` unregisters the worktree. Node then
   retries residual recursive removal only five times, 100 ms apart.

The final `rmdir` can therefore exhaust its roughly 500 ms retry window while
the watcher child still owns a directory handle.

Relevant code:

- `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts`
- `packages/host-service/src/events/event-bus.ts`
- `packages/host-service/src/events/git-watcher.ts`
- `packages/workspace-fs/src/subprocess/subprocess-watcher-manager.ts`
- `packages/workspace-fs/src/subprocess/run-subprocess.ts`
- `packages/host-service/src/workers/tasks/filesystem.ts`

## Deterministic reproduction

Use a disposable v2 workspace in the packaged Windows desktop app.

1. Open the workspace and its Files tab so its recursive filesystem watch is
   active.
2. In Process Explorer, identify the `Superset.exe` child whose command line
   ends in `fs-watcher-subprocess.js`.
3. Suspend that child process.
4. Delete the workspace through the normal Superset UI.
5. Observe that Git unregisters the worktree, followed by the `EBUSY` `rmdir`
   failure after the short Node retry window.
6. Resume the watcher child.

For a natural stress reproduction, repeatedly open and delete disposable
workspaces while their Files tabs are active and files are changing. This is
timing-dependent; suspending the watcher makes the ownership window stable.

Before changing code, capture the target worktree list and directory contents
before and after the delete. A complete verification must show the same journey
failing before the fix and succeeding after it.

## Prior implementation and revert

The branch previously implemented the likely synchronization mechanism:

- `f1ef8d488 fix(windows): Await workspace watcher cleanup`

It made watcher disposal awaitable and added an `unsubscribed` child-process
acknowledgement before directory removal. It was reverted the next day:

- `dd5676bd3 revert(windows): Drop watcher cleanup handshake`

The revert commit does not explain the runtime reason. Do not restore
`f1ef8d488` blindly. First test these cases:

- deletion while the watcher subscription is still starting;
- watcher-child crash or exit during unsubscribe;
- duplicate or already-removed subscriptions;
- bounded timeout behavior so deletion cannot hang forever;
- multiple workspaces sharing the watcher child;
- natural and suspended-child `EBUSY` reproduction on the packaged app.

The desired contract is bounded acknowledgement: proceed when native release is
confirmed, and fail or fall back deliberately when the child disappears or the
wait times out.

## Secondary race to keep separate

Windows PTY closure is also asynchronous. The daemon acknowledges `closed`
after initiating ConPTY teardown, not after proving every descendant process is
gone. A terminal or agent process whose current directory is the worktree can
produce the same `EBUSY` symptom.

For each reproduction, record process current directories before deletion. If
a target process survives, diagnose PTY shutdown separately instead of treating
the watcher handshake as sufficient.

## Diagnostic dead ends

- `superset` was not on the investigating PowerShell session's `PATH`, despite
  the packaged desktop and host service running.
- Sysinternals `handle.exe` was not installed.
- Windows Restart Manager returned access denied when asked to enumerate locks
  on the directory paths.
- `openfiles /query` did not identify the local handles.
- Process command lines are insufficient because shells and MCP sidecars omit
  their working directory. Reading each process PEB exposed current directories
  and found no surviving CRM-1337 process after the failures.

Install or arrange a handle-enumeration tool before the next live reproduction
if the exact owning handle is required.
