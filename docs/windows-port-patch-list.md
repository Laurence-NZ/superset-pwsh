# superset-pwsh — Windows Port Patch List

Single source of truth for everything this fork carries
on top of upstream `main`. The `/merge-upstream` skill walks this list after
each merge to confirm every patch is still present and still correct — text
auto-merges, behaviour breaks silently.

**Scope: Superset v2 only.** v2 is the ground-up rebuild of the desktop shell
(from-scratch terminal, IDE-like Tab/Split/Pane layout, file tree, editor, diff
viewer) — not just a cloud feature; v1 is the legacy chat-first UX. Dev builds
default to v2 and every patch here targets v2's terminal/agent/workspace paths.
v1 is untested on Windows and out of scope — don't patch or verify v1 paths.

## How to walk this list (run after each `main` merge)

Each entry describes an **invariant**, not a one-time diff. Two things can break
it on a merge: upstream rewrites a file we patched (our change vanishes), **or**
upstream adds *new* code that violates the same rule (a fresh `child_process`
spawn with no `windowsHide`, a new Unix `.sock` path, a new `&&`-joined terminal
command). Both must be caught.

For **each** patch entry:

1. **Anchor on the commit(s).** The listed hashes are where we applied the rule —
   stable across merges even when upstream rewrites surrounding code
   (`git show <hash>`). An entry may list several commits, and the set grows over
   time as new violation sites are patched. The hashes are provenance, **not** the
   full scope — the scope is the **Invariant**.
2. **Re-verify existing sites.** Read the "Where" files; confirm the change is
   still present and still needed. If upstream refactored a target away with no
   conflict marker, re-apply from "Invariant / Why" and commit as `fix(...)`.
3. **Scan the incoming diff for NEW violations.** Run the entry's **Scan for**
   signature against everything the merge pulled in. Any new upstream code that
   trips it needs the same treatment — patch it, add the commit to this entry.
4. **Apply the Override policy:**
   - **LOCKED** — ours is the only viable approach (Windows-specific; upstream
     targets macOS/Linux). Keep it; there is no upstream fix to defer to.
   - **OVERRIDABLE** — if `main` now ships an equivalent bug fix or feature,
     **do not switch silently. Notify the user** (name the patch and the upstream
     equivalent). They will most likely want our version removed and upstream's
     adopted — but that call is theirs to make, so surface it and wait.
     The trigger to look for is named in the entry.
5. After the walk, `bun run typecheck` and `bun run lint` must pass (CI treats
   warnings as errors; keep biome `lineEnding` = `lf`, never `auto`).

## Sections

- **§1 — Windows support patches.** Changes whose only purpose is making
  Superset build/run on Windows. Almost all **LOCKED**.
- **§2 — Features & fixes.** Bug fixes and new functionality unrelated to the
  Windows port (e.g. the commits-to-pull indicator). Mostly **OVERRIDABLE** —
  if upstream ships the same fix/feature, switch to theirs.

---

# §1 — Windows support patches

## W1 — Foundational native Windows x64 desktop port

- **Commits:** `61132970e` (broad sweep — `git show 61132970e` for the full set);
  `0ff4d94f4` (2026-07-20 merge: routed upstream's new `startKnownHostServices`
  cloud-URL call site through `getMainApiUrl()` instead of the undefined
  `mainEnv` — packaged-build URL sanitization choke point in
  `apps/desktop/src/main/index.ts` / `desktop-runtime-flags.ts`);
  `1346623b8` (2026-07-21 merge: upstream bumped `node-pty` `1.1.0` →
  `1.2.0-beta.14` and wrapped `pty-daemon` `spawn()` in try/catch cleanup —
  re-kept the `getMasterFd()` win32 guard (`_fd` handoff is POSIX-only) and made
  the spawn-time fd validation `if (process.platform !== "win32")` inside the new
  cleanup block, in `packages/pty-daemon/src/Pty/Pty.ts`);
  `900cff632` (2026-07-22 merge: upstream #5823 added two new daemon integration
  tests that hardcoded a Unix `.sock` path + `existsSync` readiness — adapted
  both to `makeTestDaemonSocketPath` + the `isWindowsNamedPipe ? canConnect :
  existsSync` readiness check, matching the sibling tests in
  `packages/host-service/test/integration/terminal.integration.test.ts`. New
  daemon integration tests must use the named-pipe-aware helpers, never a raw
  `.sock` path.)
- **Override policy:** **LOCKED.** Upstream targets macOS/Linux; there is no
  upstream Windows port to defer to. Later, finer-grained W-entries refine and
  extend this base; verify them individually as they are migrated in.
- **Scan for:** This entry is coarse — its recurring invariants (no un-hidden
  `child_process` spawns, named pipes not `.sock`, shell-aware chaining not `&&`,
  `.cmd` agent wrappers, etc.) are broken out into the individual W-entries below
  (W2+), each with its own precise **Scan for** signature. Walk those; this entry
  is just the "does the app still build on Windows" umbrella check.
- **What:** The base port that makes the desktop app build, install, launch,
  authenticate, sync, run terminals, and manage workspaces natively on Windows
  x64 while preserving existing macOS/Linux behaviour. Uses native Windows
  primitives wherever a Unix assumption previously blocked the app. Areas:
  - Native Windows x64 desktop packaging + per-user NSIS installer generation.
  - Windows named pipes for host-service / terminal-host / pty-daemon control
    channels (previously Unix `.sock` paths).
  - Native shell handling: `cmd.exe`, PowerShell, `pwsh.exe`, Git Bash, ConPTY
    spawn/close, and `taskkill`-based process-tree cleanup.
  - Windows-native agent-wrapper (`.cmd`) and notification-hook entrypoints.
  - Portable Bun/TypeScript package + release scripts replacing POSIX
    `sh -c` / `.sh` launchers.
  - Packaged builds sanitize local dev URLs → cloud defaults (no `localhost:3001`
    leak into installed apps).
  - Local diagnostic switches to disable auto-update checks and analytics
    without breaking normal cloud login/sync.
- **Verify (Windows, from repo root):**
  ```powershell
  bun run --cwd apps/desktop install:deps
  bun run --cwd apps/desktop prebuild
  bun run --cwd apps/desktop build --win --x64
  ```
  Installer output → `apps/desktop/release/Superset-<version>-x64.exe`. If the
  full build stops after `release\win-unpacked`, retry only the packaging step
  (no recompile):
  ```powershell
  $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
  bun run --cwd apps/desktop scripts/run-electron-builder.ts --publish never --win --x64
  ```
- **Build prerequisites:** Bun; Visual Studio Build Tools 2022; MSVC v143 C++
  x64/x86 compiler tools; MSVC v143 x64/x86 Spectre-mitigated libraries;
  Windows 10 or 11 SDK.
- **Detailed breakdown:** the full granular changelog of this foundational pass
  is archived (frozen, not walked) in
  [`existing-windows-fork-patches.md`](existing-windows-fork-patches.md).

