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
  `1.2.0-beta.14` — upstream commit `7515dd410` / #5795 — and wrapped
  `pty-daemon` `spawn()` in try/catch cleanup — re-kept the `getMasterFd()` win32
  guard (`_fd` handoff is POSIX-only) and made the spawn-time fd validation
  `if (process.platform !== "win32")` inside the new cleanup block, in
  `packages/pty-daemon/src/Pty/Pty.ts`. This beta's ConPTY teardown fragility is
  what later required **W27** — see there);
  `900cff632` (2026-07-22 merge: upstream #5823 added two new daemon integration
  tests that hardcoded a Unix `.sock` path + `existsSync` readiness — adapted
  both to `makeTestDaemonSocketPath` + the `isWindowsNamedPipe ? canConnect :
  existsSync` readiness check, matching the sibling tests in
  `packages/host-service/test/integration/terminal.integration.test.ts`. New
  daemon integration tests must use the named-pipe-aware helpers, never a raw
  `.sock` path.);
  `95f2a6ad1` (2026-07-27 merge: upstream #5256 added the terminal
  send/snapshot node test with a raw Unix `.sock` path and `/bin/sh`. Adapted
  it to a Windows named pipe and platform shell, with its two POSIX-specific
  bracketed-paste/alternate-screen cases skipped on win32.);
  `ceebf5745` (2026-07-29 merge: upstream #5820 replaced `useVersionCheck`
  with `useDesktopNotices`. Routed the replacement version-notice fetch through
  `getRuntimeApiUrl()` so packaged builds retain the renderer API-URL
  sanitization choke point.);
  `bf6fedd63` (2026-07-31 merge: upstream #5978 introduced a reusable
  host-service respawn config provider. Kept its cloud URL routed through
  `getMainApiUrl()` so respawns retain packaged-build URL sanitization.);
  `072f1f813` (2026-08-04 merge: upstream #6073 replaced the v2 sidebar
  project's file-manager placeholder with a real action. Kept its failure
  message routed through `getOpenInFileManagerLabel()` so Windows says
  Explorer, not Finder.);
  `2b68b7c77` (2026-08-04 merge: upstream replaced the auth recovery and
  host-service membership lifecycle. Kept renderer URLs on
  `getRuntimeApiUrl()` and coordinator/startup URLs on `getMainApiUrl()`.);
  `698a283db` (2026-08-04 merge follow-up: upstream's new synchronous-process
  lint rule flagged the port's existing Windows probes and `.superset`
  lifecycle scripts. Added those ratcheted/tooling paths to the narrow Biome
  overrides and fixed the merged main-process import order.)
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

## W4 — Managed notify-hook commands work on Windows

- **Commits:** `b930f6267`, `104193b18` (Grok camelCase payload support),
  `978bf43a4` (2026-07-31 merge: upstream #6025 added blocking Grok
  Notification subtypes to the POSIX hook; mirrored the normalization in the
  Windows Node dispatcher and covered it with native subprocess tests)
- **Override policy:** **LOCKED** (Windows-specific command construction).
- **Invariant:** Each managed notify-hook resolves to a Windows-runnable
  entrypoint (`notify.cmd` / Node dispatcher) rather than a bare POSIX `.sh`.
  The Node dispatcher accepts each managed agent's payload spelling, including
  Grok's `sessionId` / `hookEventName`. Built in shared agent-wrapper helpers,
  not per-caller.
- **Where:** `apps/desktop/src/main/lib/agent-setup/agent-wrappers-common.ts`
  (`getManagedNotifyHookCommand` / `buildNotifyHookCommand`);
  `notify-hook.ts`; agent notify-hook setup.
- **Scan for:** new notify-hook command construction that emits `bash …` / `.sh`
  with no `.cmd`/Node Windows branch, or a new payload field spelling handled
  only by `notify-hook.template.sh` and not the Windows Node dispatcher.

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

- **Commits:** `5a5a45d4e`; `6dc3a5725` (2026-08-04 merge follow-up: added
  `windowsHide` to upstream's new `gh api user` identity lookup.)
- **Override policy:** **LOCKED** (Windows console-flash suppression).
- **Invariant:** Every `child_process` spawn of a console-subsystem binary from
  a console-less parent (Electron main / host-service) passes
  `{ windowsHide: true }`, or it flashes a console window and can steal focus.
  This is the archetypal "scan the incoming diff" invariant — new spawns arrive
  with every merge.
- **Where (fixed so far):** `packages/host-service/src/ports/tree-kill.ts`
  (`taskkill.exe`); `apps/desktop/src/main/lib/tree-kill.ts` (`taskkill.exe`);
  `apps/desktop/src/main/lib/agent-setup/utils.ts` (`where.exe`,
  `findRealBinary`); `packages/host-service/src/runtime/git/identity.ts` (`gh`).
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
  injector guarded on the 2026-07-20 main merge), `104193b18`
  (`createGrokHooksJson` / `createGrokConfigToml`)
