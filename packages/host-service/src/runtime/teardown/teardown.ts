import { randomUUID } from "node:crypto";
import { TEARDOWN_TIMEOUT_MS } from "@superset/shared/constants";
import { getKnownShell } from "@superset/shared/shell";
import type { HostDb } from "../../db";
import { getTerminalBaseEnv } from "../../terminal/env";
import { resolveLaunchShell } from "../../terminal/shell-launch";
import {
	createTerminalSessionInternal,
	disposeSession,
} from "../../terminal/terminal";
import { resolveScript, shellSingleQuote } from "../setup/config";

export { TEARDOWN_TIMEOUT_MS };

const OUTPUT_TAIL_BYTES = 4096;
const KILL_GRACE_MS = 2_000;

export type TeardownResult =
	| { status: "ok"; output?: string }
	| { status: "skipped" }
	| {
			status: "failed";
			exitCode: number | null;
			/** Unix signal number, or null on normal exit. */
			signal: number | null;
			timedOut: boolean;
			/** Raw PTY bytes — shell output including ANSI. Renderer strips for display. */
			outputTail: string;
	  };

interface RunTeardownOptions {
	db: HostDb;
	workspaceId: string;
	worktreePath: string;
	/** Main repo path — source of truth for `.superset/config.json`. */
	repoPath: string;
	projectId: string;
	timeoutMs?: number;
	/** Override $HOME for tests. Defaults to `os.homedir()`. */
	homeDir?: string;
}

/**
 * Runs the workspace's teardown, reusing the same terminal primitive v2 uses
 * for interactive sessions. This gives it full environment parity with the
 * user's terminals (login shell rcfiles, PATH, nvm/rbenv, etc.), matching how
 * setup runs.
 *
 * The teardown to run is resolved by {@link resolveTeardownCommand}: the
 * configured `teardown` commands from `.superset/config.json` take precedence,
 * falling back to a `.superset/teardown.<ext>` script (worktree first, then
 * main repo; platform-native extension on Windows). Skipped (as a success)
 * when no source resolves to anything runnable.
 *
 * Silent by design — the PTY session is transient and not surfaced as a
 * visible pane. The renderer only sees the output tail on failure.
 */
export async function runTeardown({
	db,
	workspaceId,
	worktreePath,
	repoPath,
	projectId,
	timeoutMs = TEARDOWN_TIMEOUT_MS,
	homeDir,
}: RunTeardownOptions): Promise<TeardownResult> {
	const resolved = resolveTeardownCommand({
		repoPath,
		projectId,
		worktreePath,
		homeDir,
	});
	if (resolved === null) return { status: "skipped" };

	const terminalId = randomUUID();

	const session = await createTerminalSessionInternal({
		terminalId,
		workspaceId,
		db,
		initialCommand: resolved.initialCommand,
		...(resolved.cwd && { cwd: resolved.cwd }),
		listed: false,
	});
	if ("error" in session) {
		return {
			status: "failed",
			exitCode: null,
			signal: null,
			timedOut: false,
			outputTail: `Failed to start teardown session: ${session.error}`,
		};
	}

	let tail = "";
	const appendTail = (chunk: string) => {
		tail += chunk;
		if (tail.length > OUTPUT_TAIL_BYTES) {
			tail = tail.slice(-OUTPUT_TAIL_BYTES);
		}
	};
	const dataDisposer = session.pty.onData(appendTail);

	return new Promise<TeardownResult>((resolve) => {
		let settled = false;
		let timedOut = false;

		const settle = (result: TeardownResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				dataDisposer.dispose();
			} catch {
				// already disposed
			}
			disposeSession(terminalId, db);
			resolve(result);
		};

		session.pty.onExit(({ exitCode, signal }) => {
			if (exitCode === 0 && !timedOut) {
				settle({ status: "ok", output: tail || undefined });
				return;
			}
			settle({
				status: "failed",
				exitCode: exitCode ?? null,
				signal: signal ?? null,
				timedOut,
				outputTail: tail,
			});
		});

		const timer = setTimeout(() => {
			if (settled) return;
			timedOut = true;
			appendTail(`\n[teardown timed out after ${timeoutMs}ms]\n`);
			try {
				void session.pty.kill().catch(() => {});
			} catch {
				// PTY may already be dead
			}
			// Hard-stop: if onExit doesn't fire shortly after kill (zombie PTY),
			// settle the promise directly so workspaceCleanup.destroy never hangs.
			setTimeout(() => {
				settle({
					status: "failed",
					exitCode: null,
					signal: null,
					timedOut: true,
					outputTail: tail,
				});
			}, KILL_GRACE_MS).unref();
		}, timeoutMs);
		timer.unref();
	});
}

/**
 * Resolve the teardown command for a workspace, if any. Uses the shared
 * lifecycle-script posture (see `resolveScript`): configured `teardown`
 * commands — worktree config overriding the main repo's — then a
 * `teardown.<ext>` script, worktree first (state generated during the session
 * must win) and main repo second (gitignored scripts don't exist in
 * worktrees).
 *
 * Returns null when no source resolves to anything runnable, which the
 * caller treats as a skipped (successful) teardown.
 *
 * Exported for tests.
 */
