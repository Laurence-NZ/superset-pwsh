import { getKnownShell, quotePowerShellLiteral } from "./shell";

/**
 * Prompt transports define the small set of ways a CLI can receive prompt
 * payloads. Keep this enum intentionally small and add a new transport only
 * when a real agent requires it. Avoid arbitrary per-agent shell templates.
 */
export const PROMPT_TRANSPORTS = ["argv", "stdin"] as const;

export type PromptTransport = (typeof PROMPT_TRANSPORTS)[number];

/**
 * Sanitize a prompt destined for a PTY. Launch commands are written to the
 * shell as if typed, so prompt bytes hit the line editor as keystrokes:
 * ESC/C1 sequences fire keybindings, a lone CR submits the line early, and a
 * tab triggers completion. Normalizes CRLF/CR to LF, removes ANSI CSI/OSC
 * sequences whole (so their printable payload doesn't survive as garbage),
 * strips remaining control characters, and expands tabs to four spaces.
 * Keeps newlines.
 */
export function sanitizePromptForPty(prompt: string): string {
	return (
		prompt
			.replace(/\r\n?/g, "\n")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars intentionally
			.replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, "")
			// Terminator is required: an unterminated OSC must not swallow the
			// rest of the line — its lead byte falls through to the strip below.
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars intentionally
			.replace(/(?:\x1b\]|\x9d)[^\x07\x1b\x9c\n]*(?:\x07|\x1b\\|\x9c)/g, "")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars intentionally
			.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "")
			.replaceAll("\t", "    ")
	);
}

function resolveDelimiter(prompt: string, randomId: string): string {
	let delimiter = `SUPERSET_PROMPT_${randomId.replaceAll("-", "")}`;
	while (prompt.includes(delimiter)) {
		delimiter = `${delimiter}_X`;
	}
	return delimiter;
}

export function quoteSingleShell(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

interface ShellCommandOptions {
	shell?: string | null;
}

function isPowerShell(shell?: string | null): boolean {
	if (!shell) return false;
	const knownShell = getKnownShell(shell);
	return knownShell === "powershell" || knownShell === "pwsh";
}

// Tokens made only of these characters (command names, flags, model ids,
// bare Windows paths) parse literally in PowerShell and are left unquoted so
// the launched line reads naturally. Anything else — spaces, quotes, $, ;,
// etc. — gets single-quoted.
const POWERSHELL_BARE_TOKEN = /^[A-Za-z0-9_./\\:=-]+$/;

/**
 * Quote a token for PowerShell. Single-line tokens use a `'…'` literal. A
 * token containing newlines can't: the command is *typed* into the terminal,
 * and a single-quoted literal would embed raw LF bytes, which PSReadLine reads
 * as a line-accept and truncates the prompt. Emit a double-quoted string with
 * backtick escapes instead so the whole command stays on one physical line and
 * PowerShell rebuilds the newlines itself.
 */
export function quotePowerShellArg(value: string): string {
	if (!value.includes("\n")) return quotePowerShellLiteral(value);
	const escaped = value
		.replaceAll("`", "``")
		.replaceAll('"', '`"')
		.replaceAll("$", "`$")
		.replaceAll("\n", "`n");
	return `"${escaped}"`;
}

function renderPowerShellToken(token: string): string {
	return POWERSHELL_BARE_TOKEN.test(token) ? token : quotePowerShellArg(token);
}

/**
 * PowerShell parses a bare quoted string as an expression, so a *quoted*
 * command name only runs behind the `&` call operator (a bare name runs on its
 * own). Split on the `&&` chain operator (native in pwsh 7+) so each command in
 * the chain is handled independently.
 */
function buildPowerShellArgvCommand(argv: string[]): string {
	const segments: string[][] = [[]];
	for (const token of argv) {
		if (token === "&&") {
			segments.push([]);
		} else {
			const current = segments[segments.length - 1];
			if (current) current.push(token);
		}
	}
	return segments
		.filter((tokens) => tokens.length > 0)
		.map((tokens) => {
			const rendered = tokens.map(renderPowerShellToken);
			const command = rendered[0] ?? "";
			const callOp =
				command.startsWith("'") || command.startsWith('"') ? "& " : "";
			return `${callOp}${rendered.join(" ")}`;
		})
		.join(" && ");
}

export function buildArgvCommand(
	argv: string[],
	options: ShellCommandOptions = {},
): string {
	if (isPowerShell(options.shell)) return buildPowerShellArgvCommand(argv);

	// `&&` is a shell control operator, not an argument — emit it verbatim so a
	// stored command like { command: "clear", args: ["&&", "claude"] } launches
	// as `clear && claude` instead of `clear '&&' 'claude'`.
	return argv
		.map((token) => (token === "&&" ? "&&" : quoteSingleShell(token)))
		.join(" ");
}

export function envOverlayPrefix(
	env: Record<string, string>,
	options: ShellCommandOptions = {},
): string {
	const entries = Object.entries(env);
	if (entries.length === 0) return "";

	if (isPowerShell(options.shell)) {
		// `$env:KEY='value'; …; <command>` — PowerShell has no POSIX
		// `KEY=value command` inline-assignment form.
		return `${entries
			.map(([key, value]) => `$env:${key}=${quotePowerShellArg(value)}`)
			.join("; ")}; `;
	}

	return `${entries
		.map(([key, value]) => `${key}=${quoteSingleShell(value)}`)
		.join(" ")} `;
}

function joinCommand(command: string, suffix?: string): string {
	return suffix ? `${command} ${suffix}` : command;
}

export function buildPromptCommandString({
	command,
	suffix,
	transport,
	prompt: rawPrompt,
	randomId,
}: {
	command: string;
	suffix?: string;
	transport: PromptTransport;
	prompt: string;
	randomId: string;
}): string {
	const prompt = sanitizePromptForPty(rawPrompt);
	const delimiter = resolveDelimiter(prompt, randomId);
	const fullCommand = joinCommand(command, suffix);

	if (transport === "stdin") {
		return `${fullCommand} <<'${delimiter}'\n${prompt}\n${delimiter}`;
	}

	return `${command} "$(cat <<'${delimiter}'\n${prompt}\n${delimiter}\n)"${suffix ? ` ${suffix}` : ""}`;
}

export function buildPromptFileCommandString({
	command,
	suffix,
	transport,
	filePath,
}: {
	command: string;
	suffix?: string;
	transport: PromptTransport;
	filePath: string;
}): string {
	const quotedPath = quoteSingleShell(filePath);
	const fullCommand = joinCommand(command, suffix);

	if (transport === "stdin") {
		return `${fullCommand} < ${quotedPath}`;
	}

	return `${command} "$(cat ${quotedPath})"${suffix ? ` ${suffix}` : ""}`;
}
