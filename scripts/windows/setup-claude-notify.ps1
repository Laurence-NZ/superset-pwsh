<#
.SYNOPSIS
  Wire up Superset status notifications for Claude Code on Windows.

.DESCRIPTION
  The desktop app skips auto-registering its Claude Code notify hooks on Windows
  (see W11 in docs/windows-port-patch-list.md). This script does the equivalent
  setup on demand:

    1. Writes ~/.claude/hooks/superset-notify.sh — bridges Claude Code hook
       payloads into Superset's own notify script ($SUPERSET_HOME_DIR/hooks/
       notify.sh), so session/tool activity shows up inside Superset. Requires
       bash on PATH (Git for Windows).
    2. Merges the hook entries (each calling the bridge) into
       ~/.claude/settings.json.

  Idempotent: re-running removes any prior copy of this hook and re-adds it.
  Only the superset-notify.sh entries are managed — every other hook and
  setting (including any notify.ps1 toasts you wire up yourself) is left
  untouched. The bridge stays inert until the desktop app has run once (which
  writes the notify.sh it calls), so run this before or after first launch.

.PARAMETER DryRun
  Print the merged settings.json to stdout and exit without writing anything.

.EXAMPLE
  pwsh scripts/windows/setup-claude-notify.ps1
#>
[CmdletBinding()]
param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$claudeDir    = Join-Path $HOME ".claude"
$hooksDir     = Join-Path $claudeDir "hooks"
$settingsPath = Join-Path $claudeDir "settings.json"

# --- hook script content (literal here-string; no PowerShell interpolation) ---

$supersetNotifyShContent = @'
#!/bin/bash
# Bridges Claude Code hook payloads into Superset's own notify script so
# session/tool activity shows up inside Superset. Installed by
# scripts/windows/setup-claude-notify.ps1.
payload=$(cat)

# Skip the duplicate Stop that fires while a background *subagent* re-wakes the
# turn (Claude follows with a second Stop carrying the real answer). Background
# shells (dev servers, type "shell") run indefinitely and must NOT suppress.
if printf '%s' "$payload" | jq -e '(.background_tasks // []) | any(.type == "subagent")' >/dev/null 2>&1; then
  exit 0
fi

if [ -n "$SUPERSET_HOME_DIR" ] && [ -x "$SUPERSET_HOME_DIR/hooks/notify.sh" ]; then
  SUPERSET_AGENT_ID=claude "$SUPERSET_HOME_DIR/hooks/notify.sh" <<<"$payload"
fi

exit 0
'@

# --- hook command written into settings.json ---------------------------------

$bridgeCmd = "bash ~/.claude/hooks/superset-notify.sh"

function New-Hook([string]$matcher = $null) {
  $def = @{ hooks = @(@{ type = "command"; command = $bridgeCmd; async = $true }) }
  if ($matcher) { $def.matcher = $matcher }
  return $def
}

# Managed hook definitions, keyed by event — all route to the Superset bridge.
$managed = [ordered]@{
  Notification       = @(New-Hook "permission_prompt")
  Stop               = @(New-Hook)
  StopFailure        = @(New-Hook)
  UserPromptSubmit   = @(New-Hook)
  PostToolUse        = @(New-Hook "*")
  PostToolUseFailure = @(New-Hook "*")
  PermissionRequest  = @(New-Hook "*")
  SessionStart       = @(New-Hook)
  SessionEnd         = @(New-Hook)
}

# --- merge into settings.json ------------------------------------------------

if (Test-Path $settingsPath) {
  $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json -AsHashtable
} else {
  $settings = @{}
}
if (-not ($settings -is [hashtable])) { throw "settings.json is not a JSON object" }
if (-not $settings.ContainsKey("hooks") -or -not ($settings.hooks -is [hashtable])) {
  $settings.hooks = @{}
}

# A definition is "ours" if any of its commands invoke superset-notify.sh —
# drop those before re-adding so re-runs don't duplicate. notify.ps1 and every
# other hook are left alone.
function Test-ManagedDef($def) {
  return (@($def.hooks | Where-Object { $_.command -match 'superset-notify\.sh' }).Count -gt 0)
}

foreach ($event in $managed.Keys) {
  $existing = @()
  if ($settings.hooks.ContainsKey($event)) {
    $existing = @($settings.hooks[$event] | Where-Object { -not (Test-ManagedDef $_) })
  }
  $settings.hooks[$event] = @($existing + $managed[$event])
}

$json = $settings | ConvertTo-Json -Depth 32

if ($DryRun) {
  Write-Output $json
  return
}

# --- write everything --------------------------------------------------------

New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null
# LF line endings for the bash script.
[System.IO.File]::WriteAllText((Join-Path $hooksDir "superset-notify.sh"), ($supersetNotifyShContent -replace "`r`n", "`n"))

if (Test-Path $settingsPath) {
  Copy-Item $settingsPath "$settingsPath.bak" -Force
}
Set-Content -Path $settingsPath -Value $json -Encoding utf8

Write-Host "Superset Claude notify bridge installed:" -ForegroundColor Green
Write-Host "  $(Join-Path $hooksDir 'superset-notify.sh')"
Write-Host "  merged into $settingsPath (backup: settings.json.bak)"
Write-Host "Restart any running Claude Code sessions to pick up the hooks."