export function resolveTeardownCommand(args: {
	repoPath: string;
	projectId: string;
	worktreePath: string;
	/** Override $HOME for tests. */
	homeDir?: string;
	/** Override the platform for tests. Defaults to `process.platform`. */
	platform?: NodeJS.Platform;
	/** Override the launch shell for tests. */
	shell?: string;
}): { initialCommand: string; cwd?: string } | null {
	const platform = args.platform ?? process.platform;
	const resolved = resolveScript("teardown", { ...args, platform });
	if (!resolved) return null;

	const shell = args.shell ?? resolveTeardownShell();
	const initialCommand =
		resolved.kind === "commands"
			? buildTeardownCommandFromCommands(resolved.commands, shell, platform)
			: buildTeardownInitialCommand(resolved.scriptPath, shell, platform);
	return { initialCommand, ...(resolved.cwd && { cwd: resolved.cwd }) };
}

/**
 * Build the initial command for a resolved teardown script. The hidden PTY's
 * exit code is the teardown status, so every branch makes the launch shell
 * exit with the script's code:
 *   - POSIX: `exec` replaces the login shell with the script process, avoiding
 *     shell-specific exit syntax like `$?` (breaks in fish).
 *   - Windows cmd: `&& exit /b 0 || exit /b 1`.
 *   - Windows PowerShell/pwsh: `; exit $LASTEXITCODE`.
 */
export function buildTeardownInitialCommand(
	scriptPath: string,
	shell?: string,
	platform: NodeJS.Platform = process.platform,
): string {
	if (scriptPath.endsWith(".ts")) {
		const knownShell = shell ? getKnownShell(shell) : "unknown";
		if (knownShell === "cmd") {
			return `bun ${doubleQuote(scriptPath)} && exit /b 0 || exit /b 1`;
		}
		if (knownShell === "powershell" || knownShell === "pwsh") {
			return `bun ${powershellSingleQuote(scriptPath)}; exit $LASTEXITCODE`;
		}
		return `exec bun ${shellSingleQuote(scriptPath)}`;
	}

	if (platform === "win32") {
		const knownShell = shell ? getKnownShell(shell) : "unknown";
		const lowerScriptPath = scriptPath.toLowerCase();
		if (lowerScriptPath.endsWith(".cmd") || lowerScriptPath.endsWith(".bat")) {
			if (knownShell === "powershell" || knownShell === "pwsh") {
				return `cmd.exe /d /s /c ${powershellSingleQuote(doubleQuote(scriptPath))}; exit $LASTEXITCODE`;
			}
			return `${doubleQuote(scriptPath)} && exit /b 0 || exit /b 1`;
		}
		if (lowerScriptPath.endsWith(".ps1")) {
			if (knownShell === "cmd" || knownShell === "unknown") {
				return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${doubleQuote(scriptPath)} && exit /b 0 || exit /b 1`;
			}
			return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${powershellSingleQuote(scriptPath)}; exit $LASTEXITCODE`;
		}
	}

	return `exec bash ${shellSingleQuote(scriptPath)}`;
}

/**
 * Build the initial command for configured `teardown` commands. Same exit-code
 * posture as {@link buildTeardownInitialCommand}: the launch shell exits with
 * the teardown status so the hidden PTY settles correctly.
 *   - POSIX: `exec bash -c` runs the `&&`-chained commands in one shell and
 *     replaces the login shell so the PTY exits with the teardown status.
 *   - Windows cmd: `&&`-chain then `&& exit /b 0 || exit /b 1`.
 *   - Windows PowerShell/pwsh: run each command with a failure guard, exit 0
 *     at the end (PowerShell 5.1 has no `&&` short-circuit).
 */
export function buildTeardownCommandFromCommands(
	commands: string[],
	shell?: string,
	platform: NodeJS.Platform = process.platform,
): string {
	if (platform === "win32") {
		const knownShell = shell ? getKnownShell(shell) : "unknown";
		if (knownShell === "powershell" || knownShell === "pwsh") {
			const guard =
				"if (-not $?) { if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; exit 1 }";
			return `${commands.map((command) => `${command}; ${guard}`).join("; ")}; exit 0`;
		}
		return `${commands.join(" && ")} && exit /b 0 || exit /b 1`;
	}
	return `exec bash -c ${shellSingleQuote(commands.join(" && "))}`;
}

function powershellSingleQuote(s: string): string {
	return `'${s.replaceAll("'", "''")}'`;
}

function doubleQuote(s: string): string {
	return `"${s.replaceAll('"', '\\"')}"`;
}

function resolveTeardownShell(): string | undefined {
	try {
		return resolveLaunchShell(getTerminalBaseEnv());
	} catch {
		return undefined;
	}
}