## W2 — Native rebuild pin: `native-keymap` patch + node-pty/winpty

- **Commits:** `ee5eda5c5`
- **Override policy:** **OVERRIDABLE.** Trigger: upstream bumps `native-keymap`
  past `3.3.9`. If it does, notify the user — the pinned patch can likely be
  dropped for the upstream version.
- **Invariant:** The Windows native rebuild needs `native-keymap@3.3.9`
  patched. `patches/native-keymap@3.3.9.patch` must exist and be referenced by
  `patchedDependencies` in the root `package.json`.
- **Where:** `patches/native-keymap@3.3.9.patch`; `patchedDependencies` in root
  `package.json`.
- **Scan for:** merge changes to `native-keymap` version, `patchedDependencies`,
  or deletion of the patch file. Confirm `bun install` + desktop native rebuild
  still succeed.

## W3 — Biome `lineEnding` pinned to `lf`

- **Commits:** `b3d6724f2`
- **Override policy:** **LOCKED.** Never let this flip to `auto` — on Windows
  `auto` resolves to CRLF, so `lint:fix` would rewrite every LF file and corrupt
  the tree (CI is Linux/LF).
- **Invariant:** `biome.jsonc` → `formatter.lineEnding` is `"lf"`.
- **Where:** `biome.jsonc` (line ~22).
- **Scan for:** `"lineEnding"` in `biome.jsonc` — flag anything other than
  `"lf"`. (The old audit prose said `"auto"`; that was wrong — committed value
  is `lf`.)

## W4 — Claude notify-hook command works on Windows

- **Commits:** `b930f6267`
- **Override policy:** **LOCKED** (Windows-specific command construction).
- **Invariant:** The managed Claude notify-hook resolves to a Windows-runnable
  entrypoint (`notify.cmd` / Node dispatcher) rather than a bare POSIX `.sh`
  command. Built in shared helpers, not per-caller.
- **Where:** `@superset/shared/shell` (`getManagedNotifyHookCommand` /
  `buildNotifyHookCommand`); agent notify-hook setup.
- **Scan for:** new notify-hook command construction that emits `bash …` / `.sh`
  with no `.cmd`/Node Windows branch.

## W5 — repoPath-keyed setup override works on Windows

- **Commits:** `98bc94ca9`
- **Override policy:** **LOCKED** (Windows path handling).
- **Invariant:** The host-service runtime setup override keyed on `repoPath`
  resolves correctly with Windows path spelling.
- **Where:** `packages/host-service/src/runtime/setup/config.ts`.
- **Scan for:** merge changes to the setup-override resolution / repoPath keying
  in host-service runtime setup.

## W6 — V2 terminals default to PowerShell 7 (+ Store/MSIX pwsh discovery)

- **Commits:** `668766fe6` (default-to-pwsh-7 + discovery),
  `72e890ba6` (Store/MSIX WindowsApps App Execution Alias discovery)
- **Override policy:** **LOCKED** (Windows shell selection).
- **Invariant:** On win32, V2 terminals default to pwsh 7. Discovery includes
  the `%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe` App Execution Alias and
  version-probes `WindowsApps` candidates directly (they fail `existsSync` /
  `readdirSync`) instead of stat-gating.
- **Where:** `packages/host-service/src/terminal/user-shell.ts` (`discoverPwsh7`,
  `pwshMajorVersion`).
- **Scan for:** merge changes to `user-shell.ts` default-shell logic or pwsh
  discovery; any new `existsSync`/`readdirSync` gate on a `WindowsApps` path.
- **Symptom if broken:** packaged app opens `cmd.exe` terminals while
  `dev:desktop` opens pwsh.

## W7 — Shell-aware V2 launch chaining (preserve `&&`, pwsh `; if ($?)`)

- **Commits:** `6483e7884`
- **Override policy:** **LOCKED** (Windows shell semantics).
- **Invariant:** V2 agent/preset launch commands are chained per target shell —
  `&&` for `cmd.exe`/POSIX, `; if ($?) { … }` for PowerShell — not
  renderer-prejoined `&&`. Command arrays stay arrays until the real shell is
  known.
- **Where:** V2 agent launch command builder; shared shell chaining
  (`@superset/shared/shell`); host-service `initialCommands`/`writeCommands`.
- **Scan for:** new terminal command construction that hard-joins with `&&`
  before the shell is resolved, or a new launch path bypassing the shared
  chaining helper.

## W8 — Ringtone preview via WPF MediaPlayer

- **Commits:** `e29c19079`
- **Override policy:** **LOCKED** (Windows-only sound path; upstream has none).
- **Invariant:** Ringtone **preview** plays on Windows via a WPF MediaPlayer
  branch. (The agent-notification sound path routes through this same
  `play-sound.ts` player, so it's covered too.)
- **Where:** `apps/desktop/src/main/lib/play-sound.ts`.
- **Scan for:** merge changes to `play-sound.ts` that drop the win32 branch.

## W9 — Backfill `PATHEXT` + Windows system env for V2 terminals

- **Commits:** `44cdf3913`
- **Override policy:** **LOCKED** (Windows env construction).
- **Invariant:** `buildV2TerminalEnv` backfills `PATHEXT` + Windows system vars
  into the terminal env snapshot. Without `PATHEXT`, PowerShell/`where.exe`
  can't map a bare name (`git`) to `git.exe`, so nothing on PATH resolves. The
  snapshot is captured at host-service startup, so env changes need a full
  `dev:desktop` restart, not a new terminal tab.
- **Where:** `packages/host-service/src/terminal/env.ts` (`buildV2TerminalEnv`).
- **Scan for:** merge changes to `env.ts` env assembly; any new env-snapshot
  path that omits `PATHEXT`/Windows system vars.
- **Symptom if broken:** every bare command "not recognized" in a V2 terminal,
  but `& 'full\path.exe'` and `Test-Path` work.

## W10 — `windowsHide: true` on spawned console subprocesses

- **Commits:** `5a5a45d4e`
- **Override policy:** **LOCKED** (Windows console-flash suppression).
- **Invariant:** Every `child_process` spawn of a console-subsystem binary from
  a console-less parent (Electron main / host-service) passes
  `{ windowsHide: true }`, or it flashes a console window and can steal focus.
  This is the archetypal "scan the incoming diff" invariant — new spawns arrive
  with every merge.
- **Where (fixed so far):** `packages/host-service/src/ports/tree-kill.ts`
  (`taskkill.exe`); `apps/desktop/src/main/lib/tree-kill.ts` (`taskkill.exe`);
  `apps/desktop/src/main/lib/agent-setup/utils.ts` (`where.exe`, `findRealBinary`).
- **Scan for:** `child_process\.(spawn|exec|execFile)` and `spawnSync`/`execSync`
  in `apps/desktop` + `packages/host-service` without a `windowsHide: true`
  option, especially calls to `taskkill`, `where`, `cmd`, `powershell`, `pwsh`.
  If a flash persists from an un-attributed third site, the fallback is a global
  `child_process` `windowsHide` default plus an env-gated spawn tracer (e.g.
  `SUPERSET_TRACE_SPAWN=1`) to attribute the site, then fix it directly — build
  it as `apps/desktop/src/main/lib/windows-child-process-patch.ts`, installed at
  the top of `apps/desktop/src/main/index.ts`.

## W11 — Skip agent global-dotfile hook injection on win32

- **Commits:** `86ce750ab` (`createClaudeSettingsJson`), `8e5ba3be9`
  (cursor/codex/gemini/pi), `052e0f837` (`createKimiConfigToml` — new upstream
  injector guarded on the 2026-07-20 main merge)
- **Override policy:** **LOCKED** (Windows-specific no-op).
- **Invariant:** On win32 the dotfile hook injectors are no-ops:
  `createClaudeSettingsJson`, `createCodexHooksJson`, `createCursorHooksJson`,
  `createGeminiSettingsJson`, `createPiExtension`, `createKimiConfigToml`. On
  Windows they'd churn a user-tracked global dotfile every launch (and for the
  non-Windows-adapted ones, emit a bare POSIX `.sh` command that can't run); the
  user wires their own per-agent hooks. The paired `create*HookScript` /
  `create*Wrapper` writers still run (the `SUPERSET_HOME_DIR/hooks/*.sh` scripts
  must stay). Note: codex and kimi commands ARE Windows-adapted (they route
  through `getManagedNotifyHookCommand` → `notify.cmd`), so their skip is by
  user preference to avoid churning a tracked dotfile, not because it's broken.
- **Where:** `apps/desktop/src/main/lib/agent-setup/agent-wrappers-claude-codex-opencode.ts`,
  `agent-wrappers-{cursor,gemini,pi}.ts`, and `agent-wrappers-kimi.ts`.
- **Scan for:** merge changes to these injectors that drop the win32 guard, or a
  **new** agent's dotfile injector with no win32 guard (droid/mastra/vibe/amp
  share the latent bug, currently unused). Kimi was the realized case: it landed
  on the 2026-07-20 merge without a guard and was added here.
