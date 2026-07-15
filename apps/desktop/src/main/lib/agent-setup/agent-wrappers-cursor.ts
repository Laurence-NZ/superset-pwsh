import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "shared/env.shared";
import {
	buildWrapperScript,
	createWrapper,
	isSupersetManagedHookCommand,
	reconcileManagedEntries,
	writeFileIfChanged,
} from "./agent-wrappers-common";
import { HOOKS_DIR } from "./paths";

export const CURSOR_HOOK_SCRIPT_NAME = "cursor-hook.sh";

const CURSOR_HOOK_SIGNATURE = "# Superset cursor hook";
const CURSOR_HOOK_VERSION = "v3";
export const CURSOR_HOOK_MARKER = `${CURSOR_HOOK_SIGNATURE} ${CURSOR_HOOK_VERSION}`;

const CURSOR_HOOK_TEMPLATE_PATH = path.join(
	__dirname,
	"templates",
	"cursor-hook.template.sh",
);

interface CursorHookEntry {
	command: string;
	[key: string]: unknown;
}

interface CursorHooksJson {
	version?: number;
	hooks?: Record<string, CursorHookEntry[]>;
	[key: string]: unknown;
}

export function getCursorHookScriptPath(): string {
	return path.join(HOOKS_DIR, CURSOR_HOOK_SCRIPT_NAME);
}

export function getCursorGlobalHooksJsonPath(): string {
	return path.join(os.homedir(), ".cursor", "hooks.json");
}

export function getCursorHookScriptContent(): string {
	const template = fs.readFileSync(CURSOR_HOOK_TEMPLATE_PATH, "utf-8");
	return template
		.replace("{{MARKER}}", CURSOR_HOOK_MARKER)
		.replaceAll("{{DEFAULT_PORT}}", String(env.DESKTOP_NOTIFICATIONS_PORT));
}

/**
 * Reads existing ~/.cursor/hooks.json, merges our hook entries (identified by
 * hook script path), and preserves any user-defined hooks.
 */
export function getCursorHooksJsonContent(hookScriptPath: string): string {
	const globalPath = getCursorGlobalHooksJsonPath();

	let existing: CursorHooksJson = {};
	try {
		if (fs.existsSync(globalPath)) {
			existing = JSON.parse(fs.readFileSync(globalPath, "utf-8"));
		}
	} catch {
		console.warn(
			"[agent-setup] Could not parse existing ~/.cursor/hooks.json, merging carefully",
		);
	}

	if (!existing.version) {
		existing.version = 1;
	}
	if (!existing.hooks || typeof existing.hooks !== "object") {
		existing.hooks = {};
	}

	const ourHooks: Record<string, CursorHookEntry> = {
		sessionStart: { command: `${hookScriptPath} SessionStart` },
		sessionEnd: { command: `${hookScriptPath} SessionEnd` },
		beforeSubmitPrompt: { command: `${hookScriptPath} Start` },
		stop: { command: `${hookScriptPath} Stop` },
		beforeShellExecution: {
			command: `${hookScriptPath} PermissionRequest`,
		},
		beforeMCPExecution: {
			command: `${hookScriptPath} PermissionRequest`,
		},
	};

	for (const [eventName, ourEntry] of Object.entries(ourHooks)) {
		const current = existing.hooks[eventName];
		const { entries } = reconcileManagedEntries({
			current,
			desired: [ourEntry],
			isManaged: (entry: CursorHookEntry) =>
				entry.command?.includes(hookScriptPath) ||
				isSupersetManagedHookCommand(entry.command, CURSOR_HOOK_SCRIPT_NAME),
			isEquivalent: (entry: CursorHookEntry, desiredEntry: CursorHookEntry) =>
				entry.command === desiredEntry.command,
		});
		existing.hooks[eventName] = entries;
	}

	return JSON.stringify(existing, null, 2);
}

export function createCursorHookScript(): void {
	const scriptPath = getCursorHookScriptPath();
	const content = getCursorHookScriptContent();
	const changed = writeFileIfChanged(scriptPath, content, 0o755);
	console.log(
		`[agent-setup] ${changed ? "Updated" : "Verified"} Cursor hook script`,
	);
}

export function createCursorAgentWrapper(): void {
	const script = buildWrapperScript("cursor-agent", `exec "$REAL_BIN" "$@"`, {
		agentId: "cursor-agent",
	});
	createWrapper("cursor-agent", script, { agentId: "cursor-agent" });
}

export function createCursorHooksJson(): void {
	// Windows port: don't merge Superset hooks into the user's global
	// ~/.cursor/hooks.json on win32. getCursorHooksJsonContent emits a bare
	// POSIX cursor-hook.sh path with no Windows (.cmd/cmd.exe) equivalent, so
	// the command can't run on Windows anyway — merging it only churns a dotfile
	// the user may track in git. Intentional; mirrors createClaudeSettingsJson.
	// To support Windows later, give cursor-hook a platform-aware command + a
	// .cmd entrypoint (see notify-hook's getManagedNotifyHookCommand + notify.cmd
	// / notify.mjs) rather than deleting this guard — the user wires their own
	// hook meanwhile (their ~/.cursor cursor-hook.ps1 entries). Note
	// createCursorHookScript still runs, so cursor-hook.sh is still written.
	if (process.platform === "win32") return;

	const hookScriptPath = getCursorHookScriptPath();
	const globalPath = getCursorGlobalHooksJsonPath();
	const content = getCursorHooksJsonContent(hookScriptPath);

	const dir = path.dirname(globalPath);
	fs.mkdirSync(dir, { recursive: true });
	const changed = writeFileIfChanged(globalPath, content, 0o644);
	console.log(
		`[agent-setup] ${changed ? "Updated" : "Verified"} Cursor hooks.json`,
	);
}
