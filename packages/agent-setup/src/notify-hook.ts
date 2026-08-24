import fs from "node:fs";
import path from "node:path";
import { getTemplatePath, getV1NotificationsPort } from "./config";
import { getHooksDir } from "./paths";
import { writeFileIfChanged } from "./write-file-if-changed";

export const NOTIFY_SCRIPT_NAME = "notify.sh";
export const NOTIFY_SCRIPT_MARKER = "# Superset agent notification hook v9";
export const WINDOWS_NOTIFY_SCRIPT_NAME = "notify.cmd";
export const WINDOWS_NOTIFY_NODE_SCRIPT_NAME = "notify.mjs";
export const WINDOWS_NOTIFY_SCRIPT_MARKER =
	"rem Superset agent notification hook v9";

export function getNotifyScriptPath(
	platform: NodeJS.Platform = process.platform,
): string {
	return path.join(
		getHooksDir(),
		platform === "win32" ? WINDOWS_NOTIFY_SCRIPT_NAME : NOTIFY_SCRIPT_NAME,
	);
}

export function getNotifyNodeScriptPath(): string {
	return path.join(getHooksDir(), WINDOWS_NOTIFY_NODE_SCRIPT_NAME);
}

export function getNotifyScriptContent(): string {
	const template = fs.readFileSync(
		getTemplatePath("notify-hook.template.sh"),
		"utf-8",
	);
	return template
		.replaceAll("{{MARKER}}", NOTIFY_SCRIPT_MARKER)
		.replaceAll("{{DEFAULT_PORT}}", String(getV1NotificationsPort()));
}

function batchSetValue(value: string): string {
	return value.replaceAll("%", "%%").replaceAll("\r", "").replaceAll("\n", "");
}

export function getWindowsNotifyCommandScriptContent(
	bundledNodeRuntimePath: string = process.execPath,
): string {
	return `@echo off\r\n${WINDOWS_NOTIFY_SCRIPT_MARKER}\r\nsetlocal\r\nset "HOOK_DIR=%~dp0"\r\nset "NODE_EXE=${batchSetValue(bundledNodeRuntimePath)}"\r\nif defined SUPERSET_NOTIFY_NODE set "NODE_EXE=%SUPERSET_NOTIFY_NODE%"\r\nif not exist "%NODE_EXE%" if exist "%HOOK_DIR%..\\bin\\node.exe" set "NODE_EXE=%HOOK_DIR%..\\bin\\node.exe"\r\nif not exist "%NODE_EXE%" if exist "%HOOK_DIR%..\\lib\\node.exe" set "NODE_EXE=%HOOK_DIR%..\\lib\\node.exe"\r\nif not exist "%NODE_EXE%" for %%I in (node.exe) do set "NODE_EXE=%%~$PATH:I"\r\nif not exist "%NODE_EXE%" exit /b 0\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%NODE_EXE%" "%HOOK_DIR%${WINDOWS_NOTIFY_NODE_SCRIPT_NAME}" %*\r\nexit /b 0\r\n`;
}