- **Override policy:** **LOCKED** (Windows-specific no-op).
- **Invariant:** On win32 the dotfile hook injectors are no-ops:
  `createClaudeSettingsJson`, `createCodexHooksJson`, `createCursorHooksJson`,
  `createGeminiSettingsJson`, `createPiExtension`, `createKimiConfigToml`,
  `createGrokHooksJson`, `createGrokConfigToml`. On Windows they'd churn a
  user-tracked global dotfile every launch (and for the non-Windows-adapted
  ones, emit a bare POSIX `.sh` command that can't run); the user wires their
  own per-agent hooks. The paired `create*HookScript` / `create*Wrapper` writers
  still run (the `SUPERSET_HOME_DIR/hooks/*.sh` scripts must stay). Codex, Kimi,
  and Grok commands are Windows-adapted through
  `getManagedNotifyHookCommand` → `notify.cmd`; their skip is user preference,
  not a command limitation.
- **Where:** `apps/desktop/src/main/lib/agent-setup/agent-wrappers-claude-codex-opencode.ts`,
  `agent-wrappers-{cursor,gemini,pi}.ts`, and `agent-wrappers-kimi.ts`.
  Grok's two injectors live in `agent-wrappers-grok.ts`.
- **Scan for:** merge changes to these injectors that drop the win32 guard, or a
  **new** agent's dotfile injector with no win32 guard (droid/mastra/vibe/amp
  share the latent bug, currently unused). Kimi was the realized case: it landed
  on the 2026-07-20 merge without a guard and was added here.
- **Verify tests (Windows):** Run the notify-hook and wrapper tests in separate
  Bun processes; `agent-wrappers.test.ts` mocks `./notify-hook` at module scope,
  so combining them contaminates `notify-hook.test.ts`. Filter the wrapper run
  to the relevant agent because its unfiltered Pi install assertion expects the
  global file write that W11 intentionally skips:
  ```powershell
  bun test apps/desktop/src/main/lib/agent-setup/notify-hook.test.ts
  bun test apps/desktop/src/main/lib/agent-setup/agent-wrappers.test.ts --test-name-pattern grok
  ```
- **Opt-in re-enable (standalone script):** since the app skips auto-inject on
  win32, users wire the Claude hooks on demand with
  `scripts/windows/setup-claude-notify.ps1`. **The documented invocation must stay
  policy-safe:** `README.md` leads with
  `pwsh -c "irm <raw URL> | iex"` — no file on disk, so neither the execution
  policy nor mark-of-the-web applies, and it needs no checkout. A downloaded copy
  run directly (`pwsh script.ps1`) dies with
  `SecurityError: … is not digitally signed` under `RemoteSigned`; the raw-URL
  form must therefore stay the headline, with
  `pwsh -ExecutionPolicy Bypass -File …` noted only for checkouts wanting
  `-DryRun`. Keep the raw URL pointed at the **fork remote's** branch (`main`),
  not the local branch name. `scripts/windows/` has no upstream counterpart, so
  this carries no merge surface — **prefer extending this script over re-enabling
  the injector.** Two alternatives were considered and declined: an in-app
  Settings toggle (unguarding line ~270 here is cheap, but the Settings row +
  tRPC procedure sit in upstream-hot renderer files and would need defending on
  every merge) and a double-clickable `.cmd` shim (redundant once the one-liner
  is clean). The script is self-contained (no repo imports): writes
  `~/.claude/hooks/superset-notify.sh` (bridge → `$SUPERSET_HOME_DIR/hooks/notify.sh`,
  needs bash), then merges the hook entries that call it into
  `~/.claude/settings.json`. Idempotent (strips prior `superset-notify.sh`
  entries before re-adding), backs up `settings.json`, manages only the bridge
  entries (leaves any user `notify.ps1` and everything else untouched), and
  supports `-DryRun`. Independent of the app's own `notify.cmd` path.

## W12 — Lost V2 terminal sessions tombstone read-only (no silent respawn)

- **Commits:** `61c892c1e`, `20b3567ee` (2026-07-31 merge: upstream #6036
  added `session-gone` scrollback cleanup. Kept `SESSION_ENDED` exited rows out
  of that cleanup path so Windows restart tombstones retain their snapshot.)
- **Override policy:** **LOCKED**, but **behaviour-changing on all platforms —
  flag if this ever feeds upstream.** macOS/Linux now tombstone read-only after
  a reboot/daemon-crash instead of silently respawning a fresh shell.
