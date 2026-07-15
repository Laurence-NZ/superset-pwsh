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

export const GEMINI_HOOK_SCRIPT_NAME = "gemini-hook.sh";

const GEMINI_HOOK_SIGNATURE = "# Superset gemini hook";
const GEMINI_HOOK_VERSION = "v3";
export const GEMINI_HOOK_MARKER = `${GEMINI_HOOK_SIGNATURE} ${GEMINI_HOOK_VERSION}`;

const GEMINI_HOOK_TEMPLATE_PATH = path.join(
	__dirname,
	"templates",
	"gemini-hook.template.sh",
);

interface GeminiHookConfig {
	type: string;
	command: string;
	[key: string]: unknown;
}

interface GeminiHookDefinition {
	matcher?: string;
	command?: string;
	hooks?: GeminiHookConfig[];
	[key: string]: unknown;
}

interface GeminiSettingsJson {
	hooks?: Record<string, GeminiHookDefinition[]>;
	[key: string]: unknown;
}

export function getGeminiHookScriptPath(): string {
	return path.join(HOOKS_DIR, GEMINI_HOOK_SCRIPT_NAME);
}

export function getGeminiSettingsJsonPath(): string {
	return path.join(os.homedir(), ".gemini", "settings.json");
}

export function getGeminiHookScriptContent(): string {
	const template = fs.readFileSync(GEMINI_HOOK_TEMPLATE_PATH, "utf-8");
	return template
		.replace("{{MARKER}}", GEMINI_HOOK_MARKER)
		.replaceAll("{{DEFAULT_PORT}}", String(env.DESKTOP_NOTIFICATIONS_PORT));
}

/**
 * Reads existing ~/.gemini/settings.json, merges our hook definitions (identified by
 * hook script path), and preserves any user-defined settings/hooks.
 *
 * Gemini CLI uses a two-level nesting format:
 *   { hooks: { EventName: [{ matcher?, hooks: [{ type, command }] }] } }
 */
export function getGeminiSettingsJsonContent(hookScriptPath: string): string {
	const globalPath = getGeminiSettingsJsonPath();

	let existing: GeminiSettingsJson = {};
	try {
		if (fs.existsSync(globalPath)) {
			existing = JSON.parse(fs.readFileSync(globalPath, "utf-8"));
		}
	} catch {
		console.warn(
			"[agent-setup] Could not parse existing ~/.gemini/settings.json, merging carefully",
		);
	}

	if (!existing.hooks || typeof existing.hooks !== "object") {
		existing.hooks = {};
	}

	// HookEventName values from gemini-cli's packages/core/src/hooks/types.ts.
	const eventNames = [
		"SessionStart",
		"SessionEnd",
		"BeforeAgent",
		"AfterAgent",
		"AfterTool",
	];

	for (const eventName of eventNames) {
		const current = existing.hooks[eventName];
		const desiredEntries: GeminiHookDefinition[] = [
			{
				hooks: [{ type: "command", command: hookScriptPath }],
			},
		];
		const { entries } = reconcileManagedEntries({
			current,
			desired: desiredEntries,
			isManaged: (definition: GeminiHookDefinition) =>
				isSupersetManagedHookCommand(
					definition.command,
					GEMINI_HOOK_SCRIPT_NAME,
				) ||
				Boolean(
					definition.hooks?.some(
						(hook) =>
							hook.command?.includes(hookScriptPath) ||
							isSupersetManagedHookCommand(
								hook.command,
								GEMINI_HOOK_SCRIPT_NAME,
							),
					),
				),
			isEquivalent: (
				definition: GeminiHookDefinition,
				desiredDefinition: GeminiHookDefinition,
			) =>
				JSON.stringify(definition.hooks ?? []) ===
				JSON.stringify(desiredDefinition.hooks ?? []),
		});
		existing.hooks[eventName] = entries;
	}

	return JSON.stringify(existing, null, 2);
}

export function createGeminiHookScript(): void {
	const scriptPath = getGeminiHookScriptPath();
	const content = getGeminiHookScriptContent();
	const changed = writeFileIfChanged(scriptPath, content, 0o755);
	console.log(
		`[agent-setup] ${changed ? "Updated" : "Verified"} Gemini hook script`,
	);
}

export function createGeminiWrapper(): void {
	const script = buildWrapperScript("gemini", `exec "$REAL_BIN" "$@"`, {
		agentId: "gemini",
	});
	createWrapper("gemini", script, { agentId: "gemini" });
}

export function createGeminiSettingsJson(): void {
	// Windows port: don't merge Superset hooks into the user's global
	// ~/.gemini/settings.json on win32. getGeminiSettingsJsonContent emits a bare
	// POSIX gemini-hook.sh path with no Windows (.cmd/cmd.exe) equivalent, so the
	// command can't run on Windows anyway — merging it only churns a dotfile the
	// user may track in git. Intentional; mirrors createClaudeSettingsJson. To
	// support Windows later, give gemini-hook a platform-aware command + a .cmd
	// entrypoint (see notify-hook's getManagedNotifyHookCommand + notify.cmd /
	// notify.mjs) rather than deleting this guard — wire your own hook meanwhile
	// as with Claude. Note createGeminiHookScript still runs, so gemini-hook.sh is
	// still written.
	if (process.platform === "win32") return;

	const hookScriptPath = getGeminiHookScriptPath();
	const globalPath = getGeminiSettingsJsonPath();
	const content = getGeminiSettingsJsonContent(hookScriptPath);

	const dir = path.dirname(globalPath);
	fs.mkdirSync(dir, { recursive: true });
	const changed = writeFileIfChanged(globalPath, content, 0o644);
	console.log(
		`[agent-setup] ${changed ? "Updated" : "Verified"} Gemini settings.json`,
	);
}