- **Opt-in re-enable (standalone script):** since the app skips auto-inject on
  win32, users wire the Claude hooks on demand with
  `scripts/windows/setup-claude-notify.ps1` (`pwsh …`, documented in
  `README.md`). It's self-contained (no repo imports): writes
  `~/.claude/hooks/superset-notify.sh` (bridge → `$SUPERSET_HOME_DIR/hooks/notify.sh`,
  needs bash), then merges the hook entries that call it into
  `~/.claude/settings.json`. Idempotent (strips prior `superset-notify.sh`
  entries before re-adding), backs up `settings.json`, manages only the bridge
  entries (leaves any user `notify.ps1` and everything else untouched), and
  supports `-DryRun`. Independent of the app's own `notify.cmd` path.

## W12 — Lost V2 terminal sessions tombstone read-only (no silent respawn)

- **Commits:** `61c892c1e`
- **Override policy:** **LOCKED**, but **behaviour-changing on all platforms —
  flag if this ever feeds upstream.** macOS/Linux now tombstone read-only after
  a reboot/daemon-crash instead of silently respawning a fresh shell.
- **Why (the Windows root cause):** V2 keeps live PTYs in a detached `pty-daemon`
  meant to outlive an app restart via named-pipe adoption (`tryAdopt`). On
  Windows it can't: Node's `detached` sets `DETACHED_PROCESS |
  CREATE_NEW_PROCESS_GROUP` but **not** `CREATE_BREAKAWAY_FROM_JOB`, so the
  daemon stays in Electron's Windows Job Object and dies on job close. So after
  any Windows app restart the session is gone (a reboot loses it on every
  platform too).
- **Invariant:** When the live PTY can't be adopted, `resolveSessionForAttach`
  returns a `SESSION_ENDED` sentinel rather than respawning a shell over the
  renderer's painted scrollback. The transport maps that to a `session_ended`
  diagnosis, keeps the socket closed (input already blocked / read-only), and
  the pane header shows a neutral **"Previous session (ended)"** pill (no red
  "Disconnected", no Reconnect button). User opens a new tab for a fresh shell.
- **Where:** `packages/host-service/src/terminal/terminal.ts`
  (`resolveSessionForAttach`, `SESSION_ENDED`);
  `apps/desktop/src/renderer/lib/terminal/terminal-ws-transport.ts`;
  `.../terminalConnectionDiagnostics.ts`;
  `.../TerminalConnectionIndicator.tsx`.
- **Scan for:** any upstream change that reintroduces auto-respawn on a
  non-adoptable session, or drops the `SESSION_ENDED` path / the read-only
  indicator.

## W13 — Snapshot live terminal buffers on app hide/close