- **Why (the Windows root cause):** V2 keeps live PTYs in a detached `pty-daemon`
  meant to outlive an app restart via named-pipe adoption (`tryAdopt`). On
  Windows it can't: Node's `detached` sets `DETACHED_PROCESS |
  CREATE_NEW_PROCESS_GROUP` but **not** `CREATE_BREAKAWAY_FROM_JOB`, so the
  daemon stays in Electron's Windows Job Object and dies on job close. So after
  any Windows app restart the session is gone (a reboot loses it on every
  platform too). A host-service-only crash is different: Electron and its Job
  Object remain alive, so the daemon and PTYs survive and must be adopted (W16).
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
- **Separate native crash in the same dependency (unfixed):** `@parcel/watcher`
  2.5.6's win32 `ReadDirectoryChangesW` backend (the one this entry pins) also
  faults with a **`0xC0000005` access violation** on its own watch worker
  thread, taking down the host-service (tray "Host service crashed, exit code
  3221225477") on worktree churn. Distinct from the console-flash above; do not
  "fix" it by re-enabling the watchman probe. Diagnosis + native-dump capture
  procedure: [`windows-crash-forensics.md`](windows-crash-forensics.md).
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

## W16 — Reconcile win32 terminal sessions against the adopted daemon

- **Commits:** `95467bee9` (original startup sweep);
  `e9c01672e` (daemon-aware reconciliation that preserves live sessions).
- **Override policy:** **LOCKED** (win32 daemon lifecycle).
- **Why:** a full Electron exit kills the daemon through the Windows Job Object,
  leaving terminal rows `active` because their PTY exit could not reach the old
  host-service. A host-service-only crash does **not** kill the daemon: the
  replacement host can adopt its live PTYs. The old unconditional startup sweep
  conflated those cases, marked recoverable sessions `exited`, and let the
  reaper dispose them immediately after adoption.
- **Invariant:** after daemon adoption, preserve every `active` row the daemon
  reports alive. Only mark a row `exited` (and delete its agent binding) when it
  is absent from two startup daemon snapshots separated by a short confirmation
  delay. `createApp()` must never blanket-transition all win32 active rows.
- **Where:** `packages/host-service/src/terminal/reaper/reaper.ts`
  (`planWindowsStaleSessionReconciliation`,
  `reconcileStaleWindowsTerminalSessions`), awaited by both host-service entry
  points before they listen; `packages/host-service/src/app.ts`
  must remain free of the old unconditional sweep.
- **Scan for:** any win32 startup cleanup that changes all `active` rows without
  consulting `daemon.list()`, removes the second observation, or lets the reaper
  dispose a daemon-owned active session.
- **Symptom if broken:** after a host-service crash, live terminal tabs turn red
  **Disconnected** and log `Terminal session "…" is disposed`; after a full app
  restart, stale agents instead remain `active` and appear as duplicate Claude
  chips.

## W17 — "Quit Completely" tree-kills the pty-daemon

- **Commits:** `a87b09083`; `2b68b7c77` (2026-08-04 merge: upstream centralized
  quit cleanup in `runQuitCleanup`; retained the daemon reap in its full-cleanup
  terminal teardown callback.)
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
  (`killAllPtyDaemons`), called by the terminal teardown callback passed to
  `runQuitCleanup` from `before-quit` in `apps/desktop/src/main/index.ts`. The
  helper only invokes that callback for full cleanup. The `before-quit` handler
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
  emit OSC 133;A), so the promise resolves immediately.);
  `bf6fedd63` (2026-07-31 merge: upstream #6026 now sends initial-command text
  and a delayed bare `\r` Enter as separate writes. Adopted that path; it
  preserves the PowerShell invariant without `appendShellLineEnding` at this
  call site.)
- **Override policy:** **LOCKED** (PSReadLine keystroke semantics).
- **Why:** PSReadLine accepts the line on the CR, then treats the trailing LF of
  a CRLF as a fresh keystroke — stranding a `>>` continuation prompt. A lone CR
  is what the Enter key actually sends. `cmd.exe` tolerates CRLF, so it's left
  as-is.
- **Invariant:** `getShellLineEnding` returns a lone CR for pwsh.
  `queueInitialCommand` sends command text and a delayed bare `\r` as separate
  writes; other host-service command launches use `appendShellLineEnding`.
  Known gap: the renderer's shell-agnostic `normalizeTerminalCommand` still
  appends a bare LF (`writeInput` path) — a no-op accept on pwsh; give it shell
  awareness if that path is exercised on Windows.
- **Where:** `packages/shared/src/shell.ts` (`getShellLineEnding`);
  `packages/host-service/src/terminal/terminal.ts` (`queueInitialCommand`).
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
  sole launch path again;
  `bf6fedd63` (2026-07-31 merge: upstream #5925 extracted
  `buildTerminalAgentLaunch` for setup-gated launches. Preserved the resolved
  shell through both `buildAgentCommandString` and `envOverlayPrefix` in the
  extracted builder.)
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

- **Commits:** `6a26e800a`, `2e5be1de9` (2026-07-31 merge: upstream #5925
  added setup→agent chaining. Replaced its hard-coded `&&` join with
  `buildShellCommandChain` using the resolved terminal shell.)
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
  (and POSIX/cmd) join configured setup commands with `&&`. When an agent is
  chained after the complete setup command, use `buildShellCommandChain` with
  the resolved shell so both PowerShell variants get a valid `$?` guard.
