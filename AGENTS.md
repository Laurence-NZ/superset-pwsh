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

## CDP UI Verification

When a user asks for UI verification through the Chrome DevTools Protocol (CDP):

1. **Target the correct app instance** - confirm and report the worktree, renderer URL/port, and active route before testing. Follow any task-provided CDP/auth guidance and verify the expected signed-in session. Do not treat a different running desktop instance as equivalent.
2. **Reproduce the exact user journey** - use real browser input and visible UI navigation for the steps the user performs. Directly assigning DOM properties, invoking internal app APIs, or running component-only scripts is diagnostic support, not proof of end-to-end behavior.
3. **Capture visual and numeric evidence** - take before/after screenshots and pair them with relevant CDP measurements (for example, `scrollTop`, focused element, route, or persisted state). Confirm that the screenshot and measured state agree.
4. **Exercise the relevant lifecycle** - include the actual route change, workspace/pane/file switch, remount, close/reopen, or other teardown boundary from the report. A narrower synthetic flow cannot substitute for the reported interaction.
5. **Treat a mismatch as an incomplete reproduction** - if the test passes but the user still observes the bug, re-check the target instance, exact steps, input method, persisted keys, and lifecycle timing. Reproduce the failure before changing code; do not assume the report is disproven by a synthetic smoke test.
6. **Use an evidence gate** - for a reported bug or regression, do not claim it is verified until the original interaction demonstrably fails before the fix and passes after it under the same observations. For a new feature, record equivalent baseline evidence and demonstrate the expected behavior. In all cases, state clearly which checks were end-to-end, which were synthetic, and whether screenshots were actually captured.

## CLI End-to-End Verification

Run cross-process agent-session coverage with `bun run test:cli-e2e`; it uses an
isolated home and a production-ABI PTY daemon. When the acceptance criterion
includes the real desktop UI, follow `apps/desktop/docs/CLI_CDP_E2E.md` and
preserve CLI output separately from genuine CDP screenshot evidence.

## Agent Rules
1. **Type safety** - avoid `any` unless necessary
2. **Prefer `gh` CLI** - when performing git operations (PRs, issues, checkout, etc.), prefer the GitHub CLI (`gh`) over raw `git` commands where possible
3. **Shared command and skill source** - keep command definitions in `.agents/commands/` and skill definitions in `.agents/skills/`. `.claude/commands` and `.cursor/commands` should be symlinks to `../.agents/commands`; `.claude/skills` should be a symlink to `../.agents/skills`. (`packages/chat` discovers slash commands from `.claude/commands`.) Skills aren't a cross-agent format yet, so non-Claude agents (Codex, Cursor, OpenCode) should read the relevant `.agents/skills/*/SKILL.md` file directly when its description matches the task.
4. **Workspace MCP config** - keep shared MCP servers in `.mcp.json`; `.cursor/mcp.json` should link to `../.mcp.json`. Codex uses `.codex/config.toml` (run with `CODEX_HOME=.codex codex ...`). OpenCode uses `opencode.json` and should mirror the same MCP set using OpenCode's `remote`/`local` schema.

   > **Mistral Vibe compatibility**: Vibe reads `AGENTS.md` + `.agents/skills/` natively (trust granted via `--trust`; no `.agents/commands` support). Configure it via `.vibe/config.toml`; it consumes MCP servers as `[[mcp_servers]]` TOML entries (not `.mcp.json`).

   > **Kimi Code compatibility**: Kimi reads `AGENTS.md` + `.agents/skills/` natively. It does not discover `.agents/commands`; configure it through `~/.kimi-code/config.toml` or `KIMI_CODE_HOME`.

5. **Mastra dependencies** - use the published upstream `mastracode` and `@mastra/*` packages. Do not add fork tarball overrides or custom patch steps unless explicitly requested.
6. **Plan & doc placement** - implementation plans go in `plans/` (cross-cutting) or `apps/<app>/plans/` (app-scoped); shipped plans move to `plans/done/`. Architecture/reference docs go in `<app>/docs/`. Never drop `*_PLAN.md` at an app root or inside `src/`.
7. **Always fix lint warnings before pushing** - CI fails on Biome warnings, not just errors (the lint script treats warnings as errors). Run `bun run lint:fix` after edits and verify `bun run lint` exits 0 before `git push`. Never push code that produces lint output, even auto-fixable formatting.
8. **Linear ticket format** - all tickets (creation, drafting, grooming) follow `.agents/skills/ticket-format/SKILL.md`. Read that file before creating or grooming a ticket.
9. **TanStack DB / Electric live queries are cache-first** - `useLiveQuery` can return persisted rows in `data` while the collection is still not `isReady`. Always render existing rows first. Use `isReady` only to decide what to show when no row/data exists yet: no data + not ready = loading/skeleton/null; no data + ready = empty/not-found. Never hide, blank, or replace existing `data` just because `isReady` is false or `isLoading` is true. This cache-first rendering rule does not apply to write/seeding side effects: wait for strict readiness before deriving missing rows or writing defaults, unless the write is provably idempotent.
10. **PR titles are conventional commits** - PRs are squash-merged using the PR title as the commit subject, so every title needs a conventional-commit type and scope, e.g. `feat(desktop): add copy-logs button to failed CI checks` or `fix(host-service): guard against missing PR`.
11. **Mobile is iOS-only for the time being** - `apps/mobile` targets iOS only. Don't add Android fallbacks or platform guards for iOS-only APIs (e.g. `@expo/ui/swift-ui`), and don't treat Android incompatibility as a blocker until Android is explicitly put in scope.

