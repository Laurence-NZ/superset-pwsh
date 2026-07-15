export type KnownShell =
	| "bash"
	| "zsh"
	| "fish"
	| "sh"
	| "ksh"
	| "cmd"
	| "powershell"
	| "pwsh"
	| "unknown";

function stripExeSuffix(name: string): string {
	return name.toLowerCase().endsWith(".exe") ? name.slice(0, -4) : name;
}

export function getShellName(shell: string): string {
	const trimmed = shell.trim();
	if (!trimmed) return "";

	const normalized = trimmed.replaceAll("\\", "/");
	const segments = normalized.split("/");
	const basename = segments[segments.length - 1] || normalized;
	return stripExeSuffix(basename).toLowerCase();
}

export function getKnownShell(shell: string): KnownShell {
	const shellName = getShellName(shell);
	switch (shellName) {
		case "bash":
		case "zsh":
		case "fish":
		case "sh":
		case "ksh":
		case "cmd":
		case "powershell":
		case "pwsh":
			return shellName;
		default:
			return "unknown";
	}
}

export function shellSupportsReadyMarker(shell: string): boolean {
	const knownShell = getKnownShell(shell);
	return knownShell === "bash" || knownShell === "zsh" || knownShell === "fish";
}

export function getWindowsInteractiveShellArgs(shell: string): string[] | null {
	const knownShell = getKnownShell(shell);
	if (knownShell === "cmd") return [];
	if (knownShell === "powershell" || knownShell === "pwsh") return ["-NoLogo"];
	return null;
}

export function getWindowsCommandShellArgs(
	shell: string,
	command: string,
): string[] | null {
	const knownShell = getKnownShell(shell);
	if (knownShell === "cmd") {
		return ["/d", "/s", "/c", command];
	}
	if (knownShell === "powershell" || knownShell === "pwsh") {
		return ["-NoLogo", "-NoProfile", "-Command", command];
	}
	return null;
}

export type ShellCommandChainMode = "interactive" | "exit-on-failure";

export interface BuildShellCommandChainOptions {
	shell?: string | null;
	platform?: string;
	mode?: ShellCommandChainMode;
}

const POWERSHELL_FAILURE_EXIT_GUARD =
	"if (-not $?) { if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; exit 1 }";

function quotePosixShellLiteral(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function quotePowerShellLiteral(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function quoteCmdLiteral(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function buildPowerShellInteractiveChain(commands: string[]): string {
	return commands
		.map((command, index) => (index === 0 ? command : `if ($?) { ${command} }`))
		.join("; ");
}

function buildPowerShellExitOnFailureChain(commands: string[]): string {
	return commands.join(`; ${POWERSHELL_FAILURE_EXIT_GUARD}; `);
}

export function buildShellCommandChain(
	commands: string[],
	options: BuildShellCommandChainOptions = {},
): string {
	const platform = options.platform ?? process.platform;
	const mode = options.mode ?? "interactive";
	const knownShell = options.shell ? getKnownShell(options.shell) : "unknown";

	if (
		platform === "win32" &&
		(knownShell === "powershell" || knownShell === "pwsh")
	) {
		return mode === "exit-on-failure"
			? buildPowerShellExitOnFailureChain(commands)
			: buildPowerShellInteractiveChain(commands);
	}

	return commands.join(" && ");
}

export function buildShellChangeDirectoryCommand(
	cwd: string,
	shell?: string | null,
): string {
	const knownShell = shell ? getKnownShell(shell) : "unknown";
	if (knownShell === "cmd") {
		return `cd /d ${quoteCmdLiteral(cwd)}`;
	}
	if (knownShell === "powershell" || knownShell === "pwsh") {
		return `Set-Location -LiteralPath ${quotePowerShellLiteral(cwd)}`;
	}
	return `cd ${quotePosixShellLiteral(cwd)}`;
}

export function getShellLineEnding(
	shell?: string | null,
): "\r\n" | "\r" | "\n" {
	const knownShell = shell ? getKnownShell(shell) : "unknown";
	// PSReadLine accepts the line on the CR, then treats the trailing LF of a
	// CRLF as a fresh keystroke — leaving a ">>" continuation prompt on the next
	// line after the command runs. A lone CR is exactly what the Enter key
	// sends, so use it for PowerShell. cmd.exe tolerates CRLF, so leave it.
	if (knownShell === "powershell" || knownShell === "pwsh") return "\r";
	if (knownShell === "cmd") return "\r\n";
	return "\n";
}

export function appendShellLineEnding(
	command: string,
	shell?: string | null,
): string {
	if (command.endsWith("\n") || command.endsWith("\r\n")) return command;
	return `${command}${getShellLineEnding(shell)}`;
}
