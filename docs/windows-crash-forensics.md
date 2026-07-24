# Windows crash forensics — filesystem-watcher native crashes

Diagnosis notes for the recurring Windows filesystem-watcher crash and the
procedure used to capture a native stack. Referenced from **W15** and **W30** in
[`windows-port-patch-list.md`](windows-port-patch-list.md) (same dependency,
different failure modes). **W30 contains the fault by running the native watcher
in a restartable child process; it does not fix the fault inside
`@parcel/watcher`.**

## Symptom

Before W30, the tray showed **"Host service crashed (exit code 3221225477)"** and
in-flight renderer calls failed (e.g. workspace creation showed **"Failed to
fetch"**). The host-service log ended on a normal
`[host-service:diagnostics] heartbeat` because a native crash leaves no JS trace;
the safety net in `packages/host-service/src/safety.ts` only catches JS
`uncaughtException` / `unhandledRejection`, never a hard native fault.

After W30, the host-service stays alive and logs:

```text
[fs-watcher] child exited (code=3221225477 signal=null); respawning and re-subscribing …
```

The replacement `Superset.exe … fs-watcher-subprocess.js` child should appear
within seconds, and file-tree/git-status updates should resume.

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

## Capturing a native stack (post-W30 repro procedure)

Do not rely on WER `Application Error` (1000) events or
`%LOCALAPPDATA%\CrashDumps`; prior reproductions produced neither. Attach
ProcDump to the isolated watcher child instead (same-user attach — no admin):

1. Get ProcDump (Sysinternals, standalone): download `Procdump.zip`, unzip.
2. Find the `Superset.exe` child whose command line contains
   `fs-watcher-subprocess.js`:
   ```powershell
   $watcherProcess = Get-CimInstance Win32_Process -Filter "Name='Superset.exe'" |
     Where-Object { $_.CommandLine -match 'fs-watcher-subprocess\.js' } |
     Select-Object -First 1

   $watcherProcess | Select-Object ProcessId, CommandLine
   ```
   Never select by bare `Superset.exe` name; renderers, GPU processes, the
   host-service, and other helpers share it.
3. Attach for a full dump on the next unhandled (second-chance) exception:
   ```powershell
   procdump64.exe -accepteula -ma -e $watcherProcess.ProcessId fs-watcher.dmp
   ```
4. Reproduce worktree churn (workspace create/destroy is the known
   correlation). ProcDump writes the dump when the watcher child faults. W30
   then replaces that child, so find the new PID and re-attach if another
   capture is required.
5. Confirm containment separately: the host-service PID and uptime must remain
   continuous while its log records the watcher-child exit and re-subscription.
6. Identify the faulting module without symbols by parsing the minidump's
   `ModuleListStream` (type 4) + `ExceptionStream` (type 6): map
   `ExceptionAddress` into `[BaseOfImage, +SizeOfImage)`. Field offsets that
   bit me: array starts at `streamRva+4`; per-module `ModuleNameRva` is at
   **+20** (after `BaseOfImage`/8, `SizeOfImage`/4, `CheckSum`/4,
   `TimeDateStamp`/4), record stride 108.

If W30 logs `subprocess script not found … falling back to in-process watcher`,
the fault is back inside `host-service.js`. Only in that fallback diagnosis
should ProcDump target the `Superset.exe … host-service.js` process.