- **Where:** `packages/host-service/src/trpc/router/workspace-creation/shared/setup-terminal.ts`
  (`buildSetupCommand`, `buildSetupAndAgentCommand`).
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

- **Commits:** `139afc7f8` (2026-07-22 — the full three-part fix: `useConptyDll`
  spawn, coordinated `windowsTeardown()`, and the post-rebuild conpty-asset copy)
- **Override policy:** **LOCKED** (Windows ConPTY teardown ordering). node-pty
  1.2 is ConPTY-only — there is no winpty backend to fall back to. **Removal
  trigger:** if a later node-pty release fixes the ConPTY-close-while-writing
  corruption, notify the user — this whole workaround (`useConptyDll` +
  coordinated `windowsTeardown()` + the post-rebuild conpty-asset copy) can
  likely be dropped back to a plain teardown.
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
  since the node-pty `1.1.0 → 1.2.0-beta.14` bump — upstream commit `7515dd410`
  (#5795), pulled into the fork by the 2026-07-21 merge `1346623b8`; **not** a
  merge regression (confirmed reproducing on the pre-merge build). The bump is an
  **upstream** commit on `origin/main`, so the fix lives here in W27, never in
  `7515dd410` (rewriting an upstream commit would break every future
  `/merge-upstream`). **Dead-end (do not
  retry):** merely skipping `term.destroy()` on win32 does **not** help — the
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

## W28 — Port scanner avoids retired `wmic`

- **Commits:** `e2d521b36`; `d1f5b5af0` (rejects PID 0 reported during
  node-pty's asynchronous Windows ConPTY startup, preventing the process-tree
  walk from attributing System PID 4 listeners to a terminal).
- **Override policy:** **LOCKED.** Modern Windows installations no longer ship
  `wmic`; retain the native PowerShell implementation unless upstream replaces
  the scanner with an equivalent non-`wmic` Windows process-table source.
- **Invariant:** On win32, terminal port discovery reads the process table once
  through PowerShell's `Get-CimInstance Win32_Process`, and obtains process
  names through `Get-Process`. It must not route either operation through
  `pidtree`'s `wmic` backend or invoke `wmic` directly. Process-tree roots must
  be positive integers; PID 0 must never expand into Windows system processes.
- **Where:** `packages/port-scanner/src/scanner.ts` (`getProcessTable`,
  `getProcessTreesForPids`, `getProcessNameWindows`).
- **Scan for:** `wmic` or a win32 `pidtree(-1, ...)` call in
  `packages/port-scanner`; upstream changes to process-tree or process-name
  discovery that bypass the PowerShell branch; removal of the positive-integer
  root filter.
- **Verify (Windows):** `bun test` from `packages/port-scanner`; start
  `bun run dev:desktop`, open a V2 terminal or preset, and confirm neither
  `[PortManager] Scan error: spawn wmic ENOENT` nor System PID 4 ports 139/445
  appear.
- **Symptom if broken:** opening a V2 terminal or preset repeatedly logs
  `[PortManager] Scan error: spawn wmic ENOENT`, or its workspace activity strip
  shows Windows file-sharing ports 139/445 owned by System PID 4.

---

## W29 — Windows agent-CLI workspace naming runs through PowerShell

- **Commits:** `e550791aa`.
- **Override policy:** **OVERRIDABLE.** If upstream makes the agent-CLI naming
  fallback shell-agnostic (resolves a platform shell with shell-aware quoting),
  adopt its version and drop this patch.
- **Invariant:** The agent-CLI fallback that names a workspace's title/branch
  (`generateNamesViaAgentCli`) must not spawn a hard-coded POSIX `/bin/bash` on
  win32 — a native Node process can't resolve `/bin/bash` (Git Bash's `/bin/*`
  mapping is MSYS-only). On Windows it runs the command through PowerShell via
  `getWindowsCommandShellArgs`, and both the env overlay and every CLI argument
  (model args + naming prompt) are quoted for the target shell
  (`envOverlayPrefix({ shell })`, `quotePowerShellArg`). POSIX keeps its
  login-shell (`-lc`) invocation with single-quote escaping.
- **Where:**
  `packages/host-service/src/trpc/router/workspace-creation/utils/ai-workspace-names.ts`
  (`NAMING_SHELL`, `quoteNamingArg`, `resolveNonInteractiveCommand`,
  `generateNamesViaAgentCli`).
- **Scan for:** a reintroduced `/bin/bash`/`process.env.SHELL` default or a
  `spawn(shell, ["-lc", …])` with no win32 branch; `quoteSingleShell` or
  `envOverlayPrefix(...)` used for the naming command without threading
  `NAMING_SHELL`; any upstream refactor of the naming fallback's shell
  invocation.
- **Verify (Windows):** create a v2 workspace from a prompt with an agent
  selected while the direct small-model path is unavailable (no
  `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` in the host-service env); confirm the
  workspace gets an AI title/branch and the host-service log shows
  `named via agent CLI` rather than
  `[generateNamesViaAgentCli] spawn failed: ... spawn /bin/bash ENOENT`.
