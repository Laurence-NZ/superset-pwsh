import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import { basename, dirname, join } from "node:path";

type ShellEnvSource = Record<string, string | undefined>;

export interface ResolveConfiguredShellOptions {
	platform?: NodeJS.Platform;
	/**
	 * Test override. `undefined` probes the OS account; `null` simulates an
	 * unavailable account shell and falls back to env.
	 */
	accountShell?: string | null;
}

function normalizeShellPath(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: null;
}

export function getAccountShell(
	platform: NodeJS.Platform = process.platform,
): string | null {
	if (platform === "win32") return null;

	try {
		const shell = (os.userInfo() as { shell?: unknown }).shell;
		return normalizeShellPath(shell);
	} catch {
		return null;
	}
}

let accountShellForTesting: string | null | undefined;

export function __setAccountShellForTesting(
	shell: string | null | undefined,
): void {
	accountShellForTesting = shell;
}

/**
 * Resolve the shell Superset should launch for user terminals.
 *
 * Desktop-launched helper processes can inherit a generic SHELL such as
 * /bin/bash even when the user's configured login shell is fish. Prefer the
 * OS account shell to match normal terminal-app behavior and the old v1 path.
 */
export function resolveConfiguredShell(
	env: ShellEnvSource,
	options: ResolveConfiguredShellOptions = {},
): string {
	const platform = options.platform ?? process.platform;

	if (platform === "win32") {
		return resolveWindowsShell(env);
	}

	const accountShell =
		options.accountShell === undefined
			? accountShellForTesting === undefined
				? getAccountShell(platform)
				: normalizeShellPath(accountShellForTesting)
			: normalizeShellPath(options.accountShell);

	return accountShell ?? normalizeShellPath(env.SHELL) ?? "/bin/sh";
}

/**
 * Read a Windows env var case-insensitively. GUI-launched Electron/Node env
 * snapshots can spell keys differently from an interactive shell (e.g. `Path`
 * vs `PATH`, `ProgramFiles` vs `PROGRAMFILES`).
 */
function getEnvCaseInsensitive(
	env: ShellEnvSource,
	key: string,
): string | undefined {
	const direct = env[key];
	if (direct !== undefined) return direct;
	const lower = key.toLowerCase();
	for (const k of Object.keys(env)) {
		if (k.toLowerCase() === lower) return env[k];
	}
	return undefined;
}

// Resolved once per process — see resolvePwsh7().
let cachedPwsh7: string | null | undefined;

/**
 * Resolve the shell for Windows V2 terminals.
 *
 * Order: explicit `SUPERSET_TERMINAL_SHELL` override → PowerShell 7 (`pwsh`)
 * when a validated install exists → `COMSPEC`/`cmd.exe`. Legacy Windows
 * PowerShell (`powershell.exe`) is never auto-selected; a user who wants it
 * must set the override explicitly.
 */
function resolveWindowsShell(env: ShellEnvSource): string {
	const override = normalizeShellPath(
		getEnvCaseInsensitive(env, "SUPERSET_TERMINAL_SHELL"),
	);
	if (override) return override;

	const comspec =
		normalizeShellPath(getEnvCaseInsensitive(env, "COMSPEC")) ?? "cmd.exe";

	// Only touch the filesystem / spawn a probe on a real Windows host. Tests
	// simulate win32 via options.platform on non-Windows CI and must not spawn.
	if (process.platform !== "win32") return comspec;

	return resolvePwsh7(env) ?? comspec;
}

function resolvePwsh7(env: ShellEnvSource): string | null {
	if (cachedPwsh7 !== undefined) return cachedPwsh7;
	cachedPwsh7 = discoverPwsh7(env);
	return cachedPwsh7;
}

function discoverPwsh7(env: ShellEnvSource): string | null {
	const candidates: string[] = [];
	const programFiles = getEnvCaseInsensitive(env, "ProgramFiles");
	if (programFiles) {
		candidates.push(join(programFiles, "PowerShell", "7", "pwsh.exe"));
		candidates.push(join(programFiles, "PowerShell", "7-preview", "pwsh.exe"));
	}
	// PATH entries catch a PATH-installed pwsh and the Store execution alias.
	// ProgramFiles is checked first so a real install wins over the alias.
	const pathValue = getEnvCaseInsensitive(env, "PATH");
	if (pathValue) {
		for (const dir of pathValue.split(";")) {
			const trimmed = dir.trim();
			if (trimmed) candidates.push(join(trimmed, "pwsh.exe"));
		}
	}
	// Store/MSIX pwsh is only ever exposed via the WindowsApps App Execution
	// Alias. Add it explicitly so discovery works even when the packaged app's
	// PATH omits WindowsApps (Explorer-launched builds carry a narrower PATH
	// than a dev pwsh terminal).
	const localAppData = getEnvCaseInsensitive(env, "LOCALAPPDATA");
	if (localAppData) {
		candidates.push(join(localAppData, "Microsoft", "WindowsApps", "pwsh.exe"));
	}

	for (const candidate of candidates) {
		const name = basename(candidate).toLowerCase();
		if (name !== "pwsh.exe" && name !== "pwsh") continue;
		// App Execution Aliases (Store/MSIX pwsh) are APPEXECLINK reparse points
		// living in a WindowsApps dir: existsSync() reports false but the exe
		// runs fine. Probe those directly; stat-gate every other candidate so a
		// missing pwsh isn't a wasted spawn.
		const isAppExecAlias =
			basename(dirname(candidate)).toLowerCase() === "windowsapps";
		if (!isAppExecAlias && !existsSync(candidate)) continue;
		if (pwshMajorVersion(candidate) >= 7) return candidate;
	}
	return null;
}

/** Probe `pwsh` version; returns 0 on any failure so callers can compare `>= 7`. */
function pwshMajorVersion(exe: string): number {
	try {
		const out = execFileSync(
			exe,
			["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"],
			{ timeout: 3000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		);
		const major = Number.parseInt(out.trim(), 10);
		return Number.isFinite(major) ? major : 0;
	} catch {
		return 0;
	}
}
