# Superset Monorepo Guide

You're running inside a Superset workspace — an isolated git-worktree copy of this repo. "Workspace" in any user message refers to this, not VS Code/editor workspaces.

## Question Tool

When you need to ask the user ANY question — including simple yes/no, confirmations, and clarifications — ALWAYS use the `ask_user` tool. Never ask questions in plain text. The Superset UI renders `ask_user` calls as an interactive overlay with clickable option buttons; plain-text questions will not be surfaced to the user in the same way.

Guidelines for agents and developers working in this repository.

## Structure

Bun + Turbo monorepo: `apps/` (web, marketing, admin, api, desktop, docs, mobile) and `packages/` — see `ls apps/ packages/` for the full list.
- Add shadcn components: `npx shadcn@latest add <component>` (run in `packages/ui/`)

## Tech Stack

- **Package Manager**: Bun (no npm/yarn/pnpm)
- **Next.js**: Version 16 - NEVER create `middleware.ts`. Next.js 16 renamed middleware to `proxy.ts`. Always use `proxy.ts` for request interception.

## Common Commands

Standard scripts live in the root `package.json` (`bun dev`, `bun test`, `bun run lint:fix`, `bun run typecheck`, ...).

```bash
# Releases (desktop + host-service + cli share one version; see scripts/release/README.md)
bun run release            # interactive: desktop release or CLI hotfix
bun run release desktop    # desktop app release (draft by default)
bun run release cli        # interim CLI hotfix (<desktop>-N prerelease)
bun run check:versions     # assert versions are unified
```

Cut releases on a dedicated release branch (not `main`); `bun run release desktop
<version> <commit>` provisions one from a commit. Full runbook: `scripts/release/README.md`.

## Code Quality

**Biome runs at root level** (not per-package) for speed — use `bun run lint:fix` to fix all issues automatically.

## Agent Rules
1. **Type safety** - avoid `any` unless necessary
2. **Prefer `gh` CLI** - when performing git operations (PRs, issues, checkout, etc.), prefer the GitHub CLI (`gh`) over raw `git` commands where possible
3. **Shared command and skill source** - keep command definitions in `.agents/commands/` and skill definitions in `.agents/skills/`. `.claude/commands` and `.cursor/commands` should be symlinks to `../.agents/commands`; `.claude/skills` should be a symlink to `../.agents/skills`. (`packages/chat` discovers slash commands from `.claude/commands`.) Skills aren't a cross-agent format yet, so non-Claude agents (Codex, Cursor, OpenCode) should read the relevant `.agents/skills/*/SKILL.md` file directly when its description matches the task.
4. **Workspace MCP config** - keep shared MCP servers in `.mcp.json`; `.cursor/mcp.json` should link to `../.mcp.json`. Codex uses `.codex/config.toml` (run with `CODEX_HOME=.codex codex ...`). OpenCode uses `opencode.json` and should mirror the same MCP set using OpenCode's `remote`/`local` schema.

   > **Mistral Vibe compatibility**: Vibe reads `AGENTS.md` + `.agents/skills/` natively (trust granted via `--trust`; no `.agents/commands` support). Configure it via `.vibe/config.toml`; it consumes MCP servers as `[[mcp_servers]]` TOML entries (not `.mcp.json`).