export function getNotifyNodeScriptContent(): string {
	return `#!/usr/bin/env node
// ${NOTIFY_SCRIPT_MARKER}
import fs from "node:fs";
import path from "node:path";

const DEFAULT_PORT = ${JSON.stringify(String(getV1NotificationsPort()))};
const env = (name) => process.env[name] || "";
const truthy = (value) => /^(1|true|yes|on)$/i.test(value || "");
const debugEnabled = () => truthy(env("SUPERSET_DEBUG_HOOKS")) || env("SUPERSET_ENV") === "development" || env("NODE_ENV") === "development";
const debug = (message) => { if (debugEnabled()) console.error(message); };

async function readInput() {
  if (process.argv.length > 2) return process.argv.slice(2).join(" ");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function parsePayload(input) {
  try { return JSON.parse(input || "{}"); } catch { return null; }
}

function field(payload, names) {
  if (!payload || typeof payload !== "object") return "";
  for (const name of names) {
    const value = payload[name];
    if (value !== undefined && value !== null) return String(value);
  }
  return "";
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

function v1EventTypeFor(eventType) {
  if (["Attached", "attached", "SessionStart", "sessionStart", "session_start"].includes(eventType)) return "Start";
  if (["Detached", "detached", "SessionEnd", "sessionEnd", "session_end"].includes(eventType)) return "Stop";
  return eventType;
}

function manifestHookUrls() {
  const urls = [];
  const home = env("SUPERSET_HOME_DIR") || path.join(env("HOME") || env("USERPROFILE"), ".superset");
  const hostDir = path.join(home, "host");
  try {
    for (const entry of fs.readdirSync(hostDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(hostDir, entry.name, "manifest.json"), "utf8"));
        if (typeof manifest.endpoint === "string" && manifest.endpoint) urls.push(manifest.endpoint + "/trpc/notifications.hook");
      } catch {}
    }
  } catch {}
  return urls;
}

async function dispatchV2(eventType, sessionId) {
  if (!env("SUPERSET_TERMINAL_ID")) return false;
  const urls = [env("SUPERSET_HOST_AGENT_HOOK_URL"), ...manifestHookUrls()].filter(Boolean);
  const uniqueUrls = [...new Set(urls)];
  let delivered = false;
  const body = JSON.stringify({ json: { terminalId: env("SUPERSET_TERMINAL_ID"), eventType, agent: { agentId: env("SUPERSET_AGENT_ID"), sessionId } } });
  for (const url of uniqueUrls) {
    try {
      const response = await fetchWithTimeout(url, { method: "POST", headers: { "content-type": "application/json" }, body }, 5000);
      const responseText = await response.text();
      debug(\`[notify-hook] host-service dispatched status=\${response.status} url=\${url}\`);
      if (/"ignored"\\s*:\\s*false/.test(responseText)) return true;
      if (response.ok) delivered = true;
    } catch {}
  }
  return delivered;
}

async function main() {
  if (!env("SUPERSET_TERMINAL_ID") && !env("SUPERSET_TAB_ID")) return;
  const payload = parsePayload(await readInput());
  if (field(payload, ["agent_id"])) return;

  const hookSessionId = field(payload, ["session_id", "sessionId"]);
  const resourceId = field(payload, ["resourceId", "resource_id"]);
  const sessionId = resourceId || hookSessionId || field(payload, ["thread-id", "thread_id"]);
  let eventType = field(payload, ["hook_event_name", "hookEventName"]);
  if (!eventType) {
    const codexType = field(payload, ["type"]);
    if (["agent-turn-complete", "task_complete"].includes(codexType)) eventType = "Stop";
    else if (codexType === "task_started") eventType = "Start";
    else if (["exec_approval_request", "apply_patch_approval_request", "request_user_input"].includes(codexType)) eventType = "PermissionRequest";
  }
  if (eventType === "notification") {
    const notificationType = field(payload, ["notificationType"]);
    if (["permission_prompt", "elicitation_dialog"].includes(notificationType)) eventType = "PermissionRequest";
    else return;
  }
  if (eventType === "UserPromptSubmit") eventType = "Start";
  if (!eventType) return;

  debug(\`[notify-hook] event=\${eventType} terminalId=\${env("SUPERSET_TERMINAL_ID")} agentId=\${env("SUPERSET_AGENT_ID")} sessionId=\${sessionId}\`);
  if (await dispatchV2(eventType, sessionId)) return;
  if (!env("SUPERSET_TAB_ID") && !sessionId && !env("SUPERSET_TERMINAL_ID")) return;

  const params = new URLSearchParams({
    paneId: env("SUPERSET_PANE_ID"), tabId: env("SUPERSET_TAB_ID"), workspaceId: env("SUPERSET_WORKSPACE_ID"),
    terminalId: env("SUPERSET_TERMINAL_ID"), sessionId, hookSessionId, resourceId,
    eventType: v1EventTypeFor(eventType), rawEventType: eventType, agentId: env("SUPERSET_AGENT_ID"),
    env: env("SUPERSET_ENV"), version: env("SUPERSET_HOOK_VERSION"),
  });
  try {
    await fetchWithTimeout(\`http://127.0.0.1:\${env("SUPERSET_PORT") || DEFAULT_PORT}/hook/complete?\${params.toString()}\`, { method: "GET" }, 2000);
  } catch {}
}

main().catch(() => {});
`;
}

export function createNotifyScript(): void {
	const notifyPath = path.join(getHooksDir(), NOTIFY_SCRIPT_NAME);
	const script = getNotifyScriptContent();
	const changed = writeFileIfChanged(notifyPath, script, 0o755);
	const changedCmd =
		process.platform === "win32"
			? writeFileIfChanged(
					path.join(getHooksDir(), WINDOWS_NOTIFY_SCRIPT_NAME),
					getWindowsNotifyCommandScriptContent(),
					0o644,
				)
			: false;
	const changedNode =
		process.platform === "win32"
			? writeFileIfChanged(
					getNotifyNodeScriptPath(),
					getNotifyNodeScriptContent(),
					0o644,
				)
			: false;
	console.log(
		`[agent-setup] ${changed || changedCmd || changedNode ? "Updated" : "Verified"} notify hook`,
	);
}
