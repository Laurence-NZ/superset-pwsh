import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	getNotifyNodeScriptContent,
	getNotifyScriptPath,
	getWindowsNotifyCommandScriptContent,
	NOTIFY_SCRIPT_MARKER,
	WINDOWS_NOTIFY_SCRIPT_MARKER,
} from "./notify-hook";

const itBash = process.platform === "win32" ? it.skip : it;

function readTemplate(name: string): string {
	return readFileSync(path.join(import.meta.dir, "templates", name), "utf-8")
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n");
}

function runNotifyHook(input: Record<string, unknown>) {
	const script = readTemplate("notify-hook.template.sh")
		.replaceAll("{{MARKER}}", NOTIFY_SCRIPT_MARKER)
		.replaceAll("{{DEFAULT_PORT}}", "48763");
	return Bun.spawnSync({
		cmd: ["bash", "-c", script],
		env: {
			...process.env,
			SUPERSET_AGENT_ID: "grok",
			SUPERSET_DEBUG_HOOKS: "1",
		},
		stdin: Buffer.from(JSON.stringify(input)),
		stdout: "pipe",
		stderr: "pipe",
	});
}

function runNotifyNodeHook(input: Record<string, unknown>) {
	return Bun.spawnSync({
		cmd: [process.execPath, "-e", getNotifyNodeScriptContent()],
		env: {
			...process.env,
			SUPERSET_AGENT_ID: "grok",
			SUPERSET_DEBUG_HOOKS: "1",
		},
		stdin: Buffer.from(JSON.stringify(input)),
		stdout: "pipe",
		stderr: "pipe",
	});
}

