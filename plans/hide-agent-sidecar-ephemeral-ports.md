# Handoff: hiding an agent sidecar's ephemeral ports

## Problem

Opening a Claude Code session with the `open-claude-in-chrome` (OCIC) browser MCP
server adds **9 port chips** to the workspace ports sidebar. None of them is a
dev server; they are the internals of a `wrangler dev` sidecar that OCIC spawns
to back its `execute_code` sandbox. Two concurrent sessions means 18 chips.

F17 (`docs/windows-port-patch-list.md`) already hides OCIC's one fixed port,
`18765`, via `IGNORED_PORTS` in `packages/port-scanner/src/port-manager.ts:26`.
**That mechanism cannot be extended to these 9.** They are ephemeral.

## Why a port-number list can't work

8 of the 9 are OS-assigned: the sidecar binds port `0` and uses whatever the
kernel returns. Measured across two restarts of the same session:

| Role | Run 1 | Run 2 |
|---|---|---|
| MCP callback server | 53438 | 52438 |
| workerd entry socket | 53439 | 52667 |
| wrangler cli (×2) | 53460, 53463 | 52673, 52679 |
| workerd #2 (×3) | 53470–53473 | 52683, 52685, 52686 |

The 9th is the V8 inspector at `9229 + instance index` (observed 9229, 9230,
9231 with three sidecars live). Do **not** add 9229–9231 to `IGNORED_PORTS`:
9229 is Node's default `--inspect` port, so that would hide real debug sessions
— the exact failure mode F17's own **Scan for** clause warns about.

## The 9 ports and who owns them

One session's sidecar is 4 processes. Real command lines (Windows), which are
what any pattern must match:

```
pid 18320  node.exe     node D:\stash\open-claude-in-chrome\host\codemode\server-hybrid.js
pid 35152  node.exe     C:\nvm4w\nodejs\node.exe --no-warnings --experimental-vm-modules
                        D:\stash\open-claude-in-chrome\host\codemode\worker\node_modules\wrangler\wrangler-dist\cli.js
                        dev --port 52667 --ip 127.0.0.1
                        --persist-to C:\Users\...\Temp\oc-wrangler-hybrid-18320
pid 36400  workerd.exe  D:\stash\open-claude-in-chrome\host\codemode\worker\node_modules\
                        @cloudflare\workerd-windows-64\bin\workerd.exe serve --binary --experimental
                        --socket-addr=entry=127.0.0.1:52667 --external-addr=loopback=127.0.0.1:52673
pid 46124  workerd.exe  (same binary) serve ... --socket-addr=entry=127.0.0.1:0
                        --inspector-addr=localhost:0 --debug-port=127.0.0.1:0
```

Port → owner: callback→18320, entry+inspector→36400, 2 miniflare→35152,
3 proxy→46124.

Note every one of the four contains `open-claude-in-chrome\host\codemode` —
including both `workerd.exe`, because the binary itself lives under the repo's
`node_modules`. The `oc-wrangler-` persist-dir prefix is a second usable marker.

## Why `processName` is not enough

`PortInfo` is `{ port, pid, address, processName }`
(`packages/port-scanner/src/scanner.ts:52`). For these 9 ports `processName` is
only ever `node.exe` or `workerd.exe`:

- Excluding `node.exe` hides most dev servers in existence.
- Excluding `workerd.exe` hides a user's own `wrangler dev` — a legitimate dev
  server, and squarely the F17 anti-goal.

**The command line is the only precise discriminator, and it is not collected
today.** That is the core of the work.

## Code map (verified)

| Concern | Location |
|---|---|
| Port-number exclusion | `packages/port-scanner/src/port-manager.ts:26` (`IGNORED_PORTS`) |
| Where exclusion is applied | `packages/port-scanner/src/port-manager.ts:461` (`updatePortsForTerminal`) |
| `PortInfo` type | `packages/port-scanner/src/scanner.ts:52` |
| Windows port scan (netstat) | `scanner.ts:257` `getListeningPortsWindows` |
| Windows per-pid name lookup | `scanner.ts:344` `getProcessNameWindows` — **best extension point**, already runs in parallel for only the port-owning pids (`scanner.ts:293`) |
| Windows process table | `scanner.ts:64` — selects `ProcessId,ParentProcessId` only |
| POSIX port scan (lsof) | `scanner.ts:~195`; `processName` is lsof's `COMMAND` column, truncated, no args |
| POSIX process table | `pidtree(-1, { advanced: true })` at `scanner.ts:69` — `{pid, ppid}` only |
| Static per-worktree config | `packages/port-scanner/src/static-ports.ts` (labels only: `{port, label}`), loader at `apps/desktop/src/main/lib/static-ports/loader.ts` |
| Patch registry | `docs/windows-port-patch-list.md` (F17) |

