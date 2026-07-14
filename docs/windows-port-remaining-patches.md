# Windows Port — Remaining Candidate Patches (untested)

Companion to `windows-port-audit.md`. These are Windows fixes from the
`superset-windows` `PATCHES.md` set that are **not yet applied on this branch**
and were **not verified as needed** — the user had not hit them at the time of
writing. Listed here so a future agent can apply one quickly if a symptom shows
up, without re-doing the whole PATCHES.md analysis.

Already-applied and obsolete/legacy patches are intentionally **excluded** (see
`windows-port-audit.md` for what's done). Applied on this branch already:
pwsh-7 default for V2 terminals (PATCHES 26/33), `&&` preservation in agent
launch commands (PATCHES 29), and Windows ringtone preview via WPF MediaPlayer
(PATCHES 31).

Each entry: symptom → target file → what the PATCHES.md patch does. Verify the
target still matches before applying — upstream refactors move things.

## Runtime gaps (dev + prod)

- **Console windows flash** (PATCHES 23) — black cmd/powershell windows flash on
  tab switch or spawn-heavy actions. A flash only happens when the *parent* is
  console-less (Electron main + host-service both launch with `windowsHide:
  true`); their unhidden console-subsystem children each get a fresh console
  window. So a plain CLI repro (`node repro.mjs` in a terminal) never shows it —
  the child inherits the terminal's console. Two confirmed unhidden sites were
  fixed directly with `{ windowsHide: true }`: `taskkill.exe` in
  `packages/host-service/src/ports/tree-kill.ts` + the desktop twin
  `apps/desktop/src/main/lib/tree-kill.ts` (fires on session/agent teardown), and
  `where.exe` in `apps/desktop/src/main/lib/agent-setup/utils.ts` (`findRealBinary`,
  fires on agent setup). Ruled out: `pidusage` (resource-metrics poll) — v4's
  `gwmi` backend already passes `windowsHide: true`. If flashes return from a
  *third* site, apply the full PATCHES 23 monkey-patch (global default +
  `SUPERSET_TRACE_SPAWN=1` tracer) to attribute it —
  `apps/desktop/src/main/lib/windows-child-process-patch.ts` +
  `installWindowsChildProcessPatch()` at the top of
  `apps/desktop/src/main/index.ts`.

- **Notification sound silent** (PATCHES 16) — agent-lifecycle notification
  sounds don't play. Target: `apps/desktop/src/main/lib/notification-sound.ts`
  (no Windows branch). PATCHES 16 plays via Chromium `Audio` in the renderer
  (`webContents.executeJavaScript`) and needs `media-src 'self' data:;` added to
  the CSP in `apps/desktop/src/renderer/index.html`. NOTE: the ringtone
  **preview** path (`play-sound.ts`) is already fixed via WPF MediaPlayer; this
  is the separate main-process notification path.

- **PTY env vars missing** (PATCHES 11) — `%SystemDrive%`-referencing tools
  (.NET/NuGet) create a literal `%SystemDrive%` dir; MSBuild loses parallelism
  hints. Target: `apps/desktop/src/main/lib/terminal/env.ts` `ALLOWED_ENV_VARS`
  — add `PROGRAMDATA`, `SYSTEMDRIVE`, `NUMBER_OF_PROCESSORS`,
  `PROCESSOR_ARCHITECTURE`. (This is the v1 desktop env allowlist; check whether
  the v2 host-service terminal env needs the same.)

- **Agent command typed but not executed** (PATCHES 15, renderer half) —
  `normalizeTerminalCommand` in
  `apps/desktop/src/renderer/lib/terminal/launch-command.ts` appends `\n`; Windows
  ConPTY wants `\r`. The host-service initial-command path already CRLFs, so
  **first trace whether this renderer path is even hit for V2 launches on
  Windows** before changing it — it may be dead on the V2 flow.

## V2 workspace/worktree behaviors

- **Random branch name from typed workspace name** (PATCHES 32) — typing only a
  workspace name (no prompt, no branch) yields a random `goofy-wax` branch.
  Target: `.../DashboardNewWorkspaceForm/PromptGroup/hooks/useSubmitWorkspace/resolveNames.ts`
  — when `workspaceNameEdited` and branch blank, derive the slug via
  `deriveWorkspaceBranchFromPrompt` from `@superset/shared/workspace-launch`.

- **Configured worktree base dir ignored (V2)** (PATCHES 27, partial) —
  `worktree-paths.ts` already threads a `worktreeBaseDir` param, but the
  `SUPERSET_WORKTREE_BASE_DIR` env plumbing from
  `apps/desktop/src/main/lib/host-service-coordinator.ts` `buildEnv()` (reading
  `settings.worktreeBaseDir` from `localDb`) and the restart-on-change in
  `settings/index.ts` are not in source. Verify whether the current param path
  is already wired end-to-end before adding env plumbing.

- **Repo-local `.superset` not copied into V2 worktrees** (PATCHES 28) —
  git-ignored `.superset` files don't reach new worktrees. Add
  `packages/host-service/src/trpc/router/workspace-creation/shared/project-superset-config.ts`
  with `copyProjectSupersetConfigToWorktree(repoPath, worktreePath)` (copy only
  when target `.superset` is absent) and call it from `workspaces.ts` after the
  workspace row is persisted.

## Cosmetic

- **Shortcut label shows `⌘` on Windows** (PATCHES 17) — `WorkspaceListItem.tsx`
  (~line 410) hardcodes `⌘{shortcutIndex + 1}`; on Windows the real binding is
  `Ctrl+Shift+{n}`. Gate on `useHotkeysStore(s => s.platform)`.

- **`defineEnv` uses `??` not `||`** (PATCHES 2, trivial) — `apps/desktop/vite/helpers.ts`
  `defineEnv` returns `value ?? fallback`; empty-string CI secrets should fall
  back to defaults (`value || fallback`). Prod/CI build concern, not dev.

## Packaging-only — apply ONLY if building a Windows installer

`dev:desktop` loads the Vite dev server over `http://localhost`, so these can't
affect dev; they matter for the packaged NSIS build (`file://` renderer):

- **PATCHES 5** — custom `superset-app://` protocol + CORS bypass (fixes broken
  ES-module dynamic imports over `file://` on Windows). `window-loader.ts` +
  `src/main/index.ts`.
- **PATCHES 2 (partial)** — `stripCrossOriginPlugin` + ELECTRON_RUN_AS_NODE
  banner in `electron.vite.config.ts` / `vite/helpers.ts`.
- **PATCHES 12** — NSIS installer config (this branch has its own
  electron-builder Windows setup; reconcile rather than paste).
- **PATCHES 14** — materialize `@lydell/node-pty-win32-x64` from the Bun store
  (only relevant if switching to `@lydell/node-pty`; this branch rebuilds
  `node-pty` natively instead).

Full patch text and rationale: `docs/superset-windows-PATCHES.md` (vendored
copy of the `superset-windows` repo's `PATCHES.md`).