- **Commits:** `61c892c1e`
- **Override policy:** **LOCKED** (companion to W12).
- **Why:** `persistBuffer` previously ran only on tab/workspace detach, so the
  read-only restore of a full-screen TUI (Claude Code, vim, less — which render
  into xterm's *alternate* buffer) came back blank: the only snapshot predated
  the alt-screen.
- **Invariant:** The runtime registry calls `persistAll()` on `pagehide` and on
  `visibilitychange`→hidden, serializing every live runtime (serialize addon
  includes the alternate buffer) plus its dimensions, so the W12 tombstone shows
  the actual last on-screen frame. (Graceful quit/app-switch covered; a hard
  force-kill falls back to the last hidden-state snapshot.)
- **Where:** `apps/desktop/src/renderer/lib/terminal/terminal-runtime-registry.ts`
  (`persistAll`); `.../terminal-runtime.ts`.
- **Scan for:** removal of the `pagehide` / `visibilitychange` persist hooks, or
  a refactor that reverts persistence to detach-only.
- **Testing caveat — judge restore fidelity in a packaged build, not dev.** In
  `dev:desktop`, `electron-vite dev --watch` restarts the renderer/host-service
  on HMR, so `persistAll` may not fire cleanly at close and a stale normal-buffer
  snapshot can overwrite the alt-screen frame — the tombstone then restores a
  bare shell prompt instead of the TUI. This is a dev artifact, not a W13 break;
  verify snapshot restore from an installed build (single clean quit).

## W14 — `fs.rm` backstop after `git worktree remove` on Windows

- **Commits:** `1a65c4bbf`
- **Override policy:** **LOCKED** (Windows filesystem behaviour).
- **Why:** `git worktree remove --force --force` unregisters the worktree but on
  Windows its recursive delete bails on pnpm `node_modules` junctions and locked
  files — the directory survives on disk while git reports success and the
  registry check passes, so the destroy saga left the orphan silently.
- **Invariant:** After confirming the worktree is unregistered, the saga removes
  any surviving directory with Node's `fs.rm(..., { recursive: true, force:
  true, maxRetries })` — unlinks junctions as links and retries transient
  Windows `EBUSY`/`EPERM`. General lesson: on Windows never trust git's own
  recursive delete to clear disk; back it with `fs.rm`.
- **Where:** `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts`.
- **Scan for:** upstream reliance on `git worktree remove` alone to free disk,
  with no `fs.rm` backstop, in any workspace/worktree cleanup path.

## W15 — `@parcel/watcher` pinned to the `windows` backend

- **Commits:** `e030e7700`
- **Override policy:** **LOCKED** (native console-window spawn; can't be
  JS-hidden).
- **Why:** left to auto-select, `@parcel/watcher` probes for watchman from
  *native* C++ (`WatchmanBackend.cc`) by spawning
  `cmd /c watchman --output-encoding=bser get-sockname`; with watchman absent
  that spawn **pops a visible console window** on every fresh watch start —
  which, being a brand-new window, grabs foreground focus (the focus-steal is a
  side effect of the window appearing, not the defect itself). The command exits
  1 and its output is binary (`bser`), which is why the flashed window looks
  empty. The spawn is native — no JS `windowsHide` / `child_process` patch can
  touch it — so forcing the backend (skipping the probe entirely) is the only
  fix.
- **Invariant:** on win32, the `subscribe` options force `backend: "windows"`
  (native `ReadDirectoryChangesW`), skipping the watchman probe. No-op on
  mac/linux (they keep fs-events/inotify auto-selection).
- **Where:** `packages/workspace-fs/src/watch.ts` (in the `createWatcher`
  `subscribe()` options).
- **Scan for:** new `@parcel/watcher` `subscribe()` calls without the win32
  backend pin, or removal of the pin.
- **Symptom if broken:** a `cmd.exe` window flashes and steals focus on
  app/workspace open (and after any dev host-service restart), exiting code 1
  with no visible output.
- **Why on open, and why it seemed random:** the probe fires on **every fresh
  `subscribe()` for a not-already-watched path**. `workspace-fs` keeps one
  watcher per unique path (`watchers.get(absolutePath)` → `createWatcher` only
  if absent), so an already-watched path is deduped — no re-probe. A *burst* of
  new watch roots at app/workspace open (git-watcher root + per-worktree
  `fs:watch` subscriptions) = the reliable "on open" flash. The "random" ones
  were new watch roots started later: switching to a different workspace, a
  watcher torn down and recreated, and — the big one in dev —
  `electron-vite dev --watch` restarting host-service on every main/host-service
  edit or HMR (fresh process → every path re-subscribes → probes fire again).
- **Dead-ends (do NOT repeat):**
  - **Not** a `child_process` / `windowsHide` problem. A global monkey-patch
    defaulting `windowsHide: true` on every spawn (the W10 approach) does
    **nothing** here — the watchman spawn is native C++, invisible to any JS
    patch.
  - **Not** node-pty / ConPTY. `useConptyDll: true` changed nothing; ConPTY is
    headless and never hosts this.
  - **Not** Git Credential Manager or the base-ref `git fetch`. GCM *does* also
    flash on a cold credential cache, and disabling the base-ref fetch removed
    one flash — but the real one survived, because it's the watchman probe.
  - **Not** Windows Terminal's "default terminal application" setting (tested
    conhost, no change).
  - Env-gate testing is unreliable here: **turbo strips unknown env vars** from
    task processes, so `SUPERSET_NO_*`-style flags never reach host-service.
    Disable things in *code* to test, not via env.
- **How it was finally caught:** a `Register-CimIndicationEvent` watcher on
  `__InstanceCreationEvent ISA Win32_Process` logging every new process's full
  command line + parent chain during app open. The chain was
  `cmd.exe /c watchman … → host-service.js`, and `@parcel/watcher`'s
  `WatchmanBackend.cc` was the only dep matching
  `--output-encoding=bser get-sockname`. 

## W16 — Sweep stale `active` terminal sessions on win32 startup

- **Commits:** `95467bee9`
- **Override policy:** **LOCKED** (win32 daemon lifecycle).
- **Why:** the pty-daemon is spawned `detached` + `unref()` and doesn't die with
  the app, so a terminal's `onExit` (which flips its `terminal_sessions` row to
  `exited`) isn't delivered to the exiting host-service, and the reaper only
  visits sessions the daemon still lists. Dead rows keep their agent binding
  live-joined.
- **Invariant:** host-service startup sweeps all `active` rows → `exited` on
  win32, before `deleteDefunct()`. Safe because no pty survives an app restart
  on Windows.
- **Where:** `packages/host-service/src/app.ts` (before `deleteDefunct()`).
- **Scan for:** changes to startup session-cleanup ordering, or removal of the
  win32 sweep.
- **Symptom if broken:** a phantom duplicate "Claude" chip per relaunch in the
  workspace-agents sidebar (chips render only when ≥2 agents, so it looks like
  "two Claude icons for one instance"); sessions from days ago still `active`.

## W17 — "Quit Completely" tree-kills the pty-daemon

- **Commits:** `a87b09083`
- **Override policy:** **LOCKED.** Not Windows-specific in principle (a POSIX
  detached daemon orphans the same way) but gated behind the full-teardown
  branch cross-platform; upstream leaves the daemon alive for reattach.
- **Why:** the daemon is a *grandchild* (Electron → host-service → daemon),
  spawned `detached: true` to survive host-service restarts. `before-quit`'s
  `stopAll()` only SIGTERMs host-service; nothing reaped the detached daemon, so
  after "Quit Superset Completely" a `Superset.exe … pty-daemon.js` process (and
  its shell PTYs) lingered despite the dialog promising all services stopped.
- **Invariant:** `killAllPtyDaemons` reads each daemon pid from
  `$SUPERSET_HOME_DIR/host/{orgId}/pty-daemon-manifest.json` and `taskkill /T /F`s
  the tree. Only fires on full teardown (Quit Completely / dev); a plain "Close
  Superset" deliberately leaves the daemon alive.
- **Where:** `apps/desktop/src/main/lib/pty-daemon-cleanup.ts`
  (`killAllPtyDaemons`), called from the `forceFullCleanup` branch of
  `before-quit` in `apps/desktop/src/main/index.ts`. The `before-quit` handler
  must `event.preventDefault()` **unconditionally** (before any branch): the
  cleanup is async, and without preventDefault Electron terminates the main
  process the instant the handler suspends at its first `await`, before the
  daemon reap can spawn its `taskkill`. The explicit `app.exit(0)` at the end
  (and the cancel-path `return`) drive the actual exit.
- **Scan for:** changes to `before-quit` / `forceFullCleanup` that drop the
  daemon reap; a `preventDefault()` moved back inside the confirmation-dialog
  branch (re-introduces the race); a new detached daemon spawn not recorded in
  the manifest.

## W18 — Windows Ctrl+Left/Right word-jump uses VT sequences

- **Commits:** `6fb182bb9`
- **Override policy:** **LOCKED** (PSReadLine Windows edit-mode binding).
- **Why:** PSReadLine's default (Windows) edit mode binds word-jump to Ctrl+arrow
  and expects `\x1b[1;5D` / `\x1b[1;5C`; the emacs `\x1bb` / `\x1bf` form is
  unbound there, so PSReadLine drops the ESC and inserts a literal "b"/"f".
- **Invariant:** on the Windows/pwsh path, Ctrl+arrow word-jump emits the VT
  sequences; the Mac Alt branch keeps the emacs form.
- **Where:** `apps/desktop/src/renderer/lib/terminal/line-edit-translations.ts`.
- **Scan for:** changes to word-jump key translations that revert Windows to
  emacs ESC+b/f.
- **Symptom if broken:** Ctrl+Left prints `b`, Ctrl+Right prints `f` in a pwsh 7
  terminal instead of jumping by word.

## W19 — Programmatic command launches end in a bare CR for PowerShell

- **Commits:** `4eda82193`; `1346623b8` (2026-07-21 merge: upstream #5774 wrapped
  `queueInitialCommand`'s write in a `session.shellReadyPromise.then(...)` gate —
  kept that gate but write through `appendShellLineEnding(initialCommand,
  session.shell)`, not upstream's `initialCommand + "\n"`. On win32 the gate is a
  no-op — `shellLaunchExpectsReadyMarker` returns false for pwsh/cmd (they never
  emit OSC 133;A), so the promise resolves immediately.)
- **Override policy:** **LOCKED** (PSReadLine keystroke semantics).
- **Why:** PSReadLine accepts the line on the CR, then treats the trailing LF of
  a CRLF as a fresh keystroke — stranding a `>>` continuation prompt. A lone CR
  is what the Enter key actually sends. `cmd.exe` tolerates CRLF, so it's left
  as-is.
- **Invariant:** `getShellLineEnding` returns a lone CR for pwsh. Covers every
  launch routed through `appendShellLineEnding` (`queueInitialCommand` for
  terminal-preset / agent-button `initialCommand`, and `writeCommands`). Known
  gap: the renderer's shell-agnostic `normalizeTerminalCommand` still appends a
  bare LF (`writeInput` path) — a no-op accept on pwsh; give it shell awareness
  if that path is exercised on Windows.
- **Where:** `packages/shared/src/shell.ts` (`getShellLineEnding`).
- **Scan for:** new command-write paths hardcoding CRLF/LF for pwsh instead of
  going through `getShellLineEnding`; changes to `getShellLineEnding`.
- **Symptom if broken:** after a terminal preset (e.g. one that runs `clear`) or
  agent-button launch, the shell strands a `>>` you must clear before typing.

## W20 — V2 agent launch commands quoted for the target shell

- **Commits:** `c4eb36c61` (original unified form — shell threaded through
  `buildAgentCommandString` in `runTerminalAgent`, no branch); see also **W7**
  `6483e7884` for `&&` preservation; `1346623b8` (2026-07-21 merge) +
  `682fe061a` (test restore, both since superseded); `900cff632` (2026-07-22
  merge). **History:** upstream #5784 had replaced the direct-type path with a
  POSIX launcher-script pipeline (`withPreparedAgentLaunch` / `prepareAgentLaunch`
  in `agent-launch.ts` — a `#!/bin/sh` script using `exec … < /dev/tty` + a
  `kill -0` ack file), so on the 2026-07-21 merge W20 was re-applied as a
  `process.platform === "win32"` **branch** in `runTerminalAgent`. On the
  2026-07-22 merge upstream **reverted #5784** (`cdf55f9e0`), deleting
  `agent-launch.ts` + `attachment-prompt.ts` and restoring the pre-#5784
  unified direct-type path for all platforms. W20 therefore **collapsed back to
  its original `c4eb36c61` form**: no win32 branch — `runTerminalAgent` resolves
  the launch shell once (`resolveLaunchShell(getTerminalBaseEnv())`) and threads
  it through `buildAgentCommandString` + `envOverlayPrefix` for everyone (POSIX
  output unchanged). `buildAgentCommandString` lives in `agents.ts` and is the
  sole launch path again.
- **Override policy:** **LOCKED** (pwsh parser semantics). **Re-introduction
  trigger:** if upstream re-lands a `/bin/sh` + `/dev/tty` launcher-script
  pipeline (#5784 or similar), it can never be the Windows launch path — re-add
  the `process.platform === "win32"` branch that keeps the direct-type
  `buildAgentCommandString` path (see the 2026-07-21 history above for the shape).
- **Why:** POSIX single-quoting (`'claude' 'build a boat'`) is a PowerShell
  `ParserError` — pwsh reads a leading quoted string as an expression and rejects
  the following token.
- **Invariant:** `buildArgvCommand` / `envOverlayPrefix` quote for the shell. For
  pwsh: bare command names/flags/paths unquoted; the `&` call operator only when
  the command name itself is quoted (e.g. a path with spaces); single quotes
  escaped as `''`; `$env:KEY=…` overlays instead of POSIX `KEY=value cmd`.
  Multiline prompts render as a **one-line** double-quoted string with
  `` `n ``/`` `" ``/`` `$ `` escapes (a single-quoted literal embeds raw LF that
  PSReadLine reads as a line-accept, truncating the prompt). Known gaps (still
  POSIX-only): stdin-transport agents emit a heredoc (only argv agents like
  claude are wired for pwsh), `cmd.exe` isn't handled, and
  `buildHostAgentLaunchCommand` in `apps/web` passes no shell.
- **Where:** `packages/shared/src/agent-prompt-launch.ts` (`buildArgvCommand`,
  `envOverlayPrefix`); the launch shell is resolved in `runTerminalAgent` and
  threaded through `buildAgentCommandString` (both in
  `packages/host-service/src/trpc/router/agents/agents.ts`).
- **Scan for:** new agent-launch quoting that assumes POSIX single-quotes; a new
  launch path that doesn't thread the target shell through; **any change that
  routes `runTerminalAgent` through a `/bin/sh` + `/dev/tty` launcher script
  without a win32 guard** (re-introduction of #5784), or a new launcher-script
  caller with no win32 branch.

## W21 — pty-daemon `hasRunningForegroundProcess` guarded on win32

- **Commits:** `8870fd159`
- **Override policy:** **LOCKED** (Windows has no POSIX foreground process group).
- **Invariant:** `hasRunningForegroundProcess` short-circuits on win32 rather
  than assuming a POSIX process-group / `tcgetpgrp`-style concept that doesn't
  exist there.
- **Where:** `packages/pty-daemon/src/process-tree.ts`.
- **Scan for:** new foreground-process / process-group checks that assume POSIX
  semantics without a win32 guard.

## W22 — Chain V2 *setup* commands with `&&` under pwsh 7

- **Commits:** `6a26e800a`
- **Override policy:** **LOCKED** (Windows shell semantics). Companion to **W7**,
  but a different code path: W7 chains *agent-launch* commands, this chains the
  *workspace-setup* command line.
- **Why:** V2 terminals default to pwsh 7 (**W6**), which supports the `&&`
  pipeline-chain operator. `buildSetupCommand` was emitting the noisy
  per-command `; if ($?) { … }` failure-guard form for *all* PowerShell. Only
  legacy Windows PowerShell 5.1 actually lacks `&&`, so pwsh 7 should join with
  a plain `&&` like POSIX/cmd.
- **Invariant:** `buildSetupCommand` only special-cases `knownShell ===
  "powershell"` (Windows PowerShell 5.1) for the `$?`-guard chaining; `pwsh`
  (and POSIX/cmd) join with `&&`.
- **Where:** `packages/host-service/src/trpc/router/workspace-creation/shared/setup-terminal.ts`
  (`buildSetupCommand`).
- **Scan for:** changes to `buildSetupCommand` that revert pwsh to the
  `$?`-guard form, or a new setup-command path that hard-joins with `&&` before
  the shell is known / doesn't distinguish pwsh 7 from PowerShell 5.1.

## W23 — Normalize Superset path env vars to native separators on win32

- **Commits:** `2a8dae119`
- **Override policy:** **LOCKED** (Windows path spelling). Sibling of **W9** —
  same `buildV2TerminalEnv` choke point in the same file.
- **Why:** `repoPath` is stored POSIX-normalized (forward slashes) in the DB
  while `worktreePath` comes from git as native backslashes, so
  `SUPERSET_ROOT_PATH` and `SUPERSET_WORKSPACE_PATH` disagreed on separators.
  Setup/teardown scripts joining them with `\…` literals then emitted mixed
  paths like `C:/repos/example-project\tests\…`. Cosmetic (Windows accepts both) but
  confusing in logs and script output.
- **Invariant:** on win32, `buildV2TerminalEnv` forces both
  `SUPERSET_ROOT_PATH` and `SUPERSET_WORKSPACE_PATH` to all-backslash at the
  single terminal-env choke point.
- **Where:** `packages/host-service/src/terminal/env.ts` (`buildV2TerminalEnv`,
  the `toNativePath` normalization).
- **Scan for:** merge changes to `env.ts` that drop the win32 separator
  normalization, or a new Superset path env var added without it.

## W24 — Editor CLI shims resolve via shell in `spawnAsync` on win32

- **Commits:** `12a9af165`
- **Override policy:** **LOCKED** (Windows `.cmd`/`.bat` shim + PATHEXT
  resolution).
- **Why:** editor CLIs on Windows are `.cmd`/`.bat` shims (e.g. `code.cmd`); a
  bare `spawn("code")` can't resolve them via `PATHEXT` and fails with `ENOENT`,
  so every "Open in editor" button was broken on Windows — not just VS Code.
- **Invariant:** on win32 `spawnAsync` spawns with `shell: true` +
  `windowsHide: true`, manually quoting args (shell:true doesn't quote) to
  preserve spaces, so the shim resolves through `cmd.exe`/PATHEXT.
- **Where:** `apps/desktop/src/lib/trpc/routers/external/helpers.ts`
  (`spawnAsync`).
- **Scan for:** a new bare `spawn`/`execFile` of an editor/CLI shim name on
  win32 without `shell: true`; removal of the `windowsHide`/quoting from
  `spawnAsync`. (Overlaps **W10**'s `windowsHide` invariant.)

## W25 — Accept pure-Alt hotkey binds in the recorder on Windows/Linux

- **Commits:** `b4b8946ab`
- **Override policy:** **LOCKED** (cross-platform modifier handling, but the bug
  only bit non-Mac).
- **Why:** the hotkey recorder only treated Alt as an app modifier on Mac, so
  Windows-Terminal-style binds like `alt+shift+-` and `alt+arrow` were silently
  dropped during capture on Windows/Linux.
- **Invariant:** pure Alt (Alt without Ctrl) counts as an app modifier on every
  platform — it isn't AltGr, so it's safe. `Ctrl+Alt` still requires Ctrl to
  preserve the AltGr guard (on Windows/Linux AltGr masquerades as Ctrl+Alt).
- **Where:** `apps/desktop/src/renderer/hotkeys/hooks/useRecordHotkeys/useRecordHotkeys.ts`
  (`altIsAppModifier`).
- **Scan for:** changes reverting Alt to a Mac-only app modifier, or a new
  modifier-capture path that drops pure-Alt on non-Mac.

## W26 — win32 daemon auto-update refuses while sessions are alive

- **Commits:** part of `61132970e` (foundational `runWindowsUpdate`); documented
  + re-guarded on the 2026-07-22 merge (upstream #4a8967a84 deleted the shared
  `countAliveSessions` helper — inlined the count in the win32 path).
- **Override policy:** **LOCKED** (Windows ConPTY has no fd-handoff). Not a
  candidate to adopt upstream's "update even with live sessions" behaviour —
  that's provably impossible on Windows.
- **Why:** upstream's daemon auto-update preserves live PTYs across the restart
  via fd-handoff (POSIX). Windows ConPTY can't hand off fds, so updating a
  daemon with live sessions would kill the user's shells. `runWindowsUpdate`
  refuses the update while any session is alive and tells the user to close
  them first. Upstream #4a8967a84 ("attempt daemon auto-update even when live
  sessions are present") removed the alive-session gate from the POSIX path and
  **deleted the shared `countAliveSessions` helper the win32 path also used** —
  a silent break (no conflict marker): `runWindowsUpdate` still compiled-referenced
  a now-missing function. Fixed by inlining `sessions.filter(s => s.alive).length`
  in the win32 path.
- **Where:** `packages/host-service/src/daemon/DaemonSupervisor.ts`
  (`runWindowsUpdate`, the `aliveSessionCount` gate).
- **Scan for:** upstream changes to the daemon update / auto-update paths that
  drop or relax the win32 live-session refusal; deletion of a shared
  alive-session helper that `runWindowsUpdate` depends on (inline it); a new
  win32 update path that hands off fds as if ConPTY supported it.
- **Symptom if broken:** a Windows daemon auto-update either fails to compile
  (missing helper) or silently kills the user's live terminals on update.

## W27 — win32 ConPTY teardown owned by node-pty (modern conpty.dll, no taskkill-first)

- **Commits:** `9bfae2258` (first, ineffective — skipped `destroy()`; superseded),
  `71a1e23f6` (2026-07-22, teardown fix), `d1e89a280` (2026-07-22,
  restores the node-pty modern-ConPTY assets after Electron's source rebuild)
- **Override policy:** **LOCKED** (Windows ConPTY teardown ordering). node-pty
  1.2 is ConPTY-only — there is no winpty backend to fall back to.
- **Why:** the daemon closes a session by calling `Pty.kill()` then
  `Pty.dispose()`. The original win32 path force-killed the whole process tree
  with `taskkill /T /F` and let node-pty clean up afterward. But ConPTY requires
  its conout socket to keep draining *while* the pseudoconsole is closed (see
  node-pty `windowsConoutConnection`: "ClosePseudoConsole ... when data is being
  written to the terminal when the pty is closed"). Force-killing an
  **actively-outputting** session out from under node-pty (a Claude preset
  streams TUI output — hence the consistent repro) corrupts the daemon heap →
  the daemon exits **`0xC0000374` (STATUS_HEAP_CORRUPTION)**. One daemon owns
  every PTY in the org, so its crash drops all terminals; the respawned empty
  daemon makes W12 tombstone every pane "Previous session (ended)". Pre-existing
  since the 2026-07-21 node-pty `1.1.0 → 1.2.0-beta.14` bump; **not** a merge
  regression (confirmed reproducing on the pre-merge build). The first attempt —
  skipping `term.destroy()` on win32 (`9bfae2258`) — did **not** help: the
  corruption is caused by `taskkill` itself, not the later `ClosePseudoConsole`.
- **Invariant:** on win32 the teardown is node-pty's own coordinated `kill()` —
  never a `taskkill`-first force-kill of an active session. Three load-bearing
  parts, all required:
  1. Spawn with `useConptyDll: true` (`Pty.ts` `spawn()`), so node-pty uses its
     bundled **modern ConPTY** (`conpty.dll` + `OpenConsole.exe`). Its close path
     is fork-free — no `AttachConsole` console-process enumeration, which is the
     ~5s stall that originally pushed this code onto `taskkill`.
  2. Both `Pty.kill()` and `Pty.dispose()` funnel to a single guarded
     `windowsTeardown()` that calls `this.term.kill()` (WindowsTerminal.kill with
     **no signal** — it throws if given one). This runs exactly once whether the
     session is closed explicitly (kill + dispose) or exits on its own (onExit →
     dispose). `taskkill` remains only as a last-resort fallback if `term.kill()`
     throws.
  3. The `conpty.dll`/`OpenConsole.exe` assets must sit **beside the rebuilt
     `conpty.node`**. node-pty's native loader (`src/win/conpty.cc`) does
     `GetModuleHandle("conpty.node")` → its dir → `conpty\conpty.dll`; Electron's
     from-source rebuild emits `build/Release/conpty.node` but never creates
     `build/Release/conpty/`, so without a copy step spawning aborts with
     "Cannot find conpty.dll" (terminals fail to start — *not* a crash).
     `install-app-deps.ts` mirrors both assets from `prebuilds/<plat>/conpty/`
     into `build/Release/conpty/` after the rebuild.
- **Where:** `packages/pty-daemon/src/Pty/Pty.ts` — `spawn()` (`useConptyDll`
  option), `NodePtyAdapter.windowsTeardown()`, and the win32 branches of `kill()`
  and `dispose()`; `apps/desktop/scripts/install-app-deps.ts` mirrors
  `conpty.dll` and `OpenConsole.exe` from node-pty's `prebuilds/<plat>/conpty/`
  into `build/Release/conpty/` after Electron rebuilds its native addon. Dev
  (`bun run dev:desktop`) then resolves the assets beside the rebuilt addon; a
  **packaged** build must still `asarUnpack` node-pty's assets.
- **Scan for:** any win32 path that force-kills a pty (`taskkill`, `process.kill`)
  *before* node-pty's coordinated `kill()`; a spawn that drops `useConptyDll` on
  win32; a node-pty bump that changes the Windows kill semantics or moves the
  bundled conpty.dll (re-verify the DLL still resolves, the Electron rebuild
  mirrors `conpty.dll` + `OpenConsole.exe` beside `conpty.node`, and the teardown
  still runs once).
- **Symptom if broken:** killing/closing one terminal crashes the pty-daemon
  (`exit code 3221226356` in host-service logs), and every other terminal in the
  workspace flips to "Previous session (ended)". A packaged-build regression
  would instead be a spawn failure (`ESPAWN`/DLL-not-found) if the conpty assets
  aren't unpacked.

---

# §2 — Features & fixes

Bug fixes and new functionality this branch carries that are **not** part of the
Windows port. Mostly **OVERRIDABLE** — if upstream ships the same fix/feature,
notify the user and switch to theirs.

## F1 — Stopgap "commits to pull" (↓N) badge in the v2 sidebar

- **Commits:** `f9cf9d131`; `900cff632` (2026-07-22 merge: upstream #5824
  reorganized the sidebar chrome and now gates the *diff-stats* display on
  `isActive`. Kept the ↓N behind badge un-gated (its whole purpose is surfacing
  pull-needed workspaces at a glance across rows) and applied upstream's
  `isActive` gate to the diff-stats portion only.)
- **Override policy:** **OVERRIDABLE — and flagged DELETE ON MERGE.** Upstream
  `getBranchSyncStatus.pullCount` already exists; prefer wiring the sidebar to
  that (plus a fetch) over keeping this. If upstream ships a real ahead/behind
  indicator, delete all three pieces below and notify the user. (#5824 was a
  chrome reorg, **not** an ahead/behind indicator — the stopgap stays.)
- **What:** three coupled pieces, each carrying a `STOPGAP … DELETE ON MERGE`
  banner. Deliberately a *separate* procedure (not folded into
  `getBranchSyncStatus`, which the PR flow shares) so it reverts cleanly. The
  procedure reads `@{upstream}...HEAD` for the count and fire-and-forgets
  `scheduleBaseRefFetch` to keep the ref fresh; the hook polls every 2 min.
- **Where:** `packages/host-service/src/trpc/router/git/git.ts`
  (`git.getCommitsToPull`); `apps/desktop/src/renderer/hooks/host-service/useCommitsToPull/`
  (`useCommitsToPull`); the badge JSX in `DashboardSidebarExpandedWorkspaceRow.tsx`.
- **Scan for:** upstream adding an ahead/behind or `pullCount`-based sidebar
  indicator → switch the sidebar to it and delete this.

## F2 — Don't warn "unpushed commits" for merged-then-deleted branches

- **Commits:** `08894008e`
- **Override policy:** **OVERRIDABLE** (genuine bug fix, not Windows-specific).
  If upstream fixes the same false warning, adopt theirs.
- **What:** the branch-sync / cleanup warning no longer flags "unpushed commits"
  when the branch's upstream was merged and then deleted (the local commits are
  already in the base, so the warning was a false positive).
- **Where:** `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts`.
- **Scan for:** upstream changes to the unpushed-commits / branch-sync warning
  logic that supersede this guard.

## F3 — Ignore stale closed PRs when linking branches

- **Commits:** `8e7d6a92b`
- **Override policy:** **OVERRIDABLE** (genuine bug fix, not Windows-specific).
  If upstream fixes the same false PR link, adopt theirs.
- **What:** a branch was linked to *any* PR matching its head ref, so a
  long-dead closed/merged PR reusing a common branch name (e.g. a dummy PR on
  `develop`) surfaced in the v2 sidebar. Now closed/merged PRs untouched for over
  a month are dropped at the per-head match; open PRs still link regardless of
  age.
- **Where:** `packages/host-service/src/runtime/pull-requests/utils/github-query/github-query.ts`
  (`STALE_PULL_REQUEST_LOOKBACK_MS`, per-head match filter).
- **Scan for:** upstream changes to the branch↔PR linking / head-ref match logic
  that supersede this stale-PR filter.

## F4 — Human-readable project worktree folder names

- **Commits:** `33abbc627`
- **Override policy:** **OVERRIDABLE**, but **behaviour-changing on all
  platforms — flag if it ever feeds upstream.** Windows-*motivated* (shorter
  paths help MAX_PATH) but affects macOS/Linux too, so it lives in §2, not §1.
- **What:** the per-project worktree parent dir is named
  `<repoName-slug>-<short8>` (e.g. `superset-3ec4ef4b`) instead of the bare
  36-char project GUID — legible at a glance and shorter (helps Windows
  `MAX_PATH`). Nothing parses the GUID back out of a path (worktree paths are
  stored whole in SQLite and read opaquely), so this only affects **newly
  created** worktrees; existing ones keep working from their stored paths.
- **Where:** `packages/host-service/src/trpc/router/workspace-creation/shared/worktree-paths.ts`
  (`projectDirName`); `packages/host-service/src/trpc/router/workspaces/workspaces.ts`
  (passes `repoName`).
- **Scan for:** upstream changing the worktree-path layout (conflict), or any
  new code that tries to parse the project GUID back out of a worktree path
  (would break on the slugged name).

## F5 — V2 "Open in…" button appears on freshly-created workspaces

- **Commits:** `7211d91b5`
- **Override policy:** **OVERRIDABLE** (genuine bug fix, not Windows-specific).
  If upstream fixes the same stale gate, adopt theirs.
- **What:** the top-right "Open in VSCode / Cursor / Finder" button was gated on
  a one-shot `workspace.get` `useQuery` that fired once on mount and never
  refetched. A newly-created workspace's worktree isn't provisioned at mount, so
  the query returned `worktreePath: null` and the button stayed hidden until the
  user clicked off the workspace and back (remount re-fired the query). Fixed by
  gating on the already-live `workspace.worktreePath` from `useHostWorkspaces`
  (healed by `workspace:changed` bus events) and deleting the redundant query.
- **Where:** `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/V2WorkspaceOpenInButton/V2WorkspaceOpenInButton.tsx`.
- **Scan for:** upstream reintroducing a one-shot `workspace.get` gate on this
  button, or any new gate that reads a non-live source for `worktreePath`
  instead of the `useHostWorkspaces` row.

## F6 — Force v2 on and lock the "Try Superset v2" opt-out toggle

- **Commits:** `c1d3fc4df`
- **Override policy:** **LOCKED for this fork.** This fork is v2-only on Windows
  (v1 untested), so we never want the opt-out. Not a candidate to switch to
  upstream — upstream deliberately keeps v1/v2 selectable.
- **What:** `useIsV2CloudEnabled` unconditionally returns `true` (was: opt-in
  store value, falling back to v2-only-user / dev-mode), so every v2/v1 gate
  across the app resolves to v2 regardless of the persisted opt-out or build
  type (dev *and* packaged). The Experimental settings "Try Superset v2" switch
  stays visible but is rendered `disabled`; since the hook is hard-wired on, it
  reads as on and can't be turned off (its `onCheckedChange` is now dead code,
  kept only to minimise the diff).
- **Where:** `apps/desktop/src/renderer/hooks/useIsV2CloudEnabled.ts`
  (`useIsV2CloudEnabled` returns `true`);
  `apps/desktop/src/renderer/routes/_authenticated/settings/experimental/components/ExperimentalSettings/ExperimentalSettings.tsx`
  (`disabled` on the `superset-v2` `Switch`).
- **Scan for:** upstream reworking `useIsV2CloudEnabled` (e.g. new signature or
  new opt-out source) — re-apply the forced `true`; a merge that drops the
  `disabled` prop from the `superset-v2` switch — re-pin it.

## F7 — Force auto-update off and lock the "Disable auto-update checks" toggle

- **Commits:** `4b648216f`
- **Override policy:** **LOCKED for this fork.** This fork is never published
  with a Windows release feed, so update checks can only fail. Not a candidate
  to switch to upstream — upstream ships real per-platform release manifests.
- **What:** `isAutoUpdateDisabledByRuntimeFlags()` unconditionally returns
  `true` (was: persisted `disableAutoUpdate` runtime flag OR the
  `SUPERSET_DISABLE_AUTO_UPDATE` env var), so every auto-update entry point —
  `setupAutoUpdater`, the periodic `checkForUpdates`, and the interactive
  `checkForUpdatesInteractive` — short-circuits to disabled. The original logic
  is preserved as a comment for restore. The Experimental settings "Disable
  auto-update checks" switch stays visible but is rendered `checked` +
  `disabled`; since the main-process gate is hard-wired on, it reads as on and
  can't be turned off (its `onCheckedChange` is now dead code, kept only to
  minimise the diff). Mirrors [F6].
- **Where:** `apps/desktop/src/main/lib/desktop-runtime-flags.ts`
  (`isAutoUpdateDisabledByRuntimeFlags` returns `true`; drops the now-unused
  `isTruthyRuntimeFlag` import);
  `apps/desktop/src/renderer/routes/_authenticated/settings/experimental/components/ExperimentalSettings/ExperimentalSettings.tsx`
  (`checked` + `disabled` on the `disable-auto-update` `Switch`).
- **Scan for:** upstream reworking `isAutoUpdateDisabledByRuntimeFlags` (e.g.
  new signature, a new gate helper, or moving the check inline into
  `auto-updater.ts`) — re-apply the forced `true` at the effective chokepoint; a
  merge that drops the `checked`/`disabled` props from the `disable-auto-update`
  switch — re-pin them.

## F8 — Keep optional MCP integrations disabled in this workspace

- **Commits:** `e763ca35a`
- **Override policy:** **LOCKED for this fork.** These integrations are not
  required to develop or run the Windows v2 desktop fork, and an unavailable
  local Maestro executable or unsigned-in remote service makes every Codex
  startup noisy.
- **What:** removes the active Maestro, Linear, Neon, Sentry, and Superset MCP
  server definitions from the workspace Codex configuration. Expo remains
  explicitly disabled. This prevents client startup warnings without changing
  application runtime behaviour.
- **Where:** `.codex/config.toml`.
- **Scan for:** active `mcp_servers.maestro`, `mcp_servers.linear`,
  `mcp_servers.neon`, `mcp_servers.sentry`, or `mcp_servers.superset` entries
  returning to `.codex/config.toml` without an explicit request to enable the
  integration.
