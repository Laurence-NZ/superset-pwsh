import { getKnownShell } from "@superset/shared/shell";
import { eq } from "drizzle-orm";
import { projects, workspaces } from "../../../../db/schema";
import {
	resolveScript,
	shellSingleQuote,
} from "../../../../runtime/setup/config";
import { getTerminalBaseEnv } from "../../../../terminal/env";
import { resolveLaunchShell } from "../../../../terminal/shell-launch";
import { createTerminalSessionInternal } from "../../../../terminal/terminal";
import type { HostServiceContext } from "../../../../types";
import type { TerminalDescriptor } from "./types";

interface StartSetupTerminalArgs {
	ctx: HostServiceContext;
	workspaceId: string;
	/**
	 * Appended to the resolved setup command with ` && `, so it runs in the
	 * setup terminal only after setup succeeds. Ignored when no setup command
	 * resolves — the caller must then dispatch it separately.
	 */
	chainCommand?: string;
}

interface StartSetupTerminalResult {
	terminal: TerminalDescriptor | null;
	warning: string | null;
	/** True when `chainCommand` was chained into the started setup terminal. */
	chained: boolean;
}

/**
 * Resolve and start the workspace-creation setup terminal, if any.
 *
 * Source order is the shared lifecycle-script posture (see `resolveScript`):
 * configured `setup` commands (chained for the launch shell so failures
 * short-circuit; worktree config overrides the main repo's), then a
 * `.superset/setup.<ext>` script (worktree first, then main repo;
 * platform-native extension on Windows). Scripts that need the canonical
 * `.superset/` dir read `$SUPERSET_ROOT_PATH`, injected by the v2 terminal env
 * builder. Configured `cwd` is honored via the terminal session.
 *
 * No-op when no source resolves to anything runnable.
 */
export async function startSetupTerminalIfPresent(
	args: StartSetupTerminalArgs,
): Promise<StartSetupTerminalResult> {
	const row = args.ctx.db
		.select({
			worktreePath: workspaces.worktreePath,
			repoPath: projects.repoPath,
			projectId: workspaces.projectId,
		})
		.from(workspaces)
		.innerJoin(projects, eq(projects.id, workspaces.projectId))
		.where(eq(workspaces.id, args.workspaceId))
		.get();

	if (!row || !row.worktreePath || !row.repoPath) {
		return { terminal: null, warning: null, chained: false };
	}

	const resolved = resolveInitialCommand({
		repoPath: row.repoPath,
		projectId: row.projectId,
		worktreePath: row.worktreePath,
		shell: resolveSetupShell(),
	});
	if (!resolved) {
		return { terminal: null, warning: null, chained: false };
	}

	const initialCommand = args.chainCommand
		? `${resolved.initialCommand} && ${args.chainCommand}`
		: resolved.initialCommand;

	const terminalId = crypto.randomUUID();
	const result = await createTerminalSessionInternal({
		terminalId,
		workspaceId: args.workspaceId,
		db: args.ctx.db,
		eventBus: args.ctx.eventBus,
		initialCommand,
		...(resolved.cwd && { cwd: resolved.cwd }),
	});
	if ("error" in result) {
		return {
			terminal: null,
			warning: `Failed to start setup terminal: ${result.error}`,
			chained: false,
		};
	}

	return {
		terminal: {
			id: terminalId,
			role: "setup",
			label: "Workspace Setup",
		},
		warning: null,
		chained: Boolean(args.chainCommand),
	};
}

/** Exported for tests. Resolves the initial command for the setup terminal. */
export function resolveInitialCommand(args: {
	repoPath: string;
	projectId: string;
	worktreePath?: string;
	/** Override $HOME for tests. */
	homeDir?: string;
	/** Override the platform for tests. Defaults to `process.platform`. */
	platform?: NodeJS.Platform;
	/** Override the launch shell for tests. */
	shell?: string;
}): { initialCommand: string; cwd?: string } | null {
	const platform = args.platform ?? process.platform;
	const resolved = resolveScript("setup", { ...args, platform });
	if (!resolved) return null;

	const initialCommand =
		resolved.kind === "commands"
			? buildSetupCommand(resolved.commands, args.shell, platform)
			: buildSetupScriptCommand(resolved.scriptPath, platform);
	return { initialCommand, ...(resolved.cwd && { cwd: resolved.cwd }) };
}

/**
 * Chain configured setup commands for the launch shell so a failing command
 * short-circuits the rest. POSIX/cmd and PowerShell 7+ (`pwsh`) use `&&`;
 * only legacy Windows PowerShell 5.1 (`powershell`) lacks `&&`, so there each
 * command gets an explicit failure guard.
 */
export function buildSetupCommand(
	commands: string[],
	shell?: string,
	platform: NodeJS.Platform = process.platform,
): string {
	const knownShell = shell ? getKnownShell(shell) : "unknown";
	if (platform === "win32" && knownShell === "powershell") {
		const guard =
			"if (-not $?) { if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; exit 1 }";
		return commands.map((command) => `${command}; ${guard}`).join("; ");
	}

	return commands.join(" && ");
}

/**
 * Invoke a resolved setup script per its extension: `.ts` via `bun`, Windows
 * `.cmd`/`.bat` directly, `.ps1` via `powershell.exe`, everything else via
 * `bash`. Unlike teardown, the setup terminal is a visible pane, so no
 * exit-code propagation is needed.
 */
export function buildSetupScriptCommand(
	scriptPath: string,
	platform: NodeJS.Platform = process.platform,
): string {
	const lower = scriptPath.toLowerCase();
	if (lower.endsWith(".ts")) {
		return platform === "win32"
			? `bun ${doubleQuote(scriptPath)}`
			: `bun ${shellSingleQuote(scriptPath)}`;
	}
	if (platform === "win32") {
		if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
			return doubleQuote(scriptPath);
		}
		if (lower.endsWith(".ps1")) {
			return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${doubleQuote(scriptPath)}`;
		}
	}
	return `bash ${shellSingleQuote(scriptPath)}`;
}

function doubleQuote(value: string): string {
	return `"${value.replaceAll('"', '\\"')}"`;
}

function resolveSetupShell(): string | undefined {
	try {
		return resolveLaunchShell(getTerminalBaseEnv());
	} catch {
		return undefined;
	}
}
