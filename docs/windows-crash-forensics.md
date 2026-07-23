# Windows crash forensics — host-service native crashes

Diagnosis notes for the recurring Windows host-service crash and the procedure
used to capture a native stack. Referenced from **W15** in
[`windows-port-patch-list.md`](windows-port-patch-list.md) (same dependency,
different failure mode). No fix is committed yet — this records the diagnosis so
the next agent doesn't re-derive it.

## Symptom

The tray shows **"Host service crashed (exit code 3221225477)"**; in-flight
renderer calls fail (e.g. workspace creation shows **"Failed to fetch"**). The
host-service log ends on a normal `[host-service:diagnostics] heartbeat` with no
error — a native crash leaves no JS trace, and the safety net in
`packages/host-service/src/safety.ts` only catches JS `uncaughtException` /
`unhandledRejection`, never a hard native fault.

## Reading the exit code

The exit code is the raw Windows exception code the process died on:

- `3221225477` = `0xC0000005` = **STATUS_ACCESS_VIOLATION**
- `3221226356` = `0xC0000374` = **STATUS_HEAP_CORRUPTION** (this is W27 —
  node-pty/ConPTY teardown; a *different* crash)

`0xC0000005` recurs across days and predates the W28/W29 work — it is **not**
caused by the AI-workspace-naming patch. The `pwsh.exe` FailFast events in the
Application event log (`.NET Runtime`, id 1025, "No process is on the other end
of the pipe … get_CursorPosition") are a *separate* bug — an interactive `pwsh`
spawn — fixed by the final W29 (`NAMING_SHELL="powershell"` →
`-NoLogo -NoProfile -Command`). They do not crash the host.

## Confirmed root cause (2026-07-23)

The `0xC0000005` is a native access violation **inside
`@parcel/watcher@2.5.6`'s Windows backend** (`watcher-win32-x64/watcher.node`).
Confirmed from a full dump: the faulting instruction pointer fell inside that
module's address range, on a **small worker-thread stack** — i.e. one of
parcel-watcher's own `ReadDirectoryChangesW` watch threads, not the JS main
thread. That is why nothing in JS can catch it.

It correlates with **worktree churn** (workspace create/destroy creates and
removes watch roots). The likely trigger is a watch still active on a worktree
directory as it is force-removed (**W14**'s `fs.rm` backstop) — a deleted
directory under `ReadDirectoryChangesW` can fault the native completion thread.
Not yet proven at the code level; **unconfirmed fix**.

Relationship to **W15**: W15 pins the win32 backend to `"windows"`
(`ReadDirectoryChangesW`) to avoid the watchman console-flash. That is the exact
backend now faulting — so any mitigation must preserve W15 (do **not** re-enable
the watchman probe).

### Recommended fix direction

> **Status: implemented** in patch-list entry **W30** (win32 fs-watcher runs in
> an isolated child process). The notes below are the reasoning that led there.

**Process-isolate the watcher.** On Windows the only `subscribe()`-capable
@parcel/watcher backends are `windows` (`ReadDirectoryChangesW`, the one
faulting) and `watchman` (needs watchman installed + the flash probe) — there is
no polling alternative for live watching (see the brute-force dead-end below).
So the native backend can't be swapped away; instead run `FsWatcherManager` in a
dedicated child process (mirror `terminal-host` / `pty-daemon`; `workspace-fs`
already has a `client`/`host` transport split to build on) so a native UAF only
kills+restarts that subprocess, never the in-process host-service. Keeps the
fast event-driven native backend and adds no polling cost — important because
the real repos here are large (e.g. `phocas`: ~14k tracked files, ~9.6k
directories after pruning).

### Dead-ends (do NOT repeat)

- **`backend: "brute-force"` does NOT work for watching.** It looks tempting (no
  persistent native watch thread → no UAF, and it's a valid `BackendType`), but
  parcel's `BruteForceBackend::subscribe()` throws
  `"Brute force backend doesn't support subscriptions."` — it only implements
  the snapshot API (`writeSnapshot`/`getEventsSince`). Pinning it makes every
  `subscribe()` throw, breaking the file tree and git-status watching. (A manual
  poll loop calling `getEventsSince` on a timer *is* possible with brute-force,
  but re-crawls the whole tree each tick — costly on large repos like `phocas`,
  and a full `watch.ts` rewrite.)
- A native fault cannot be swallowed in-process; do not attempt a JS `try/catch`
  or safety-net "fix" — it will not work.

### Other leads

- Ensure every watcher subscribed to a worktree path is `unsubscribe()`d
  **before** the directory is `fs.rm`'d in
  `packages/host-service/.../workspace-cleanup/workspace-cleanup.ts` (W14) and
  in the setup/teardown churn — may reduce trigger frequency but can't close a
  native race inside parcel's own C++.
- Track upstream: `@parcel/watcher` Windows `ReadDirectoryChangesW` AV reports.
  2.5.6 is the current release, so this may need a patched addon or an upstream
  fix rather than a version bump.

## Capturing a native stack (repro procedure)

Electron **Crashpad** intercepts the unhandled exception in-process, so no WER
`Application Error` (1000) event and no `%LOCALAPPDATA%\CrashDumps` dump are
produced for the host-service child. Attach a real debugger to the child instead
(same-user attach — no admin):

1. Get procdump (Sysinternals, standalone): download `Procdump.zip`, unzip.
2. The host-service runs as `Superset.exe "<...>\dist\main\host-service.js"`
   (a `child_process.spawn(process.execPath, …)` run-as-node child — **no**
   Crashpad in run-as-node mode, so a debugger catches the fault cleanly). It is
   spawned on demand and respawned by the coordinator, so poll for it and attach
   the instant it appears:
   ```powershell
   # find the pid
   Get-CimInstance Win32_Process -Filter "Name='Superset.exe'" |
     Where-Object { $_.CommandLine -match 'host-service\.js' } |
     Select-Object ProcessId
   # attach: full dump on the next unhandled (2nd-chance) exception
   procdump64.exe -accepteula -ma -e <pid> hostsvc.dmp
   ```
   (Re-arm across respawns with a poll loop; key on the `host-service.js`
   command line, never a bare `Superset.exe` name — renderers/GPU share it.)
3. Reproduce (create a workspace). procdump writes a full `.dmp` on the AV.
4. Identify the faulting module without symbols by parsing the minidump's
   `ModuleListStream` (type 4) + `ExceptionStream` (type 6): map
   `ExceptionAddress` into `[BaseOfImage, +SizeOfImage)`. Field offsets that
   bit me: array starts at `streamRva+4`; per-module `ModuleNameRva` is at
   **+20** (after `BaseOfImage`/8, `SizeOfImage`/4, `CheckSum`/4,
   `TimeDateStamp`/4), record stride 108.