## Candidate approaches

**A. Hardcoded cmdline pattern list.** Add `IGNORED_COMMAND_PATTERNS` next to
`IGNORED_PORTS`, filter alongside it at `port-manager.ts:461`. Smallest diff
(~15 lines + test). Same override-policy debt as F17: hardcoded knowledge of a
third-party tool.

**B. Config-driven exclusion.** Extend `.superset/ports.json` (and/or a global
setting) with an `ignore` array accepting port numbers *and* cmdline/process
patterns. This is literally what F17's override policy says it is waiting for
("prefer an upstream configurable port exclusion mechanism"), and lets `18765`
move out of the hardcoded set. Costs schema + validation work in
`static-ports.ts` (currently rejects any key other than `port`/`label`, and its
tests assert those errors) plus the loader/label-cache path.

**C. Ancestry-based.** Superset already builds process trees, so it could hide
ports whose owning process descends from a known MCP server process. Still needs
a cmdline to *identify* that ancestor, so it doesn't avoid the main cost — but it
would generalise to sidecars that spawn helpers with unrecognisable cmdlines.

**D. Ask OCIC to publish its own ports.** OCIC knows every port it opens and
could write a registry file for Superset to read. Cleanest attribution, but
couples two projects and only ever solves OCIC.

Worth deciding up front whether the target is "hide OCIC" or "hide agent-tooling
sidecars generally" — OCIC is likely the first of several MCP servers that spawn
port-opening sidecars, which argues for B.

## Constraints and anti-goals

- **Never hide a user's dev server.** Specifically: a real `wrangler dev` in a
  workspace must keep its chip, even though it is also `workerd.exe`.
- `CommandLine` is `null` on Windows for processes the caller can't open. Treat
  missing cmdline as "do not hide" — fail open, never hide unknown ports.
- Cost control: the Windows path already spawns one PowerShell per port-owning
  pid; fold cmdline into that existing call rather than adding a second, and do
  not widen `WINDOWS_PROCESS_TABLE_COMMAND` (it enumerates *every* process on a
  2.5s scan cadence — `SCAN_INTERVAL_MS`, `port-manager.ts:10`).
- Cross-platform: POSIX needs `ps -o args=` for the port-owning pids; lsof's
  `COMMAND` column is truncated and won't carry a path.
- Keep the F17 invariant intact — other ports opened by Claude or its children
  (a dev server an agent starts on your behalf) must still show.

## How to verify

Reproduce without touching OCIC by asserting on synthetic `PortInfo` rows in the
co-located tests (`port-manager.test.ts`, `scanner.test.ts`): a row with a
cmdline containing the marker is filtered; `workerd.exe` with an unrelated
cmdline is kept; a null/undefined cmdline is kept.

End-to-end on a machine with OCIC installed: the sidebar count for a session
with the browser MCP active should drop from 9 to 0, while a `wrangler dev`
started in the workspace still appears. Ground truth for the tree:

```powershell
$all = Get-CimInstance Win32_Process
$all | Where-Object { $_.CommandLine -like '*open-claude-in-chrome*' } |
  Select-Object ProcessId, Name, CommandLine
```

## Decisions needed

1. Approach A (hardcoded patterns) or B (configurable)? B matches F17's stated
   preferred direction; A is a much smaller change.
2. New registry entry (F18), or extend F17's **Invariant** / **Where** /
   **Scan for** to cover the cmdline mechanism? These share intent but differ in
   mechanism.
3. Scope: OCIC-specific, or a general "agent sidecar" exclusion?

## Provenance

Findings measured on Windows 11 (build 26100) against
`D:\stash\open-claude-in-chrome` @ `cda4c48` plus local uncommitted changes.
Port drift, command lines, and port→pid ownership were observed directly via
`netstat -ano` and `Get-CimInstance Win32_Process`. Superset line references were
read from the working tree; the POSIX scanning path was read but **not executed**
— confirm lsof/`ps` behaviour before relying on it.