- **Symptom if broken:** on Windows, prompt-driven workspaces never receive
  AI-generated names via the agent CLI; the host-service log records
  `[generateNamesViaAgentCli] spawn failed: ... ENOENT`.

---

## W30 — Isolate the win32 fs-watcher in a child process

- **Commits:** `ee1da54c2`; `22b1e41f3` (post-W30 ProcDump target and
  containment runbook).
- **Override policy:** **OVERRIDABLE.** Trigger: if `@parcel/watcher` fixes the
  Windows `ReadDirectoryChangesW` use-after-free (see W15 / the forensics doc),
  drop the isolation and go back to an in-process `FsWatcherManager` on win32.
  Notify the user.
- **Invariant:** On win32, **both** `FsWatcherManager` instantiation sites run
  the watcher in an isolated child process via `SubprocessWatcherManager`
  (never `new FsWatcherManager()` in-process). macOS/Linux keep the in-process
  native watcher. The child entry `fs-watcher-subprocess.js` must be emitted
  side-by-side with `host-service.js` / the main bundle so sibling-path
  resolution finds it.
- **Why:** `@parcel/watcher@2.5.6`'s native `windows` backend faults with a
  use-after-free (`0xC0000005`) on its own watch thread under worktree churn,
  and `FsWatcherManager` runs **in-process** in the host-service (and the
  Electron main process), so the fault takes the whole process down. There is
  no `subscribe()`-capable non-native backend on Windows (brute-force is
  snapshot-only), so the backend can't be swapped — isolate it instead. When the
  child dies, `SubprocessWatcherManager` respawns it, re-subscribes every live
  watch, invalidates the affected search indexes, and nudges consumers to
  refetch; the host-service survives. Full diagnosis + native-dump capture:
  [`windows-crash-forensics.md`](windows-crash-forensics.md).
- **Design notes:** the seam is `createFsHostService`'s
  `watcherManager: Pick<FsWatcherManager, "subscribe" | "close">`, so consumers
  are unchanged. The child runs the real `FsWatcherManager`; the parent proxy
  re-applies `patchSearchIndexesForRoot` from the forwarded event batches (the
  search index lives in the parent, where searches run) and
  `invalidateSearchIndexesForRoot` on (re)subscribe. Known minor gap: a kernel
  overflow *while subscribed* isn't forwarded as an invalidate, so search can be
  briefly stale until the next rebuild. Relation to **W15**: unchanged — the
  win32 `backend: "windows"` pin stays; isolation contains its crash.
- **Where:** `packages/workspace-fs/src/subprocess/` (`protocol.ts`,
  `run-subprocess.ts`, `subprocess-watcher-manager.ts`);
  `packages/workspace-fs/src/host/index.ts` (exports);
  `apps/desktop/src/main/fs-watcher/fs-watcher-subprocess.ts` (child entry) +
  its `electron.vite.config.ts` input entry;
  `packages/host-service/src/runtime/filesystem/filesystem.ts` and
  `apps/desktop/src/lib/trpc/routers/workspace-fs-service.ts` (win32-gated
  wiring). Env override: `SUPERSET_FS_WATCHER_SCRIPT_PATH`.
- **Scan for:** a new `new FsWatcherManager()` reachable on win32 without the
  `SubprocessWatcherManager` gate (a third instantiation site, or a merge
  reverting one of the two); removal of the `fs-watcher-subprocess` build entry;
  a change to `createFsHostService`'s `watcherManager` contract that the proxy
  no longer satisfies.
- **Verify (Windows):** rebuild; create/destroy several workspaces while PR
  sweeps / base-ref fetches run — no tray "Host service crashed (exit code
  3221225477)". Then find the `Superset.exe` running `fs-watcher-subprocess.js`
  and `taskkill /F` it: the host-service must stay up, log
  `[fs-watcher] child exited … respawning`, and file-tree/git-status must keep
  updating.
- **Symptom if broken:** host-service crashes `0xC0000005` on worktree churn
  (unisolated), or — if the child script isn't found/built — a logged fallback
  to the in-process watcher (`subprocess script not found …`) that reintroduces
  the crash, or file watching silently stops (no tree/git updates) if the child
  crash-loops past its guard.

---

## W31 — Read the ConPTY child PID after asynchronous startup

- **Commits:** `ab64af130`
- **Override policy:** **LOCKED** (win32 node-pty lifecycle).
- **Why:** `node-pty` initializes `WindowsTerminal.pid` to `0`, then replaces it
  with the ConPTY child PID after `ready_datapipe`. Copying `term.pid` into the
  daemon adapter during construction permanently preserved `0`. The resource
  monitor rejects non-positive PIDs, so its v2 endpoint returned no sessions
  and the command-palette monitor showed **No matching workspaces** even while
  terminals were running.
- **Invariant:** `NodePtyAdapter.pid` reads the current `term.pid`; it must not
  cache the constructor-time value. After a terminal produces output,
  `daemon.list()` must report a positive integer PID so Windows process-tree
  resource attribution can include the session.
