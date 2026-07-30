import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildSetupAndAgentCommand,
	buildSetupCommand,
	buildSetupScriptCommand,
	resolveInitialCommand,
} from "./setup-terminal";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

interface Sandbox {
	repoPath: string;
	homeDir: string;
	cleanup: () => void;
}

function createSandbox(): Sandbox {
	const root = mkdtempSync(join(tmpdir(), "setup-terminal-test-"));
	const repoPath = join(root, "repo");
	const homeDir = join(root, "home");
	mkdirSync(repoPath, { recursive: true });
	mkdirSync(homeDir, { recursive: true });
	return {
		repoPath,
		homeDir,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

function writeConfig(repoPath: string, content: object) {
	const dir = join(repoPath, ".superset");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "config.json"), JSON.stringify(content), "utf-8");
}

function writeFallbackScript(repoPath: string) {
	const dir = join(repoPath, ".superset");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "setup.sh"), "#!/bin/bash\necho hi\n", "utf-8");
}

function writePortableFallbackScript(repoPath: string) {
	const dir = join(repoPath, ".superset");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "setup.ts"), "console.log('hi');\n", "utf-8");
}

function writeWindowsFallbackScript(
	repoPath: string,
	fileName: "setup.cmd" | "setup.bat" | "setup.ps1",
) {
	const dir = join(repoPath, ".superset");
	mkdirSync(dir, { recursive: true });
	const content =
		fileName === "setup.ps1" ? "Write-Output hi\n" : "@echo off\r\necho hi\r\n";
	writeFileSync(join(dir, fileName), content, "utf-8");
}

