# superset-pwsh — Existing Windows Fork Baseline Patch Log

Frozen, granular record of everything the **foundational native-Windows port**
did (patch-list entry **W1**), migrated verbatim from the now-removed
`windows-port-audit.md` "Fixed In This Pass" section. This is reference/history,
**not** a merge checklist:

- **Do NOT walk this file after a `main` merge.** The live, walkable invariants
  live in [`windows-port-patch-list.md`](windows-port-patch-list.md). W1 is the
  umbrella entry for all of this; the recurring ones (spawns without
  `windowsHide`, `.sock` vs named pipes, `&&` chaining, `.cmd` wrappers, etc.)
  are broken out as their own W-entries with scan signatures.
- **Where a bullet here conflicts with the patch list, the patch list wins.**
  (e.g. the Biome line-ending bullet below says `auto`; the committed and correct
  value is `lf` — see W3.)

---

## Origin — fork creator's description

This branch builds on [`garciarsdiego/superset@windows-native-port`](https://github.com/garciarsdiego/superset/tree/windows-native-port).
The original author described it as a native Windows x64 port / build-validation
branch that makes the existing desktop app build, package, install, authenticate,
sync, run terminals, and manage workspaces on native Windows x64 while preserving
macOS/Linux behavior.

**Scope**

- Windows x64 desktop packaging with NSIS.
- Windows native build prerequisite checks (Visual Studio Build Tools, MSVC
  compiler tools, Spectre libraries, Windows SDK).
- Portable Bun/TypeScript package, release, setup, teardown, and deploy scripts
  replacing POSIX-only package-script entrypoints.
- Windows shell handling for `cmd.exe`, PowerShell, `pwsh.exe`, Git Bash, and
  POSIX shells.
- Windows named-pipe support for host-service, terminal-host, and pty-daemon
  control paths.
- Windows ConPTY lifecycle and process-tree cleanup via native helpers /
  `taskkill.exe`.
- Windows CLI distribution support and desktop-owned update behavior.
- Windows-native agent wrappers, notify hooks, Git askpass, setup/teardown
  scripts, and installer reset behavior.
- Packaged-build hardening so local development URLs don't leak into installed
  desktop builds.
- Diagnostic settings to disable update checks and analytics while keeping cloud
  login and sync enabled.

**Non-goals**

- No licensing, entitlement, paywall, or paid-feature behavior removed/bypassed.
- No intended macOS/Linux release behavior change.
- No Windows ARM64 target in this pass.
- No attempt to turn the local Docker stack into an offline packaged-desktop
  backend.

**Local validation performed** (on Windows): `bun install`, `bun run lint`,
`bun run typecheck`, `bun run --cwd apps/desktop install:deps`,
`bun run --cwd apps/desktop typecheck`, `bun run --cwd apps/desktop prebuild`,
`bun run --cwd apps/desktop build --win --x64`,
`bun run --cwd packages/host-service test:e2e`,
`bun run --cwd packages/pty-daemon test:integration`, `bun run smoke:win32`.
The packaged installer was also tested manually, including cloud auth/login and
normal app usage.

---

## Fixed In This Pass

- Replaced root `postinstall` with `scripts/postinstall.ts` so Bun can run it on Windows.
- Replaced root `lint` with `scripts/lint.ts`, preserving the Biome check and custom `simple-git`/git-ref scans without Bash.
- Replaced root `typecheck` with `scripts/typecheck.ts`, preserving `turbo typecheck` while applying a Windows-safe default concurrency to avoid allocator failures after desktop native modules are materialized.
- Added `scripts/dev-with-port.ts`, `scripts/cli-dev.ts`, and `scripts/with-env.ts` to remove POSIX env/default-port syntax from normal package scripts.
- Converted Next/Wrangler dev scripts from `sh -c 'exec ... ${PORT:-default}'` to portable Bun helpers.
- Converted `packages/email` and `packages/cli` dev scripts away from `grep`/`cut`/`env` shell forms.
- Converted the Expo mobile dev script away from POSIX inline env assignment by using the shared `scripts/with-env.ts` helper.
- Replaced the macOS process metrics install shell fallback with a portable TypeScript install script that skips non-macOS before invoking `node-gyp`.
- Replaced the host-service e2e Electron resolver's Unix `find` call with platform-aware filesystem resolution for `electron.exe`, Linux `electron`, macOS `Electron.app`, and Bun flat-store installs.
- Added host-service e2e launcher coverage for Windows/macOS/Bun Electron resolution and actionable Electron native-module ABI mismatch detection.
- Updated the host-service adoption e2e test to use a Windows named pipe for its daemon socket instead of a filesystem `.sock` path.
- Added `packages/cli` `build:win32-x64` and taught `scripts/build-dist.ts` to build a standalone Windows CLI distribution from Node's Windows zip, Windows native optional packages, `superset.exe`, and a `superset-host.cmd` wrapper.
- Added `packages/cli/scripts/smoke-test.ts`, a cross-platform distribution smoke that replaces the Bash-only smoke path for Windows and verifies the extracted Windows artifact without leaking modules from the developer machine.
- Kept Windows CLI artifact resolution for distribution/build validation, but disabled `superset update` on Windows so installed Windows apps update through desktop `electron-updater` instead of a second CLI updater path.
- Hardened CLI OAuth browser launching by replacing shell-string `exec()` calls with detached `spawn()` argument arrays; Windows now launches through `cmd.exe /c start` with verbatim arguments so authorization URLs containing `&`, `%`, and query parameters are not reinterpreted by the shell.
- Hardened CLI workspace deep-link launching with the same verbatim Windows `cmd.exe /c start` argument construction so `superset://` URLs containing shell metacharacters are not reinterpreted before reaching the desktop app.
- Fixed host-service terminal env startup on Windows by using the inherited process environment instead of trying to invoke `cmd.exe` with POSIX `-i -l -c` shell flags; the packaged Windows dist smoke now reaches `health.check`.
- Hardened desktop resource metrics on Windows by replacing the shell-string PowerShell process listing with a `powershell.exe` argv call, and covered Windows CRLF CSV parsing plus the no-shell command contract.
- Added a public Windows PowerShell CLI installer at `apps/marketing/public/cli/install.ps1`, updated CLI docs with Windows install instructions, and changed the POSIX installer to direct Windows shells to the PowerShell path instead of reporting Windows as unsupported.
- Updated desktop worktree removal so Windows uses Node's native recursive deletion for renamed worktree directories instead of spawning `/bin/rm -rf`, while Unix keeps the existing spawned cleanup path.
- Hardened the host-service v2 destroy saga (`workspace-cleanup.ts`) against MSYS git leaving an orphaned worktree on disk: `git worktree remove --force --force` unregisters the worktree but its recursive delete bails on pnpm's `node_modules` junctions (and locked files), so the directory survives while git reports success and the registry check passes. After confirming the worktree is unregistered, the saga now removes any surviving directory with Node's `fs.rm(..., { recursive: true, force: true, maxRetries })` — which unlinks junctions as links and retries transient Windows `EBUSY`/`EPERM`. General lesson: on Windows, git's own recursive delete is unreliable, so anything relying on `git worktree remove` to clear disk needs an `fs.rm` backstop.
- Hardened worktree hook-tolerance detection on Windows by falling back to `git rev-parse --is-inside-work-tree` when `git worktree list` path spelling does not string-match the requested path.
- Normalized the Superset path env vars to native separators on Windows in the v2 terminal env builder (`packages/host-service/src/terminal/env.ts`, `toNativePath`). `projects.repoPath` is stored POSIX-normalized in the DB (forward slashes) while `worktreePath` comes from git as native backslashes, so `SUPERSET_ROOT_PATH` and `SUPERSET_WORKSPACE_PATH` disagreed and setup/teardown scripts joining them with `\...` literals emitted mixed separators (`C:/repos/example-project\tests\...`). Cosmetic only (Windows accepts both), but now both vars are all-backslash on win32.
- Made desktop Git utility tests portable on Windows by avoiding `chmod`, POSIX `|| true`, Homebrew-only PATH assertions, and shell-composed Git commits in the affected cases.
- Skipped the desktop terminal POSIX `locale | grep | cut` probe on Windows; Windows terminals now fall back directly to the default UTF-8 locale without spawning a guaranteed-failing shell pipeline.
- Added Windows `.cmd` shims for Superset-managed agent wrappers (`claude`, `codex`, `opencode`, `amp`, `droid`, `gemini`, `mastracode`, `copilot`, and `cursor-agent`) so native Windows shells can resolve PATH-injected wrappers through `PATHEXT`; the existing Bash wrappers remain in place for Unix and Git Bash behavior.
- Made agent-wrapper tests platform-aware by keeping Bash wrapper execution coverage on Unix and adding a native Windows `.cmd` execution test that verifies real-binary lookup, argument forwarding, and `SUPERSET_AGENT_ID` propagation.
- Added a native Windows notification hook entrypoint (`notify.cmd`) plus Node dispatcher (`notify.mjs`) so agent lifecycle hooks can post v2 host-service events and fall back to the v1 Electron hook without invoking Bash or PowerShell.
- Enabled Windows tray lifecycle behavior: closing the main window hides it to the system tray, explicit tray Quit still performs the full app quit path, and the tray exposes an optional launch-at-login toggle.
- Enabled desktop `electron-updater` on Windows and made the Windows NSIS target explicitly per-user (`perMachine: false`) while keeping the GA target x64-only.
- Hardened packaged desktop builds against local `.env` leakage: production build config no longer lets local `localhost` URLs override inherited release env, and local API/Web/Relay/Electric/Streams URLs are replaced with cloud defaults unless explicitly allowed for a local-build test.
- Made Claude, Codex, Droid, Mastra, OpenCode, Amp, and Pi hook generation choose platform-appropriate notify commands, including idempotent cleanup of stale Windows Claude hook commands.
- Added `apps/desktop/scripts/install-app-deps.ts` so Windows native rebuild failures identify missing Visual Studio components directly.
- Added a shared Windows native-build prerequisite checker and guarded desktop `install:deps`, `build`, `package`, and `release` entrypoints so machines missing MSVC Spectre libraries fail with actionable guidance before invoking Electron native rebuilds.
- Expanded the Windows native-build prerequisite checker to detect incomplete MSVC toolset installs that have a version directory but are missing `cl.exe` compiler tools for x64/x86, and updated guidance to name both compiler tools and Spectre libraries.
- Updated desktop build/release docs to use the portable TypeScript release script and document Windows native packaging prerequisites.
- Hardened `apps/desktop/scripts/copy-native-modules.ts` for Windows by deleting Bun symlinks with `unlinkSync` and dereferencing nested symlinks when materializing native runtime modules.
- Replaced the desktop native-module npm fallback fetch pipeline (`curl | tar`) with shell-free `curl` and `tar` process calls using explicit argv and a temporary tarball.
- Updated `apps/desktop/scripts/validate-native-runtime.ts` so all platform package checks honor `TARGET_PLATFORM`/`TARGET_ARCH`, including `@parcel/watcher`.
- Added Windows coverage for the packaged bundled CLI shim (`superset.cmd`) and made the test suite mock Electron correctly under Bun on Windows.
- Ported cloud Git credential askpass generation to Windows by emitting a native `.cmd` helper and storing tokens in a sidecar file instead of embedding them in POSIX shell text.
- Set Biome formatter line endings to `auto`, which avoids CRLF-vs-LF noise on native Windows checkouts while preserving LF expectations on Unix.
- Fixed `DaemonClient` socket data typing for Node's Windows-visible `string | Buffer` data event type.
- Fixed host-service env preservation test to assert `Path` on Windows and `PATH` elsewhere.
- Added `@superset/shared/shell` for cross-platform shell basename normalization, known-shell classification, shell-ready marker support, and Windows-native shell arguments.
- Refactored desktop shell wrappers, terminal-host readiness gating, and host-service shell launch code to use the shared shell utility instead of POSIX basename checks.
- Added coverage for Git Bash paths such as `C:\Program Files\Git\bin\bash.exe` and native Windows shells (`cmd.exe`, `powershell.exe`, `pwsh.exe`).
- Made shell-wrapper integration tests portable on Windows by preserving the current PATH when spawning Git Bash and avoiding chmod-only assertions that Windows cannot represent reliably.
- Changed host-service pty-daemon socket paths to use Windows named pipes (`\\.\pipe\superset-ptyd-...`) instead of filesystem `.sock` paths on Windows.
- Taught pty-daemon `Server.listen()`/`close()` to skip Unix socket file operations (`mkdir`, `unlink`, `chmod`) for Windows named pipes.
- Fixed daemon readiness polling so Windows named pipes are probed by connection instead of gated by `fs.existsSync`.
- Added a shared desktop terminal-host path helper so the v1 terminal-host daemon and client use a stable Windows named pipe instead of `~/.superset/terminal-host.sock` on Windows.
- Updated terminal-host client spawning, shutdown, liveness probing, and stale socket cleanup so Windows named pipes are treated as connectable endpoints rather than filesystem paths.
- Updated the terminal-host daemon to skip Unix-only socket chmod/unlink on Windows named pipes, and updated its local socket probe helper so Windows no longer opts out.
- Made regular Windows ConPTY spawn independent of POSIX-only node-pty master fd validation; fd-handoff now reports a clear unsupported path for live Windows sessions.
- Fixed Windows PTY close by using `taskkill.exe /PID <pid> /T /F` instead of passing POSIX signals to node-pty, which throws on Windows.
- Added `bun run smoke:win32` for repeatable native Windows pty-daemon smoke coverage.
- Ported `scripts/smoke-pty-daemon-cleanup.mjs` to Windows named pipes and a Node coordinator helper, with async named-pipe readiness, Windows process cleanup, and bounded in-process liveness checks.
- Ported pty-daemon integration/control-plane/byte-fidelity/signal-recovery/handoff tests to Windows named pipes and platform shell helpers.
- Made the handoff integration test assert the clear Windows unsupported fd-handoff path while preserving real fd-handoff assertions on Unix.
- Made signal-recovery integration tests run from the TypeScript source entrypoint instead of requiring a prebuilt `dist/pty-daemon.js` bundle.
- Suppressed noisy Windows node-pty kill fallback errors by skipping the fallback kill call when `taskkill` already removed the process.
- Replaced root `release:desktop` with `apps/desktop/scripts/create-release.ts`, preserving version bump, optional commit-based releases, tag/workflow monitoring, publish, merge, and host-service patch-bump behavior in a Windows-native entrypoint.
- Replaced root `release:canary` with `scripts/release-canary.ts`, preserving optional commit temp-branch behavior and workflow dispatch.
- Replaced `apps/relay` `deploy` with `apps/relay/scripts/deploy.ts` and added `deploy:staging`; the portable script preserves Fly deploy/scale/status plus regional `/health` smoke checks.
- Verified package scripts no longer reference `.sh`, Bash, or `sh -c` entrypoints. Remaining `.sh` files are compatibility/source scripts, not package-script launch blockers.
- Added `.superset/setup.local.ts` and `.superset/teardown.local.ts` to mirror the local DB setup/teardown flow without Bash, `jq`, `curl`, `grep`, `sed`, or POSIX file operations.
- Added `.superset/setup.ts` and `.superset/teardown.ts` wrappers; Unix delegates to the existing Bash scripts, while Windows delegates to the native local Bun scripts.
- Updated `.superset/config.json` and generated local overlays to use the portable Bun setup/teardown entrypoints.
- Updated host-service setup fallback and workspace cleanup teardown resolution so Windows can choose portable `.superset/*.ts` scripts and hidden cleanup terminals exit correctly under `cmd.exe` or PowerShell.
- Hardened host-service workspace setup fallback so Windows uses `.superset/setup.ts` when available and otherwise skips Bash-only `.superset/setup.sh` fallback scripts instead of trying to invoke `bash`.
- Updated desktop workspace-delete teardown execution to default to `cmd.exe` on Windows, use verbatim `cmd` arguments for quoted redirection paths, prepend managed binary wrappers to Windows PATH, and kill timed-out teardown process trees with `taskkill`.
- Updated docs and marketing platform copy to advertise Windows 10/11 x64 CLI/source-build support while keeping packaged desktop installer waitlist messaging separate.
- Ported host-service setup, teardown, terminal, and workspace-cleanup integration tests to Windows named pipes via a shared test socket helper.
- Fixed the host-service setup integration test for Windows CRLF command writes and realistic integration-test timeout.
- Fixed hidden teardown integration setup ordering and made the fake PTY path exercise Windows teardown marker creation without relying on Unix shell execution.
- Fixed host-service terminal initial commands to append Windows-native CRLF for `cmd.exe`, PowerShell, and `pwsh`, while continuing to gate shell-ready markers only for supported POSIX shells.
- Fixed `buildTeardownInitialCommand` for `cmd.exe` so teardown success/failure is propagated with `bun "script" && exit /b 0 || exit /b 1` instead of stale `%ERRORLEVEL%` expansion.
- Hardened the Windows real-daemon terminal cleanup integration test to use a native `cmd.exe` session and daemon-reported PID instead of PowerShell/Node/Bun helper processes that can fail inside constrained ConPTY environments.
- Ported host-service real-spawn daemon integration tests to Windows named pipes and native `cmd.exe` session metadata.
- Added `--test-force-exit` to the host-service daemon integration script so Node exits cleanly after node-pty integration tests on Windows.
- Added a Windows daemon-update path: with live ConPTY sessions, update returns the existing explicit "close sessions first" failure; with no live sessions, it safely stops and respawns the daemon, clears stale update state, and logs `mode: "windows_restart_no_live_sessions"`.
- Updated daemon/CLI distribution docs that still described Unix-only sockets, POSIX-only wrappers, or Windows ConPTY as out of scope.
- Restored workspace-fs Windows drive-root watcher event normalization, replacing a stale "desktop doesn't ship on Windows" omission with tested local path normalization for Parcel watcher events.
- Hardened workspace-fs atomic overwrites so Windows skips POSIX mode preservation (`chmod`) on temporary replacement files, while Unix keeps source mode preservation.
- Updated the public terminal daemon deep-dive and daemon protocol/test comments so they describe the local socket/named-pipe transport instead of Unix sockets only.
- Replaced desktop renderer user-facing Finder-only file-manager labels with platform-aware labels: Windows now shows File Explorer, macOS shows Finder, and Linux shows Files while preserving the existing `openInFinder` route/API names.
- Hid macOS-only desktop Open In targets (`xcode`, `iterm`, `terminal`, and `appcode`) from Windows/Linux renderer menus and command-palette entries, while preserving cross-platform editors and falling back to the platform file manager when a persisted default is not available.
- Taught desktop external-app launching to resolve Windows CLI commands with `PATHEXT`-aware candidates instead of treating Windows like Linux, and to return a clear unsupported-platform error for macOS-only app selections.
- Fixed the desktop "Open in editor" buttons on Windows (`spawnAsync`, `apps/desktop/src/lib/trpc/routers/external/helpers.ts`): editor CLIs are `.cmd`/`.bat` shims (e.g. `code.cmd`), and a bare `spawn("code")` can't resolve them via `PATHEXT`, so it failed with `spawn code ENOENT`. Windows now spawns with `shell: true` (cmd.exe resolves the shim) + `windowsHide: true` (no console flash); args are manually quoted because shell mode doesn't quote them, preserving spaces in the target path. Fixes every Windows editor CLI candidate, not just VS Code. Non-win32 behavior is unchanged.
- Hardened external path normalization so `~` expansion works from `HOME`, `USERPROFILE`, or `os.homedir()` and resolved paths are normalized to the host platform.
- Updated v1 and v2 project script import controls to accept Windows-native script files (`.cmd`, `.bat`, `.ps1`, `.psm1`) and portable Bun/Node scripts (`.ts`, `.js`, `.mjs`, `.cjs`) instead of silently ignoring every non-Unix script extension.
- Updated setup/teardown documentation and the in-app setup-script prompt so complex project automation recommends portable Bun/Node scripts, documents Windows-native `.ps1`/`.cmd`/`.bat` entrypoints, and no longer presents `.sh` as the only serious option; the Linear integration docs now include a native Windows PowerShell plus `.cmd` launcher path.
- Expanded host-service setup fallback discovery so Windows workspace creation can run `.superset/setup.cmd`, `.superset/setup.bat`, or `.superset/setup.ps1` when no portable `.superset/setup.ts` exists, while still refusing Bash-only `.superset/setup.sh` fallbacks on Windows.
- Made configured setup arrays shell-aware for Windows PowerShell by chaining commands with explicit `$?`/`$LASTEXITCODE` guards instead of assuming `&&` is available, while keeping existing `&&` behavior for `cmd.exe` and POSIX shells.
- Expanded host-service auto-teardown discovery so Windows workspaces can use `.superset/teardown.cmd`, `.superset/teardown.bat`, or `.superset/teardown.ps1` when no portable `.superset/teardown.ts` exists, with command generation that preserves exit status under both `cmd.exe` and PowerShell.
- Made legacy desktop workspace teardown config arrays shell-aware for Windows PowerShell by using the same explicit `$?`/`$LASTEXITCODE` guard chain, while preserving existing `&&` command chaining for `cmd.exe` and POSIX shells.
- Added shared shell command-chain construction and routed v2 workspace run/sequential preset launches through host-service `initialCommands`/`writeCommands`, so PowerShell terminals use interactive `; if ($?) { ... }` chaining while `cmd.exe` and POSIX shells keep `&&`.
- Made sequential preset reuse of an active v2 terminal apply preset `cwd` through shell-specific directory commands (`cd /d`, `Set-Location -LiteralPath`, or POSIX `cd`) instead of a POSIX-quoted `cd ... && ...` string.
- Routed legacy desktop setup/open-worktree writes and v1 sequential preset launches through a shell-aware `terminal.writeCommands` path, and added v1 terminal-host `commands` support so command arrays are chained after the terminal shell is resolved.
- Removed the legacy renderer focused-preset `cd ... && ...` helper; active terminal preset cwd is now applied by the Electron main process with shell-specific `cd /d`, `Set-Location -LiteralPath`, or POSIX `cd` commands.
- Made v1 workspace-run start/restart paths keep command arrays in pane state and route live-session reuse through `terminal.writeCommands` while fresh or recovered terminal sessions receive `createOrAttach.commands`, avoiding stored renderer `&&` chains on PowerShell.
- Made desktop and host-service process-tree cleanup explicitly Windows-native by routing Windows kills through `taskkill.exe /PID <pid> /T /F`, treating already-missing PIDs as successful no-ops, and updating the legacy desktop terminal-host pty subprocess to use the same helper instead of importing `tree-kill` directly.
- Made pty-daemon process-tree discovery explicitly platform-aware so Windows returns an empty POSIX process-group table without spawning `ps`, while Unix keeps the existing `ps -axo pid=,ppid=,pgid=` parser behind focused coverage.
- Routed stale desktop terminal-host daemon PID cleanup through the same Windows `taskkill` helper, while preserving POSIX process-group signaling for Unix daemon cleanup.
- Hardened stale desktop terminal-host PID cleanup so Windows reads the candidate PID's command line with `powershell.exe` argv and only kills it when it matches the terminal-host daemon, avoiding accidental `taskkill` of an unrelated process after PID reuse.
- Cleared the external MSVC/Spectre prerequisite on this machine and verified `bun run --cwd apps/desktop install:deps`, `bun run --cwd apps/desktop prebuild`, and `bun run --cwd apps/desktop scripts/run-electron-builder.ts --publish never --win --x64`; the Windows NSIS installer and blockmap are generated under `apps/desktop/release`.
- Ported the host-service adoption e2e commands to native Windows shells, added `--test-force-exit` to the Electron-as-Node runner, and verified `bun run --cwd packages/host-service test:e2e` passes on Windows.
- Verified Docker Desktop and Caddy availability. Full `.superset/setup.local.ts` passes after building the GHCR-only neon-proxy image locally from upstream source with LF line endings; Postgres, neon-proxy, Electric, migrations, dev-account seed, config overlay, and teardown all complete on native Windows.
- Hardened desktop Anthropic model settings so placeholder text is not persisted as a credential and Bedrock-specific env vars are suppressed whenever a direct Anthropic API key/OAuth credential is available; rebuilt the Windows NSIS installer with the fix.
- Added a Windows NSIS reinstall reset page: the installer can replace the previous version while clearing Superset local auth/cache/runtime data, preserving `~/.superset/worktrees`; a separate checkbox moves Claude Code/mastracode login files aside with `.superset-reset.bak` for forced resync without hard-deleting them.
- Added local-test performance switches for packaged desktop builds: `SUPERSET_DISABLE_AUTO_UPDATE=1` skips update checks, and the local placeholder PostHog key `phc_local_dev_disabled` is now treated as telemetry disabled instead of making real PostHog network calls.
- **V2 terminal sessions cannot survive an app restart on Windows — known platform limitation, now handled gracefully.** The V2 architecture keeps live PTYs in a detached `pty-daemon` process (`packages/host-service/src/daemon/DaemonSupervisor.ts`) that is designed to outlive a host-service/app restart via named-pipe adoption (`tryAdopt`). On Windows the daemon cannot outlive the app: verified empirically that a daemon spawned `detached: true` + `unref()` is still killed the instant the Electron app exits (while the `bun`/`turbo` dev tree stayed alive), because Node's `detached` sets `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` but **not** `CREATE_BREAKAWAY_FROM_JOB`, so the daemon stays in Electron's Windows Job Object and dies on job close. In dev this also can't be observed by default (`shouldKillStaleDaemonForDev` kills the daemon at startup, and `detached:!isDev` spawns it attached) — a true breakaway spike would be required to make live sessions survive an app restart, and even then a PC reboot loses them on every platform. Reference symptom: after any Windows app restart, a V2 tab's session is gone.
- **Handled the lost-session case read-only instead of silently respawning.** When the live PTY can't be adopted (always on Windows post-restart; any platform post-reboot/daemon-crash), `resolveSessionForAttach` in `packages/host-service/src/terminal/terminal.ts` now returns a `SESSION_ENDED` sentinel rather than respawning a fresh shell over the renderer's painted scrollback. The renderer transport (`terminal-ws-transport.ts`) maps that to a `session_ended` diagnosis; the socket stays closed so input is already blocked (read-only) and the scrollback is preserved. The pane-header indicator (`TerminalConnectionIndicator.tsx`) shows a neutral **"Previous session (ended)"** pill (not a red "Disconnected") with no Reconnect button — the user opens a new tab for a fresh shell. This changes the lost-session path on all platforms (macOS/Linux now tombstone read-only after a reboot instead of silently respawning); flag if this ever feeds upstream.
- **Snapshot live terminal buffers on app hide/close so full-screen TUIs restore as a readable reference.** `persistBuffer` previously ran only on tab/workspace detach, so the read-only restore of a full-screen TUI (Claude Code, vim, less — which render into xterm's alternate buffer) came back blank: the only snapshot predated the alt-screen. `terminal-runtime-registry.ts` now calls `persistAll()` on `pagehide` and on `visibilitychange`→hidden, serializing every live runtime (the serialize addon already includes the alternate buffer) plus its dimensions, so the read-only tombstone shows the actual last on-screen frame. Graceful quit/app-switch is covered; a hard force-kill falls back to the last hidden-state snapshot (a debounced-on-output persist would close that gap if it ever matters).