describe("getNotifyScriptContent", () => {
	it("bumps the notify hook marker when hook semantics change", () => {
		expect(NOTIFY_SCRIPT_MARKER).toBe("# Superset agent notification hook v7");
		expect(WINDOWS_NOTIFY_SCRIPT_MARKER).toBe(
			"rem Superset agent notification hook v7",
		);
	});

	it("uses notify.cmd as the native Windows notify entrypoint", () => {
		expect(getNotifyScriptPath("win32")).toMatch(/notify\.cmd$/);
		expect(getNotifyScriptPath("linux")).toMatch(/notify\.sh$/);

		const cmd = getWindowsNotifyCommandScriptContent(
			String.raw`C:\Program Files\Superset\Superset.exe`,
		);
		expect(cmd).toContain("@echo off");
		expect(cmd).toContain(
			String.raw`set "NODE_EXE=C:\Program Files\Superset\Superset.exe"`,
		);
		expect(cmd).toContain("ELECTRON_RUN_AS_NODE=1");
		expect(cmd).toContain("node.exe");
		expect(cmd).toContain("notify.mjs");
		expect(cmd).not.toContain("powershell.exe");
		expect(cmd).toContain(WINDOWS_NOTIFY_SCRIPT_MARKER);
	});

	it("emits a Node notify implementation for Windows", () => {
		const script = getNotifyNodeScriptContent();

		expect(script).toContain("JSON.parse");
		expect(script).toContain('method: "POST"');
		expect(script).toContain("SUPERSET_HOST_AGENT_HOOK_URL");
		expect(script).toContain("SUPERSET_AGENT_ID");
		expect(script).toContain("/hook/complete");
		expect(script).toContain('["session_id", "sessionId"]');
		expect(script).toContain('["hook_event_name", "hookEventName"]');
	});

	it("emits the v2 host-service payload with full agent identity", () => {
		const script = readTemplate("notify-hook.template.sh");

		expect(script).toContain('HOOK_SESSION_ID=$(echo "$INPUT"');
		expect(script).toContain(
			'PAYLOAD="{\\"json\\":{\\"terminalId\\":\\"$(json_escape "$SUPERSET_TERMINAL_ID")\\",\\"eventType\\":\\"$(json_escape "$EVENT_TYPE")\\",\\"agent\\":{\\"agentId\\":\\"$(json_escape "$SUPERSET_AGENT_ID")\\",\\"sessionId\\":\\"$(json_escape "$SESSION_ID")\\"}}}"',
		);
		expect(script).toContain(
			"event=$EVENT_TYPE terminalId=$SUPERSET_TERMINAL_ID agentId=$SUPERSET_AGENT_ID hookSessionId=$HOOK_SESSION_ID resourceId=$RESOURCE_ID paneId=$SUPERSET_PANE_ID tabId=$SUPERSET_TAB_ID workspaceId=$SUPERSET_WORKSPACE_ID",
		);
		expect(script).toContain('V1_EVENT_TYPE="$EVENT_TYPE"');
		expect(script).toContain('V1_EVENT_TYPE="Stop"');
	});

	it("gives the v2 host-service hook enough time to deliver", () => {
		const script = readTemplate("notify-hook.template.sh");

		expect(script).toContain(
			'curl -sX POST "$SUPERSET_HOST_AGENT_HOOK_URL" \\\n    --connect-timeout 2 --max-time 5',
		);
	});

	it("falls back to the v1 Electron hook when v2 is unavailable", () => {
		const script = readTemplate("notify-hook.template.sh");

		expect(script).toContain(
			'if [ -n "$SUPERSET_HOST_AGENT_HOOK_URL" ] && [ -n "$SUPERSET_TERMINAL_ID" ]; then',
		);
		expect(script).toContain(
			'[ -z "$SUPERSET_TAB_ID" ] && [ -z "$SESSION_ID" ] && [ -z "$SUPERSET_TERMINAL_ID" ] && exit 0',
		);
		expect(script).toContain("/hook/complete");
		expect(script).toContain("terminalId=$SUPERSET_TERMINAL_ID");
		expect(script).toContain("SUPERSET_TAB_ID");
		expect(script).toContain("SUPERSET_PANE_ID");
	});

	itBash(
		"normalizes Grok permission notifications to PermissionRequest",
		() => {
			const result = runNotifyHook({
				hookEventName: "notification",
				notificationType: "permission_prompt",
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr.toString()).toContain(
				"[notify-hook] event=PermissionRequest",
			);
		},
	);

	itBash(
		"normalizes Grok ask_user_question notifications to PermissionRequest",
		() => {
			const result = runNotifyHook({
				hookEventName: "notification",
				notificationType: "elicitation_dialog",
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr.toString()).toContain(
				"[notify-hook] event=PermissionRequest",
			);
		},
	);

	itBash("ignores unrelated Grok notification subtypes", () => {
		const result = runNotifyHook({
			hookEventName: "notification",
			notificationType: "idle_prompt",
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr.toString()).toBe("");
	});

	it("normalizes Grok permission notifications in the Windows Node hook", () => {
		const result = runNotifyNodeHook({
			hookEventName: "notification",
			notificationType: "elicitation_dialog",
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr.toString()).toContain(
			"[notify-hook] event=PermissionRequest",
		);
	});

	it("ignores unrelated Grok notifications in the Windows Node hook", () => {
		const result = runNotifyNodeHook({
			hookEventName: "notification",
			notificationType: "idle_prompt",
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr.toString()).toBe("");
	});
});

describe("per-agent hook scripts dispatch to v2", () => {
	const buildExpectedV2Payload = (agentIdVar: string) =>
		`PAYLOAD="{\\"json\\":{\\"terminalId\\":\\"$(json_escape "$SUPERSET_TERMINAL_ID")\\",\\"eventType\\":\\"$(json_escape "$EVENT_TYPE")\\",\\"agent\\":{\\"agentId\\":\\"$(json_escape "$${agentIdVar}")\\",\\"sessionId\\":\\"$(json_escape "$HOOK_SESSION_ID")\\"}}}"`;

	for (const [template, agentIdVar] of [
		["cursor-hook.template.sh", "AGENT_ID"],
		["copilot-hook.template.sh", "SUPERSET_AGENT_ID"],
		["gemini-hook.template.sh", "SUPERSET_AGENT_ID"],
	] as const) {
		it(`${template} posts v2 first and falls back to v1`, () => {
			const script = readTemplate(template);
			expect(script).toContain(buildExpectedV2Payload(agentIdVar));
			expect(script).toContain('curl -sX POST "$SUPERSET_HOST_AGENT_HOOK_URL"');
			expect(script).toContain(
				'if [ -n "$SUPERSET_HOST_AGENT_HOOK_URL" ] && [ -n "$SUPERSET_TERMINAL_ID" ]; then',
			);
			expect(script).toContain("/hook/complete");
			expect(script).toContain('V1_EVENT_TYPE="$EVENT_TYPE"');
			expect(script).toContain("eventType=$V1_EVENT_TYPE");
			expect(script).toContain("terminalId=$SUPERSET_TERMINAL_ID");
			expect(script).toContain("SUPERSET_TAB_ID");
			expect(script).toContain("SUPERSET_PANE_ID");
		});
	}
});
