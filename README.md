# superset-pwsh - superset-sh for windows

Yet another unofficial native-Windows fork of [Superset](https://github.com/superset-sh/superset).

This should serve as a stop-gap until superset-sh officially adds support for Windows. 

Every Windows-specific change (and the handful of unrelated bug fixes/features)
is catalogued in [`docs/windows-port-patch-list.md`](docs/windows-port-patch-list.md).

## Dependencies

### To run

- **PowerShell 7** - this fork uses PowerShell 7 (`pwsh`) instead of `cmd`
  ([install guide](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-windows?view=powershell-7.6)).
  - Only the **Store/MSIX package** version has been tested.

### To develop

- [Bun](https://bun.sh/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Caddy](https://caddyserver.com/docs/install)
- Git for Windows (2.20+)
- [GitHub CLI (`gh`)](https://cli.github.com/)

### To build the desktop app

- Visual Studio Build Tools 2022
- MSVC v143 C++ x64/x86 compiler tools
- MSVC v143 C++ x64/x86 Spectre-mitigated libraries
- Windows 10 or 11 SDK

## Running Dev Mode

Start Docker Desktop first.

**Setup**
```powershell
bun ./.superset/setup.local.ts
```
- runs `bun install` for you
- starts the Docker stack (Postgres + Electric) and seeds a dev account

**Teardown**
```powershell
bun ./.superset/teardown.local.ts
```
- only run when you want a fresh database when developing locally

**Run** (with hot reload)
```powershell
bun run dev:desktop
```

For the upstream contributor guide for more info:
[`DEVELOPMENT.md`](DEVELOPMENT.md) (its `.sh` setup steps are Unix-only; on
Windows use the `.ts` flow above). Repo structure and DB/migration conventions
are in [`AGENTS.md`](AGENTS.md).

## Claude Status notifications (recommended)

The desktop app skips auto-registering its Claude Code notify hooks on Windows
(see W11 in the patch list), so Claude Code session/tool activity won't surface
as notifications by default. To wire them up, run:

```powershell
pwsh scripts/windows/setup-claude-notify.ps1
```

This installs `~/.claude/hooks/superset-notify.sh` (bridges Claude Code events
into Superset; needs `bash` on PATH from Git for Windows) and merges the hook
entries that call it into `~/.claude/settings.json`. Idempotent; backs up
`settings.json` first, and manages only the bridge entries — every other hook
and setting is left untouched.

## Building

```powershell
bun i
bun run --cwd apps/desktop build --win --x64
```

Installer output:
```txt
superset\apps\desktop\release
```

## License & attribution

This is a modified build of [Superset](https://github.com/superset-sh/superset)
with native Windows x64 support. Not affiliated with or endorsed by Superset,
Inc. Licensed under the Elastic License 2.0 (see [`LICENSE.md`](LICENSE.md)).