describe("resolveInitialCommand", () => {
	let sandbox: Sandbox;

	beforeEach(() => {
		sandbox = createSandbox();
	});

	afterEach(() => {
		sandbox.cleanup();
	});

	function resolve(platform: NodeJS.Platform = "linux") {
		return resolveInitialCommand({
			repoPath: sandbox.repoPath,
			projectId: PROJECT_ID,
			homeDir: sandbox.homeDir,
			platform,
		});
	}

	it("returns null when no config and no fallback script exist", () => {
		expect(resolve()).toBeNull();
	});

	it("joins multi-line setup commands with ' && '", () => {
		writeConfig(sandbox.repoPath, {
			setup: ["bun install", "bun run db:migrate"],
		});
		expect(resolve()).toEqual({
			initialCommand: "bun install && bun run db:migrate",
		});
	});

	it("builds PowerShell-compatible setup command chains on Windows", () => {
		const command = buildSetupCommand(
			["bun install", "bun run db:migrate"],
			"powershell.exe",
			"win32",
		);

		expect(command).toBe(
			"bun install; if (-not $?) { if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; exit 1 }; bun run db:migrate; if (-not $?) { if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; exit 1 }",
		);
		expect(command).not.toContain(" && ");
	});

	it("joins setup commands with ' && ' under pwsh 7 on Windows", () => {
		const command = buildSetupCommand(
			["bun install", "bun run db:migrate"],
			"pwsh.exe",
			"win32",
		);

		expect(command).toBe("bun install && bun run db:migrate");
		expect(command).not.toContain("$?");
	});

	it("chains an agent behind setup for the Windows launch shell", () => {
		expect(
			buildSetupAndAgentCommand(
				"bun install",
				"claude",
				"powershell.exe",
				"win32",
			),
		).toBe("bun install; if ($?) { claude }");
		expect(
			buildSetupAndAgentCommand("bun install", "claude", "pwsh.exe", "win32"),
		).toBe("bun install; if ($?) { claude }");
	});

	it("uses the PowerShell setup chain when resolving configured setup commands", () => {
		writeConfig(sandbox.repoPath, {
			setup: ["bun install", "bun run db:migrate"],
		});

		const command = resolveInitialCommand({
			repoPath: sandbox.repoPath,
			projectId: PROJECT_ID,
			homeDir: sandbox.homeDir,
			platform: "win32",
			shell: "powershell.exe",
		})?.initialCommand;

		expect(command).toContain("bun install; if (-not $?)");
		expect(command).toContain("bun run db:migrate; if (-not $?)");
		expect(command).not.toContain(" && ");
	});

	it("returns the single command when setup has only one line", () => {
		writeConfig(sandbox.repoPath, { setup: ["bun install"] });
		expect(resolve()).toEqual({ initialCommand: "bun install" });
	});

	it("falls back to bash <repoPath>/.superset/setup.sh when config is empty", () => {
		writeConfig(sandbox.repoPath, { setup: [], teardown: [] });
		writeFallbackScript(sandbox.repoPath);

		expect(resolve()).toEqual({
			initialCommand: `bash '${join(sandbox.repoPath, ".superset", "setup.sh")}'`,
		});
	});

	it("falls back to setup.sh when no config.json exists at all", () => {
		writeFallbackScript(sandbox.repoPath);
		expect(resolve()).toEqual({
			initialCommand: `bash '${join(sandbox.repoPath, ".superset", "setup.sh")}'`,
		});
	});

	it("prefers the portable setup.ts fallback on Windows", () => {
		writeFallbackScript(sandbox.repoPath);
		writePortableFallbackScript(sandbox.repoPath);

		expect(
			resolveInitialCommand({
				repoPath: sandbox.repoPath,
				projectId: PROJECT_ID,
				homeDir: sandbox.homeDir,
				platform: "win32",
			}),
		).toEqual({
			initialCommand: `bun "${join(sandbox.repoPath, ".superset", "setup.ts")}"`,
		});
	});

	it("uses Windows-native setup fallback scripts when setup.ts is absent", () => {
		writeWindowsFallbackScript(sandbox.repoPath, "setup.ps1");
		writeWindowsFallbackScript(sandbox.repoPath, "setup.cmd");

		expect(
			resolveInitialCommand({
				repoPath: sandbox.repoPath,
				projectId: PROJECT_ID,
				homeDir: sandbox.homeDir,
				platform: "win32",
			}),
		).toEqual({
			initialCommand: `"${join(sandbox.repoPath, ".superset", "setup.cmd")}"`,
		});
	});

	it("builds Windows setup fallback commands for native script types", () => {
		expect(
			buildSetupScriptCommand("C:\\work tree\\.superset\\setup.ts", "win32"),
		).toBe('bun "C:\\work tree\\.superset\\setup.ts"');
		expect(
			buildSetupScriptCommand("C:\\work tree\\.superset\\setup.bat", "win32"),
		).toBe('"C:\\work tree\\.superset\\setup.bat"');
		expect(
			buildSetupScriptCommand("C:\\work tree\\.superset\\setup.ps1", "win32"),
		).toBe(
			'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\work tree\\.superset\\setup.ps1"',
		);
	});

	// A lone setup.sh on Windows now runs via bash (the app ships Git Bash
	// handling), matching teardown resolution. `.sh` is the lowest-priority
	// Windows extension, so a portable/native script still wins.
	it("falls back to bash for a lone setup.sh on Windows", () => {
		writeFallbackScript(sandbox.repoPath);

		expect(
			resolveInitialCommand({
				repoPath: sandbox.repoPath,
				projectId: PROJECT_ID,
				homeDir: sandbox.homeDir,
				platform: "win32",
			}),
		).toEqual({
			initialCommand: `bash '${join(sandbox.repoPath, ".superset", "setup.sh")}'`,
		});
	});

	it("uses setup.ts as a POSIX fallback when setup.sh is absent", () => {
		writePortableFallbackScript(sandbox.repoPath);

		expect(
			resolveInitialCommand({
				repoPath: sandbox.repoPath,
				projectId: PROJECT_ID,
				homeDir: sandbox.homeDir,
				platform: "linux",
			}),
		).toEqual({
			initialCommand: `bun '${join(sandbox.repoPath, ".superset", "setup.ts")}'`,
		});
	});

	it("config setup wins over the fallback script", () => {
		writeConfig(sandbox.repoPath, { setup: ["bun install"] });
		writeFallbackScript(sandbox.repoPath);
		expect(resolve()).toEqual({ initialCommand: "bun install" });
	});

	it("carries config cwd for the terminal session", () => {
		writeConfig(sandbox.repoPath, { setup: ["bun install"], cwd: "apps/web" });
		expect(resolve()).toEqual({
			initialCommand: "bun install",
			cwd: "apps/web",
		});
	});

	it("ignores teardown when resolving the setup command", () => {
		writeConfig(sandbox.repoPath, {
			setup: [],
			teardown: ["docker compose down"],
		});
		expect(resolve()).toBeNull();
	});

	it("filters whitespace-only setup entries", () => {
		writeConfig(sandbox.repoPath, {
			setup: ["", "   ", "bun install", "\n"],
		});
		expect(resolve()).toEqual({ initialCommand: "bun install" });
	});

	it("escapes single quotes in fallback path", () => {
		const sandboxWithQuote = createSandbox();
		try {
			const trickyRepo = join(sandboxWithQuote.repoPath, "it's a repo");
			writeFallbackScript(trickyRepo);
			const cmd = resolveInitialCommand({
				repoPath: trickyRepo,
				projectId: PROJECT_ID,
				homeDir: sandboxWithQuote.homeDir,
				platform: "linux",
			})?.initialCommand;
			expect(cmd).toContain("'\\''");
			// Verify the escape sequence wraps the single quote correctly.
			expect(cmd).toBe(
				`bash '${join(trickyRepo, ".superset", "setup.sh").replace("'", "'\\''")}'`,
			);
		} finally {
			sandboxWithQuote.cleanup();
		}
	});

	it("worktree config wins over the main repo's when in scope", () => {
		writeConfig(sandbox.repoPath, { setup: ["from-main"] });
		const worktreePath = join(sandbox.repoPath, "..", "feature-worktree");
		writeConfig(worktreePath, { setup: ["from-worktree"] });

		expect(
			resolveInitialCommand({
				repoPath: sandbox.repoPath,
				projectId: PROJECT_ID,
				worktreePath,
				homeDir: sandbox.homeDir,
			}),
		).toEqual({ initialCommand: "from-worktree" });
	});

	it("falls back to the worktree setup.sh before the main repo's", () => {
		writeFallbackScript(sandbox.repoPath);
		const worktreePath = join(sandbox.repoPath, "..", "feature-worktree");
		writeFallbackScript(worktreePath);

		expect(
			resolveInitialCommand({
				repoPath: sandbox.repoPath,
				projectId: PROJECT_ID,
				worktreePath,
				homeDir: sandbox.homeDir,
				platform: "linux",
			}),
		).toEqual({
			initialCommand: `bash '${join(worktreePath, ".superset", "setup.sh")}'`,
		});
	});
});