5. **Mastra dependencies** - use the published upstream `mastracode` and `@mastra/*` packages. Do not add fork tarball overrides or custom patch steps unless explicitly requested.
6. **Plan & doc placement** - implementation plans go in `plans/` (cross-cutting) or `apps/<app>/plans/` (app-scoped); shipped plans move to `plans/done/`. Architecture/reference docs go in `<app>/docs/`. Never drop `*_PLAN.md` at an app root or inside `src/`.
7. **Always fix lint warnings before pushing** - CI fails on Biome warnings, not just errors (the lint script treats warnings as errors). Run `bun run lint:fix` after edits and verify `bun run lint` exits 0 before `git push`. Never push code that produces lint output, even auto-fixable formatting.
8. **Linear ticket format** - all tickets (creation, drafting, grooming) follow `.agents/skills/ticket-format/SKILL.md`. Read that file before creating or grooming a ticket.
9. **TanStack DB / Electric live queries are cache-first** - `useLiveQuery` can return persisted rows in `data` while the collection is still not `isReady`. Always render existing rows first. Use `isReady` only to decide what to show when no row/data exists yet: no data + not ready = loading/skeleton/null; no data + ready = empty/not-found. Never hide, blank, or replace existing `data` just because `isReady` is false or `isLoading` is true. This cache-first rendering rule does not apply to write/seeding side effects: wait for strict readiness before deriving missing rows or writing defaults, unless the write is provably idempotent.
10. **PR titles are conventional commits** - PRs are squash-merged using the PR title as the commit subject, so every title needs a conventional-commit type and scope, e.g. `feat(desktop): add copy-logs button to failed CI checks` or `fix(host-service): guard against missing PR`.
11. **Mobile is iOS-only for the time being** - `apps/mobile` targets iOS only. Don't add Android fallbacks or platform guards for iOS-only APIs (e.g. `@expo/ui/swift-ui`), and don't treat Android incompatibility as a blocker until Android is explicitly put in scope.
12. **V2 terminal-preset descriptions are seeded-once, not live** - a `V2TerminalPresetRow.description` is copied from the builtin agent (`BUILTIN_TERMINAL_AGENTS` in `packages/shared/src/builtin-terminal-agents.ts`) at seed time (`createDefaultV2TerminalPresetRows`, guarded by `if (existingPresets.length > 0) return []`) and has no edit UI, so the stored value goes stale forever. Editing the builtin description only affects fresh seeds. Display code must resolve the description live from the agent (`getPresetById(agent.presetId)?.description`), not read the stored row — see `V2PresetBarItem.tsx`. Same applies to any other field a preset caches from its agent.


---

## Windows port (this branch)

This branch adds native Windows x64 desktop support on top of `main` and periodically merges `main` back in. Those merges bring upstream refactors that need Windows re-adaptation.