---

## Windows port (this branch)

This branch adds native Windows x64 desktop support on top of `main` and periodically merges `main` back in. Those merges bring upstream refactors that need Windows re-adaptation.

- **Pushed to a personal fork, never PR'd upstream.** A stopgap for running Superset on Windows via `bun run dev:desktop` until upstream ships real native Windows support. The branch is pushed to `fork` (`Laurence-NZ/superset-pwsh`, a public fork) for backup/sync only — `git push`/`git pull` on this branch go there. `origin` stays pointed at upstream (`superset-sh/superset`) so `/merge-upstream` pulls `origin/main` from it. Never open a PR against upstream. So commit hygiene is for readability, not review — don't gate work on push-only concerns.
- **v2 mode only.** This fork is built and tested exclusively in Superset **v2** — the ground-up rebuild of the desktop shell (from-scratch terminal, IDE-like Tab/Split/Pane layout, file tree, editor, diff viewer), not merely a cloud feature. v1 is the legacy chat-first UX; both ship in the same binary and a per-user opt-in picks which renders (dev defaults to v2). Every Windows patch targets v2's terminal/agent/workspace paths — **v1 is untested on Windows.** Don't spend effort making v1 paths work on Windows, or treat v1 breakage as a blocker, unless explicitly asked.
  - **v1 and v2 are parallel renderer trees with colliding component names — edit the v2 one.** v2 renderer UI lives under `apps/desktop/src/renderer/routes/_authenticated/**` (the dashboard shell under `_dashboard/`); the legacy v1 UX lives under `renderer/screens/main/**`. The same feature exists in both under near-identical names — e.g. the project row with the "new workspace" `+`: v1 `screens/main/components/WorkspaceSidebar/ProjectSection/ProjectHeader.tsx`, v2 `_dashboard/components/DashboardSidebar/components/DashboardSidebarProjectSection/…/DashboardSidebarProjectRow.tsx`. A grep for the obvious name (`WorkspaceSidebar`, `ProjectSection`) lands in v1, and editing it changes nothing the user sees. Before touching any renderer UI, confirm which component actually renders — prefer the `Dashboard*` / `_dashboard` variant, and if unsure verify over CDP.
- **Every commit this branch adds on top of `main` gets an entry in `docs/windows-port-patch-list.md`** — no exceptions. Windows-support work goes in §1; **any other bug fix or feature goes in §2, including general bugs that aren't Windows-specific** (§2 is exactly for those — e.g. the commits-to-pull badge). "This isn't a Windows patch" is never a reason to skip the list: an unlisted commit is silently lost or reverted on the next `main` merge. Each entry carries its commit, override policy, invariant, files, and a scan signature. `/merge-upstream` walks it after every merge; the foundational port's granular changelog is archived in `docs/existing-windows-fork-patches.md`. **Don't restate patch detail here — add or edit entries in the patch list so the two never drift.**
- **Structure a merge as one merge commit + separate follow-up commits** for each Windows adaptation, so the integration and the Windows work review apart.
- **Run `bun run typecheck` after resolving conflicts.** Upstream frequently changes a shared helper's signature (e.g. `resolveScript`, `writeTempAskpass`) that the Windows layer builds on; git auto-merges the text but the types break with no conflict marker. `bun run lint` must exit 0 too before pushing.
- **biome `lineEnding` stays `lf`, never `auto`.** On Windows `auto` resolves to CRLF, so biome wants to rewrite every LF file — `bun run lint` fails locally and `lint:fix` would corrupt the whole tree (CI is Linux/LF).
- **Cross-platform lifecycle scripts:** `resolveScript` (`packages/host-service/src/runtime/setup/config.ts`) is platform-aware and resolves `.ts/.cmd/.bat/.ps1/.sh`; the shell invocation strings are built in `setup-terminal.ts` / `teardown.ts`. Windows shell + notify-hook branching lives in shared helpers (`@superset/shared/shell`, `getManagedNotifyHookCommand`) — extend those, not the callers.
- **`.git/index.lock` recurs** when an IDE git watcher races a command: if git reports the lock exists, delete `.git/index.lock` and retry.

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
