import { describe, expect, it } from "bun:test";
import { buildAgentCommandString } from "./agents";
import { buildAttachmentBlock } from "./attachment-prompt";

const argvConfig = {
	id: "00000000-0000-0000-0000-000000000001",
	presetId: "claude",
	label: "Claude",
	command: "claude",
	args: ["--dangerously-skip-permissions"],
	promptTransport: "argv" as const,
	promptArgs: [],
	env: {},
};

const stdinConfig = {
	id: "00000000-0000-0000-0000-000000000002",
	presetId: "amp",
	label: "Amp",
	command: "amp",
	args: [],
	promptTransport: "stdin" as const,
	promptArgs: [],
	env: {},
};

const RANDOM_ID = "test-1234";
const DELIMITER = "SUPERSET_PROMPT_test1234";

describe("buildAttachmentBlock", () => {
	it("keeps the complete prompt and every resolved attachment path", () => {
		const prompt = `${"large prompt 🎉\n".repeat(4096)}tail\n`;
		const attachments = Array.from({ length: 300 }, (_, index) => ({
			attachmentId: `attachment-${index}`,
			path: `/tmp/attached files/trace-${index}-中文.log`,
		}));

		const result = buildAttachmentBlock(prompt, attachments);

		expect(result.startsWith(prompt)).toBe(true);
		expect(result).toContain("# Attached files");
		expect(result).toContain("/tmp/attached files/trace-0-中文.log");
		expect(result).toEndWith("- /tmp/attached files/trace-299-中文.log");
	});

	it("does not alter prompts without attachments", () => {
		expect(buildAttachmentBlock("prompt\n", [])).toBe("prompt\n");
	});
});

// W7/W20: buildAgentCommandString is the Windows-only shell-aware launch path
// (runTerminalAgent's win32 branch). These cover the POSIX quoting/chaining it
// must keep producing; the pwsh-specific quoting is covered in the shared
// packages/shared agent-prompt-launch tests.
describe("buildAgentCommandString", () => {
	it("appends the prompt as a quoted positional (argv transport)", () => {
		// Not the shared "$(cat <<…)" form: the command must parse in non-POSIX
		// shells like fish, which have no heredocs.
		expect(
			buildAgentCommandString(argvConfig, "do the thing", [], RANDOM_ID),
		).toBe("'claude' '--dangerously-skip-permissions' 'do the thing'");
	});

	it("inserts model args between base args and the prompt (argv transport)", () => {
		expect(
			buildAgentCommandString(
				argvConfig,
				"do the thing",
				["--model", "sonnet"],
				RANDOM_ID,
			),
		).toBe(
			"'claude' '--dangerously-skip-permissions' '--model' 'sonnet' 'do the thing'",
		);
	});

	it("inserts model args before the heredoc (stdin transport)", () => {
		expect(
			buildAgentCommandString(
				stdinConfig,
				"do the thing",
				["--model", "sonnet"],
				RANDOM_ID,
			),
		).toBe(
			`'amp' '--model' 'sonnet' <<'${DELIMITER}'\ndo the thing\n${DELIMITER}`,
		);
	});

	it("shell-quotes hostile model and prompt values", () => {
		expect(
			buildAgentCommandString(
				argvConfig,
				"p'; rm -rf /",
				["--model", "x'; rm -rf /"],
				RANDOM_ID,
			),
		).toBe(
			"'claude' '--dangerously-skip-permissions' '--model' 'x'\\''; rm -rf /' 'p'\\''; rm -rf /'",
		);
	});

	it("includes promptArgs before the prompt when a prompt is present", () => {
		const config = { ...argvConfig, promptArgs: ["-p"] };
		expect(buildAgentCommandString(config, "p", [], RANDOM_ID)).toBe(
			"'claude' '--dangerously-skip-permissions' '-p' 'p'",
		);
	});

	it("drops promptArgs and the prompt payload when the prompt sanitizes to empty", () => {
		const config = { ...argvConfig, promptArgs: ["-p"] };
		expect(buildAgentCommandString(config, "\x1b\x07", [], RANDOM_ID)).toBe(
			"'claude' '--dangerously-skip-permissions'",
		);
		expect(buildAgentCommandString(stdinConfig, "", [], RANDOM_ID)).toBe(
			"'amp'",
		);
	});

	it("emits && as a shell operator, not a quoted arg", () => {
		const config = { ...argvConfig, command: "clear", args: ["&&", "claude"] };
		expect(buildAgentCommandString(config, "prompt", [], RANDOM_ID)).toBe(
			"'clear' && 'claude' 'prompt'",
		);
	});
});