- **Local-only branch — never pushed.** A stopgap for running Superset on Windows via `bun run dev:desktop` until upstream ships real native Windows support. No PRs, no remote pushes; commit locally and stop. So commit hygiene is for readability, not review — don't gate work on push-only concerns.
- **Applied Windows runtime fixes** (adapted from `docs/superset-windows-PATCHES.md`, a vendored copy of the `superset-windows` repo's patch set): V2 terminals default to PowerShell 7 (`packages/host-service/src/terminal/user-shell.ts`), `&&` preserved in V2 agent launch commands, and Windows ringtone preview via WPF MediaPlayer. Untested candidate patches for future symptoms: `docs/windows-port-remaining-patches.md`.
- **V2 terminal env is built by `buildV2TerminalEnv` (`packages/host-service/src/terminal/env.ts`)**, from a host-service `process.env` snapshot (Windows skips the POSIX login-shell probe). It backfills `PATHEXT` + Windows system vars — without `PATHEXT`, PowerShell/`where.exe` can't map a bare name (`git`) to `git.exe`, so *nothing* on PATH resolves even though PATH is correct and the `.exe`s exist. Symptom to recognise: every bare command "not recognized", but `& 'full\path.exe'` and `Test-Path` work. The env snapshot is captured at host-service startup, so env changes need a full `dev:desktop` restart, not a new terminal tab.
- **Store/MSIX pwsh is discovered via its WindowsApps App Execution Alias** (`discoverPwsh7` in `packages/host-service/src/terminal/user-shell.ts`). When pwsh 7 is installed only as a Store/MSIX package (no `C:\Program Files\PowerShell\7`), it's exposed on PATH by an `%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe` App Execution Alias — an `APPEXECLINK` reparse point that `fs.existsSync()` reports **false** on even though `execFileSync` runs it, and whose `WindowsApps` package dir throws `EPERM` on `readdirSync`. Discovery adds that alias as an explicit candidate and, for any candidate in a `WindowsApps` dir, version-probes it directly instead of stat-gating (`pwshMajorVersion` returns 0 on failure, so a bogus path is still rejected). Symptom to recognise: the packaged/installed app opens `cmd.exe` terminals while `bun run dev:desktop` opens pwsh — dev inherits the launching pwsh terminal's PATH (which includes the real versioned `WindowsApps\Microsoft.PowerShell_…` dir, where `existsSync` is true), the Explorer-launched build only gets the alias dir.
- **`@parcel/watcher` is pinned to the `windows` backend** on win32 (`packages/workspace-fs/src/watch.ts`, in the `subscribe` options). Left to auto-select, it probes for watchman from *native* C++ (`WatchmanBackend.cc`) by spawning `cmd /c watchman --output-encoding=bser get-sockname`; with watchman absent that console process flashes a window and **steals foreground focus** on every workspace watch start. The spawn is native, so no JS `windowsHide` / `child_process` monkey-patch can hide it — forcing the backend is the only fix. Symptom to recognise: a `cmd.exe` window flashes on app/workspace open, exiting code 1 with no visible output (its bser output is binary).
- **Stale `active` terminal sessions accumulate on Windows** because the detached pty-daemon dies with the app, so a terminal's `onExit` (which flips its `terminal_sessions` row to `exited`) is never delivered, and the reaper only visits sessions the daemon still lists. Host-service startup now sweeps all `active` rows to `exited` on win32 (`packages/host-service/src/app.ts`, before `deleteDefunct()`) — safe because no pty survives an app restart. Without it, each dead row keeps its agent binding live-joined and the workspace-agents sidebar stacks a phantom "Claude" chip per relaunch (chips render only when ≥2 agents, so the symptom is "two Claude icons for one instance"). Same fixes any "sessions from days ago still `active`".
- **Windows Ctrl+Left/Right word-jump uses VT sequences, not emacs ESC+b/f** (`apps/desktop/src/renderer/lib/terminal/line-edit-translations.ts`). PSReadLine's default (Windows) edit mode binds word-jump to Ctrl+arrow and expects `\x1b[1;5D`/`\x1b[1;5C`; the emacs `\x1bb`/`\x1bf` form (still correct for the Mac Alt branch) is unbound there, so PSReadLine drops the ESC and inserts a literal "b"/"f". Symptom to recognise: Ctrl+Left prints `b`, Ctrl+Right prints `f` in a pwsh 7 terminal instead of jumping by word.
- **Programmatic command launches end in a bare CR for PowerShell, not CRLF** (`getShellLineEnding` in `packages/shared/src/shell.ts`). PSReadLine accepts the line on the CR, then treats the trailing LF of a CRLF as a fresh keystroke — leaving a `>>` continuation prompt on the next line after the launched command runs. A lone CR is what the Enter key actually sends. This covers any launch routed through `appendShellLineEnding` (`queueInitialCommand` for terminal-preset/agent-button `initialCommand`, and `writeCommands`). Symptom to recognise: after a terminal preset (e.g. one that just runs `clear`) or agent button launches, the shell strands a `>>` you must clear before typing. cmd.exe tolerates CRLF, so it's left as-is. Separately, the renderer's shell-agnostic `normalizeTerminalCommand` still appends a bare LF (used by the sequential-into-active-terminal `writeInput` path) — harmless on POSIX but a no-op accept on pwsh; give it shell awareness if that path is exercised on Windows.
- **V2 agent launch commands are quoted for the target shell** (`buildArgvCommand` / `envOverlayPrefix` in `packages/shared/src/agent-prompt-launch.ts`, shell threaded from `runTerminalAgent` → `buildAgentCommandString`). POSIX single-quoting (`'claude' 'build a boat'`) is a PowerShell `ParserError`: pwsh reads a leading quoted string as an expression and rejects the following token. For pwsh the builder leaves bare command names/flags/paths unquoted (`claude 'build a boat'`), adds the `&` call operator only when the command name itself is quoted (e.g. a path with spaces), escapes single quotes as `''`, and emits `$env:KEY=…` overlays instead of the POSIX `KEY=value cmd` form. Multiline prompts render as a **one-line** double-quoted string with `` `n ``/`` `" ``/`` `$ `` escapes — a single-quoted literal embeds raw LF bytes that PSReadLine reads as a line-accept when the command is typed in, truncating the prompt at the first newline (same PSReadLine-keystroke root cause as the CR/LF note above). Known gaps (still POSIX-only, add if exercised on Windows): stdin-transport agents still emit a heredoc (only argv agents like claude are wired for pwsh), cmd.exe isn't handled, and `buildHostAgentLaunchCommand` in `apps/web` passes no shell.
- **Structure a merge as one merge commit + separate follow-up commits** for each Windows adaptation, so the integration and the Windows work review apart.
- **Run `bun run typecheck` after resolving conflicts.** Upstream frequently changes a shared helper's signature (e.g. `resolveScript`, `writeTempAskpass`) that the Windows layer builds on; git auto-merges the text but the types break with no conflict marker. `bun run lint` must exit 0 too before pushing.
- **biome `lineEnding` stays `lf`, never `auto`.** On Windows `auto` resolves to CRLF, so biome wants to rewrite every LF file — `bun run lint` fails locally and `lint:fix` would corrupt the whole tree (CI is Linux/LF).
- **Cross-platform lifecycle scripts:** `resolveScript` (`packages/host-service/src/runtime/setup/config.ts`) is platform-aware and resolves `.ts/.cmd/.bat/.ps1/.sh`; the shell invocation strings are built in `setup-terminal.ts` / `teardown.ts`. Windows shell + notify-hook branching lives in shared helpers (`@superset/shared/shell`, `getManagedNotifyHookCommand`) — extend those, not the callers.
- **Agent global-dotfile hook injectors are no-ops on win32** — `createClaudeSettingsJson`, `createCodexHooksJson` (both in `apps/desktop/src/main/lib/agent-setup/agent-wrappers-claude-codex-opencode.ts`), `createCursorHooksJson`, `createGeminiSettingsJson`, and `createPiExtension`. Each merges Superset-managed hooks into a user dotfile (`~/.claude`, `~/.codex`, `~/.cursor`, `~/.gemini`, `~/.pi`) on every launch. On Windows cursor/gemini emit a bare POSIX `.sh` command with no `.cmd` equivalent (can't run), and all of them churn a dotfile the user may track in git. Claude/Codex are the exception where the command *is* Windows-adapted (`getManagedNotifyHookCommand` / `buildNotifyHookCommand` → `notify.cmd`), but they're skipped anyway because the user wires their own per-agent hooks (Claude: `bash superset-notify.sh` → `$SUPERSET_HOME_DIR/hooks/notify.sh`; Cursor: `cursor-hook.ps1`). The paired `create*HookScript` / `createNotifyScript` writers still run, so the `SUPERSET_HOME_DIR/hooks/*.sh` scripts the user's own hooks call are still present. Each guard is commented with how to re-enable per agent (give it a platform-aware command + `.cmd` entrypoint). Symptom the skips remove: those dotfiles regrow Superset hook blocks on every app launch. Droid/mastra/vibe/amp share the same latent bare-`.sh` bug but aren't guarded (unused).
- **`native-keymap` patch is required** (`patches/native-keymap@3.3.9.patch` + `patchedDependencies`) for the Windows native rebuild; keep it unless upstream bumps native-keymap.
- **`.git/index.lock` recurs** when an IDE git watcher races a command: if git reports the lock exists, delete `.git/index.lock` and retry.
- **Stopgap "commits to pull" (↓N) badge in the v2 sidebar — DELETE ON MERGE when upstream ships a real ahead/behind indicator.** Three coupled pieces: the `git.getCommitsToPull` host-service procedure (`packages/host-service/src/trpc/router/git/git.ts`), the `useCommitsToPull` renderer hook (`apps/desktop/src/renderer/hooks/host-service/useCommitsToPull/`), and the badge JSX in `DashboardSidebarExpandedWorkspaceRow.tsx`. Each carries a `STOPGAP … DELETE ON MERGE` banner. It's deliberately a *separate* procedure (not folded into `getBranchSyncStatus`, which the PR flow shares) so it reverts cleanly. The procedure reads `@{upstream}...HEAD` for the count and fire-and-forgets `scheduleBaseRefFetch` to keep the ref fresh; the hook polls every 2 min. `getBranchSyncStatus.pullCount` already exists upstream — prefer wiring the sidebar to that (plus a fetch) over keeping this, if the real feature doesn't materialise.
- Conflict-hotspot map and full validation matrix: `docs/windows-port-audit.md`.

---

## Project Structure

All projects in this repo should be structured like this:

```
app/
├── page.tsx
├── dashboard/
│   ├── page.tsx
│   ├── components/
│   │   └── MetricsChart/
│   │       ├── MetricsChart.tsx
│   │       ├── MetricsChart.test.tsx      # Tests co-located
│   │       ├── index.ts
│   │       └── constants.ts
│   ├── hooks/                             # Hooks used only in dashboard
│   │   └── useMetrics/
│   │       ├── useMetrics.ts
│   │       ├── useMetrics.test.ts
│   │       └── index.ts
│   ├── utils/                             # Utils used only in dashboard
│   │   └── formatData/
│   │       ├── formatData.ts
│   │       ├── formatData.test.ts
│   │       └── index.ts
│   ├── stores/                            # Stores used only in dashboard
│   │   └── dashboardStore/
│   │       ├── dashboardStore.ts
│   │       └── index.ts
│   └── providers/                         # Providers for dashboard context
│       └── DashboardProvider/
│           ├── DashboardProvider.tsx
│           └── index.ts
└── components/
    ├── Sidebar/
    │   ├── Sidebar.tsx
    │   ├── Sidebar.test.tsx               # Tests co-located
    │   ├── index.ts
    │   ├── components/                    # Used 2+ times IN Sidebar
    │   │   └── SidebarButton/             # Shared by SidebarNav + SidebarFooter
    │   │       ├── SidebarButton.tsx
    │   │       ├── SidebarButton.test.tsx
    │   │       └── index.ts
    │   ├── SidebarNav/
    │   │   ├── SidebarNav.tsx
    │   │   └── index.ts
    │   └── SidebarFooter/
    │       ├── SidebarFooter.tsx
    │       └── index.ts
    └── HeroSection/
        ├── HeroSection.tsx
        ├── HeroSection.test.tsx           # Tests co-located
        ├── index.ts
        └── components/                    # Used ONLY by HeroSection
            └── HeroCanvas/
                ├── HeroCanvas.tsx
                ├── HeroCanvas.test.tsx
                ├── HeroCanvas.stories.tsx
                ├── index.ts
                └── config.ts

components/                                # Used in 2+ pages (last resort)
└── Header/
```

1. **One folder per component**: `ComponentName/ComponentName.tsx` + `index.ts` for barrel export
2. **Co-locate by usage**: If used once, nest under parent's `components/`. If used 2+ times, promote to **highest shared parent's** `components/` (or `components/` as last resort)
3. **One component per file**: No multi-component files
4. **Co-locate dependencies**: Utils, hooks, constants, config, tests, stories live next to the file using them

### Exception: shadcn/ui Components

The `src/components/ui/` and `src/components/ai-elements` directories contain shadcn/ui components. These use **kebab-case single files** (e.g., `button.tsx`, `base-node.tsx`) instead of the folder structure above. This is intentional—shadcn CLI expects this format for updates via `bunx shadcn@latest add`.

## Database Rules

** IMPORTANT ** - Never touch the production database unless explicitly asked to. Even then, confirm with the user first.

- Schema in `packages/db/src/`
- Use Drizzle ORM for all database operations

## DB migrations
- Never run a migration yourself, and **NEVER manually edit files in `packages/db/drizzle/`** (`.sql` files, `meta/_journal.json`, snapshots — all auto-generated). Only modify schema files in `packages/db/src/schema/` and ask the user to run `drizzle-kit generate`.
- Workflow (Neon branch setup, drizzle-kit invocation): see `.agents/skills/db-migrations/SKILL.md`.