- **Where:** `packages/pty-daemon/src/Pty/Pty.ts` (`NodePtyAdapter.pid`);
  `packages/pty-daemon/test/integration.test.ts` and `test/smoke-win32.ts`
  (live session list assertions).
- **Scan for:** `this.pid = term.pid` or another constructor-time PID snapshot;
  changes to node-pty startup/readiness or the daemon session-list protocol;
  resource-session filtering that accepts a session without a usable process
  root.
- **Verify (Windows):** open two v2 terminals, then open **Check resources** from
  the command palette. Both workspaces/sessions appear with CPU and memory
  values instead of an empty list. Automated: run `bun run smoke:win32` from
  `packages/pty-daemon`; the generic Node integration file still contains
  POSIX-only cases and is not the Windows smoke entry point.
- **Symptom if broken:** **Check resources** shows aggregate Superset usage but
  **No matching workspaces**; `/terminal/resource-sessions` returns an empty
  array while the daemon lists live sessions with `pid: 0`.

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
  `isActive` gate to the diff-stats portion only.);
  `7a6953977` (2026-07-23 merge: upstream #5887 replaced the row's activity
  strip with port/agent chips and rewrote the action cluster to appear on
  `group-focus-within` as well as `group-hover`. The badge cluster only hid on
  `group-hover`, so on the active/focused row the ↓N badge and the row actions
  overlapped in the shared grid cell — added `group-focus-within:hidden` to the
  badge cluster so it hides exactly when the actions appear.);
  `2b68b7c77` (2026-08-04 merge: upstream #6098 limited diff stats to the active
  workspace and #6021 added bulk selection. Retained the ↓N badge outside the
  active-only gate and hid it while a row is selected.)
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

- **Commits:** `08894008e`; `2b68b7c77` (2026-08-04 merge: upstream moved
  cleanup-state reads into a worker task; re-applied the deleted-upstream guard
  in the worker implementation.)
- **Override policy:** **OVERRIDABLE** (genuine bug fix, not Windows-specific).
  If upstream fixes the same false warning, adopt theirs.
- **What:** the branch-sync / cleanup warning no longer flags "unpushed commits"
  when the branch's upstream was merged and then deleted (the local commits are
  already in the base, so the warning was a false positive).
- **Where:** `packages/host-service/src/workers/tasks/git.ts`
  (`gitWorktreeStateTask`, `wasPushedRemoteDeleted`).
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

- **Commits:** `c1d3fc4df`; `2b68b7c77` (2026-08-04 merge: upstream added the
  v1-to-v2 migration decision path; retained the fork's unconditional v2 gate.)
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

- **Commits:** `367cf04eb`
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

## F9 — Stream-mode desktop development diagnostics

- **Commits:** `64ab90918`; `163ce2925` (use Node 22 for Windows installs and
  repair incomplete Electron packages with Bun)
- **Override policy:** **OVERRIDABLE.** If upstream documents an equivalent
  cross-platform diagnostic workflow, prefer its guidance.
- **Invariant:** Automated desktop diagnostics use Turbo stream mode so all task
  output is visible. After a timed-out run, agents check for and stop its
  surviving Bun/Turbo process tree before retrying, because Windows children can
  retain the development ports. Windows dependency installs use Node 22; an
  `Error: Electron uninstall` failure is treated as an incomplete Electron
  postinstall and repaired before retrying.
- **Where:** `AGENTS.md` (Windows port guidance).
- **Scan for:** removal of the `dev:desktop --ui=stream` command or the
  post-timeout process-tree cleanup warning; Windows installs running under Node
  24; an Electron package missing `path.txt` or `dist/electron.exe`.

## F10 — Bound and diagnose large `gh` open-PR sweep responses

- **Commits:** `a47242045`, `d47f255b1`; `2b68b7c77` (2026-08-04 merge:
  upstream moved PR work off the host loop and revised Sentry handling; retained
  the bounded sweep buffer and diagnostics in the refactored runtime.)
- **Override policy:** **OVERRIDABLE.** Upstream introduced the sweep in
  `b98580d63` (#5455). If upstream raises the buffer or reduces the REST payload,
  adopt its fix and remove this patch. The diagnostics are temporary: remove
  them once the intermittent host-service crash is identified or upstream adds
  equivalent crash telemetry.
- **Invariant:** Only the repo-wide 100-PR sweep raises `gh` stdout capacity to
  16 MiB. Other `gh` calls retain the existing 1 MiB default. Sweep diagnostics
  record concurrency, duration, result count, and process memory under
  `[host-service:pr-sweep]`; failures record captured output sizes without
  logging the captured PR payload. A process-wide
  `[host-service:diagnostics]` heartbeat records memory, CPU, event-loop delay,
  uptime, and active resource counts once per minute so unrelated native exits
  retain useful lead-up evidence.
- **Where:** `exec-gh.ts` (`ExecGhOptions.maxBuffer`); `github-query.ts`
  (`fetchOpenPullRequestsFromGh`); `pull-requests.ts` (bounded diagnostics); the
  co-located query and runtime tests; `safety.ts` and both host-service entry
  points (process heartbeat).
- **Scan for:** upstream changes to `execGh` buffer handling or the open-PR
  sweep request that make the scoped override redundant. For a new crash, grep
  the installed `$SUPERSET_HOME_DIR/host/<org-id>/host-service.log` for
  `[host-service:diagnostics]` and `[host-service:pr-sweep]`, then correlate the
  final heartbeats with the coordinator's native exit code.
- **Symptom if broken:** large repositories log
  `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` and fall back to Octokit during startup.

## F11 — Keep populated v2 tab-bar filler draggable

- **Commits:** `5589dcb8b`.
- **Override policy:** **OVERRIDABLE.** Upstream introduced the regression in
  `616bb6796` (#5824). If upstream makes the populated tab bar's empty area
  draggable, adopt its fix and remove this patch.
- **Invariant:** When v2 merges the title bar into the pane tab bar, only actual
  tabs and interactive controls are `no-drag`. The flex filler to the right of
  populated tabs remains part of the Electron `drag` region. The zero-tab and
  populated-tab states must both allow moving the window.
- **Where:** `packages/panes/src/react/components/Workspace/components/TabBar/TabBar.tsx`.
- **Scan for:** `no-drag` on a populated tab track that expands with `flex-1`,
  or any tab-bar refactor that makes the empty filler non-draggable.
- **Symptom if broken:** the window moves with no tabs open, but stops moving
  from the same empty tab-bar area as soon as a tab opens.

## F12 — Prevent background-terminal flash on v2 workspace switch

- **Commits:** `320617033`.
- **Override policy:** **OVERRIDABLE.** If upstream initializes the volatile v2
  pane store from the selected workspace's cached local state, or otherwise
  prevents attached terminals being briefly classified as background sessions,
  adopt its fix and remove this patch.
- **Invariant:** A v2 workspace's pane store starts with the cached persisted
  layout for that workspace. It must not start empty and wait for a live-query
  effect when the matching cache row is already available.
- **Where:** `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2WorkspacePaneLayout/useV2WorkspacePaneLayout.ts`.
- **Scan for:** upstream changes to v2 pane-store creation or layout hydration
  that seed the store synchronously from the matching workspace row.
- **Symptom if broken:** switching to a workspace with an attached terminal
  briefly shows the background-terminal button before its terminal panes render.

## F13 — v2 OPEN_IN_APP hotkey registered at workspace level, not in the button

- **Commits:** `e5d30ad43`
- **Override policy:** **OVERRIDABLE — expected to be fixed upstream; prefer
  theirs on sight.** This is a stopgap for a plain bug: upstream `616bb6796`
  (#5824) moved the Open-in button into the sidebar but left the hotkey
  registered inside it, so ⌘/Ctrl+O dies with a collapsed sidebar. It's the kind
  of regression upstream will very likely fix. On any merge, if `main` decouples
  the shortcut from the button's mount — registers `OPEN_IN_APP` at a
  workspace/global level, or moves the button somewhere always-mounted — **delete
  `useV2OpenInAppHotkey` and adopt upstream's**, and notify the user. Don't run
  both (double-fire). Keep this hook only while upstream's shortcut is still
  button-mount-coupled.
- **Invariant:** The `OPEN_IN_APP` shortcut (⌘/Ctrl+O → open the worktree in the
  chosen editor) is registered once at the always-mounted workspace level
  (`useV2OpenInAppHotkey`, called from `V2WorkspaceContent`), **not** inside
  `V2OpenInMenuButton`. It must keep working when the right sidebar is collapsed
  (button unmounted) and must not be registered in more than one place at once
  (a second `useHotkey("OPEN_IN_APP", …)` would double-fire the open mutation).
  The hook mirrors the button's target gate — local workspace with a provisioned
  `worktreePath`, resolved default app from `useV2ProjectDefaultApp`.
- **Where:** `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2OpenInAppHotkey/`
  (the hook); wired in the same route's `page.tsx` (`V2WorkspaceContent`);
  registration removed from
  `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/V2OpenInMenuButton/V2OpenInMenuButton.tsx`.
- **Scan for:** a `useHotkey("OPEN_IN_APP", …)` reappearing inside
  `V2OpenInMenuButton` (or any conditionally-mounted component) — remove it, the
  workspace-level hook owns the shortcut; upstream adding its own always-mounted
  OPEN_IN_APP registration (switch to theirs, delete the hook).
- **Symptom if broken:** ⌘/Ctrl+O does nothing while the right sidebar is
  collapsed, or opens the editor twice per press (double registration).

## F14 — v2 Open-in button duplicated into the always-visible pane tab bar

- **Commits:** `babffc785`; `443552dfa` (branch-label handling, superseded by);
  `011d4f49f` (added a `variant: "sidebar" | "tabbar"` prop to
  `V2OpenInMenuButton`. `"tabbar"` gives the copy transparent chrome matching the
  run button — same height, `rounded-md`, `hover:bg-muted` — because the reused
  `bg-secondary/50` sidebar fill clashed with the tab bar's background, which
  differs between the empty and populated tab states; it also always shows the
  `/branch` label since the tab bar has no wide `@container` ancestor for the
  `@[240px]` gate. `"sidebar"` (default) keeps the original filled pill.);
  `43cc247a6` (exact parity tweaks: added `shrink-0` to the wrapper — the run
  button has it, so a tight tab bar no longer squishes the Open-in button — and
  dropped a no-op `justify-center` the run button doesn't carry)
- **Override policy:** **OVERRIDABLE — stopgap, expect this area to move again.**
  Preference, not a bug: upstream `616bb6796` (#5824) deliberately moved the
  button into the sidebar's PR action header; this fork wants it always reachable
  from the top chrome. This top-right cluster is **volatile** — upstream has
  already reorganized it twice recently (#5824 chrome reorg, #5887 sidebar
  chips), so treat this duplicate as temporary. On any merge that touches
  `renderTabBarTrailing`, the top-bar chrome, or the Open-in button placement,
  **re-evaluate**: if upstream ships its own always-visible top-bar/tab-bar
  Open-in entry point, drop this duplicate and adopt theirs (notify the user);
  otherwise re-assert it wherever the trailing cluster moved to. Removing this
  patch is always safe — the sidebar button (upstream's) still works on its own.
- **Invariant:** `V2WorkspaceOpenInButton` renders in the v2 pane tab bar's
  trailing cluster (`renderTabBarTrailing`, beside the run button and
  right-sidebar toggle), which is visible in every sidebar state — unlike the
  `TopBar`, which is hidden on the v2 workspace route whenever the left dashboard
  sidebar is expanded (`layout.tsx` `hideTopBar`). This is a **second** instance;
  the upstream sidebar copy in `PRActionHeader` stays. Both share the same
  `V2WorkspaceOpenInButton` component and per-project default-app state, so they
  can't drift. The OPEN_IN_APP hotkey is owned separately by [F13] — neither
  button registers it. The tab-bar copy passes `variant="tabbar"` for run-button
  chrome + always-on branch label; `V2OpenInMenuButton.variant` defaults to
  `"sidebar"`, so every other caller (the sidebar) keeps its filled-pill
  container-query behaviour untouched.
- **Where:** `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/page.tsx`
  (`V2WorkspaceContent`, `renderTabBarTrailing`);
  `V2WorkspaceOpenInButton` / `V2OpenInMenuButton` (the `variant` prop).
- **Scan for:** upstream re-adding an always-visible top-bar / tab-bar Open-in
  button (remove this duplicate, use theirs); a merge that rewrites
  `renderTabBarTrailing` and drops this instance (re-add it); the button being
  moved such that only the conditionally-hidden `TopBar` hosts it (would
  regress to hidden-when-left-sidebar-expanded).
- **Symptom if broken:** the Open-in button only appears in the right sidebar
  again, or shows twice in the tab bar (accidental double-add).

## F15 — Keep v2 tab-bar actions compact

- **Commits:** `a7e71fd4a`
- **Override policy:** **OVERRIDABLE.** Adopt upstream spacing if it keeps the
  complete trailing action cluster visible at narrow desktop widths.
- **Invariant:** The v2 Run button shows only its icon and action label; the
  registered hotkey remains functional but is not repeated in the button. The
  tab-bar Open-in branch label is capped at 6rem while the sidebar variant keeps
  its 140px cap.
- **Where:** `V2WorkspaceRunButton.tsx`; `V2OpenInMenuButton.tsx`.
- **Scan for:** `useHotkeyDisplay("RUN_WORKSPACE_COMMAND")` returning to the v2
  Run button; the tab-bar branch label sharing the sidebar's 140px maximum.
- **Symptom if broken:** the Run shortcut or a long branch name crowds the v2
  pane tab bar and pushes trailing actions toward the window controls.

## F16 — Middle-click closes tabs in an overflowing v2 tab bar

- **Commits:** `85c09be13`
- **Override policy:** **OVERRIDABLE.** If upstream prevents native autoscroll
  while retaining middle-click tab closing, adopt its implementation.
- **Invariant:** Pressing the middle mouse button anywhere on a v2 pane tab
  closes that tab, including when the tab strip overflows horizontally. The
  handler prevents the browser's native autoscroll gesture on mouse down rather
  than waiting for `auxclick`, while normal tab-strip scrolling remains intact.
- **Where:** `packages/panes/src/react/components/Workspace/components/TabBar/components/TabItem/TabItem.tsx`.
- **Scan for:** middle-click handling moving back to `auxclick`, being limited
  to the tab title, or failing to call `preventDefault()` before an overflowing
  scroll container starts native autoscroll.
- **Symptom if broken:** middle-clicking a tab in a full tab strip shows the
  autoscroll cursor or scrolls the strip instead of closing the tab.
