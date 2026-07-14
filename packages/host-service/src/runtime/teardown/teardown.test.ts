import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildTeardownCommandFromCommands,
	buildTeardownInitialCommand,
	resolveTeardownCommand,
} from "./teardown";

function isFishAvailable(): boolean {
	const result = spawnSync("fish", ["-c", "exit 0"], { stdio: "ignore" });
	return result.status === 0;
}

describe("teardown initial command", () => {
	test("uses exec instead of shell-specific exit status syntax", () => {
		const command = buildTeardownInitialCommand(
			"/tmp/worktree/.superset/teardown.sh",
			undefined,
			"linux",
		);

		expect(command).toBe("exec bash '/tmp/worktree/.superset/teardown.sh'");
		expect(command).not.toContain("$?");
	});

	test("builds a cmd-compatible Bun teardown command", () => {
		const command = buildTeardownInitialCommand(
			"C:\\worktree\\.superset\\teardown.ts",
			"cmd.exe",
		);

		expect(command).toBe(
			'bun "C:\\worktree\\.superset\\teardown.ts" && exit /b 0 || exit /b 1',
		);
	});

	test("builds a PowerShell-compatible Bun teardown command", () => {
		const command = buildTeardownInitialCommand(
			"C:\\work tree\\.superset\\teardown.ts",
			"powershell.exe",
		);

		expect(command).toBe(
			"bun 'C:\\work tree\\.superset\\teardown.ts'; exit $LASTEXITCODE",
		);
	});

	test("builds cmd-compatible Windows native teardown commands", () => {
		expect(
			buildTeardownInitialCommand(
				"C:\\work tree\\.superset\\teardown.cmd",
				"cmd.exe",
				"win32",
			),
		).toBe(
			'"C:\\work tree\\.superset\\teardown.cmd" && exit /b 0 || exit /b 1',
		);

		expect(
			buildTeardownInitialCommand(
				"C:\\work tree\\.superset\\teardown.ps1",
				"cmd.exe",
				"win32",
			),
		).toBe(
			'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\work tree\\.superset\\teardown.ps1" && exit /b 0 || exit /b 1',
		);
	});

	test("builds PowerShell-compatible Windows native teardown commands", () => {
		expect(
			buildTeardownInitialCommand(
				"C:\\work tree\\.superset\\teardown.cmd",
				"powershell.exe",
				"win32",
			),
		).toBe(
			"cmd.exe /d /s /c '\"C:\\work tree\\.superset\\teardown.cmd\"'; exit $LASTEXITCODE",
		);

		expect(
			buildTeardownInitialCommand(
				"C:\\work tree\\.superset\\teardown.ps1",
				"powershell.exe",
				"win32",
			),
		).toBe(
			"powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\\work tree\\.superset\\teardown.ps1'; exit $LASTEXITCODE",
		);
	});

	test("configured-command form runs via `bash -c` and avoids $?", () => {
		const command = buildTeardownCommandFromCommands(
			["docker compose down", "rm -rf .cache"],
			undefined,
			"linux",
		);

		expect(command).toBe("exec bash -c 'docker compose down && rm -rf .cache'");
		expect(command).not.toContain("$?");
	});

	test("configured-command form single-quote-escapes the command", () => {
		expect(
			buildTeardownCommandFromCommands(["echo 'bye'"], undefined, "linux"),
		).toBe("exec bash -c 'echo '\\''bye'\\'''");
	});

	test("configured-command form chains for cmd.exe with exit propagation", () => {
		expect(
			buildTeardownCommandFromCommands(
				["docker compose down", "rd /s /q .cache"],
				"cmd.exe",
				"win32",
			),
		).toBe("docker compose down && rd /s /q .cache && exit /b 0 || exit /b 1");
	});

	test("exits fish with the teardown script status", () => {
		if (!isFishAvailable()) return;

		const root = mkdtempSync(join(tmpdir(), "host-service-teardown-"));
		const dirWithQuote = join(root, "quote's dir");
		const scriptPath = join(dirWithQuote, "teardown.sh");

		try {
			mkdirSync(dirWithQuote, { recursive: true });
			writeFileSync(scriptPath, "#!/usr/bin/env bash\nexit 7\n", {
				mode: 0o755,
			});
			chmodSync(scriptPath, 0o755);

			const result = spawnSync("fish", [
				"-c",
				buildTeardownInitialCommand(scriptPath, undefined, "linux"),
			]);

			expect(result.status).toBe(7);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("resolveTeardownCommand", () => {
	function makeSandbox(): {
		repoPath: string;
		homeDir: string;
		cleanup: () => void;
	} {
		const root = mkdtempSync(join(tmpdir(), "host-service-teardown-resolve-"));
		const repoPath = join(root, "repo");
		const homeDir = join(root, "home");
		mkdirSync(join(repoPath, ".superset"), { recursive: true });
		mkdirSync(homeDir, { recursive: true });
		return {
			repoPath,
			homeDir,
			cleanup: () => rmSync(root, { recursive: true, force: true }),
		};
	}

	function writeConfig(repoPath: string, config: unknown): void {
		writeFileSync(
			join(repoPath, ".superset", "config.json"),
			JSON.stringify(config),
		);
	}

	// Reproduces #5486: configured `teardown` commands must run on delete.
	// Before the fix, teardown never consulted the resolved config and
	// silently skipped when no teardown.sh script existed.
	test("runs configured teardown commands from .superset/config.json", () => {
		const sb = makeSandbox();
		try {
			writeConfig(sb.repoPath, {
				setup: ["bash setup.sh"],
				teardown: ["docker compose down", "bash teardown.sh"],
			});

			const resolved = resolveTeardownCommand({
				repoPath: sb.repoPath,
				projectId: "proj-1",
				worktreePath: join(sb.repoPath, ".worktrees", "feature"),
				homeDir: sb.homeDir,
				platform: "linux",
			});

			expect(resolved).toEqual({
				initialCommand:
					"exec bash -c 'docker compose down && bash teardown.sh'",
			});
		} finally {
			sb.cleanup();
		}
	});

	test("configured teardown takes precedence over a teardown.sh script", () => {
		const sb = makeSandbox();
		try {
			writeConfig(sb.repoPath, { teardown: ["echo configured"] });
			writeFileSync(
				join(sb.repoPath, ".superset", "teardown.sh"),
				"#!/usr/bin/env bash\n",
			);

			const resolved = resolveTeardownCommand({
				repoPath: sb.repoPath,
				projectId: "proj-1",
				worktreePath: join(sb.repoPath, ".worktrees", "feature"),
				homeDir: sb.homeDir,
				platform: "linux",
			});

			expect(resolved).toEqual({
				initialCommand: "exec bash -c 'echo configured'",
			});
		} finally {
			sb.cleanup();
		}
	});

	test("falls back to <repoPath>/.superset/teardown.sh when no teardown is configured", () => {
		const sb = makeSandbox();
		try {
			// Config exists but only defines setup — teardown must fall back.
			// The main repo is the source, matching setup.sh resolution:
			// gitignored scripts don't exist in worktrees.
			writeConfig(sb.repoPath, { setup: ["bash setup.sh"] });
			const scriptPath = join(sb.repoPath, ".superset", "teardown.sh");
			writeFileSync(scriptPath, "#!/usr/bin/env bash\n");

			const resolved = resolveTeardownCommand({
				repoPath: sb.repoPath,
				projectId: "proj-1",
				worktreePath: join(sb.repoPath, ".worktrees", "feature"),
				homeDir: sb.homeDir,
				platform: "linux",
			});

			expect(resolved).toEqual({ initialCommand: `exec bash '${scriptPath}'` });
		} finally {
			sb.cleanup();
		}
	});

	test("worktree teardown.sh wins over the main repo copy", () => {
		const sb = makeSandbox();
		try {
			writeFileSync(
				join(sb.repoPath, ".superset", "teardown.sh"),
				"#!/usr/bin/env bash\n",
			);
			const worktreePath = join(sb.repoPath, ".worktrees", "feature");
			mkdirSync(join(worktreePath, ".superset"), { recursive: true });
			const worktreeScript = join(worktreePath, ".superset", "teardown.sh");
			writeFileSync(worktreeScript, "#!/usr/bin/env bash\n");

			const resolved = resolveTeardownCommand({
				repoPath: sb.repoPath,
				projectId: "proj-1",
				worktreePath,
				homeDir: sb.homeDir,
				platform: "linux",
			});

			expect(resolved).toEqual({
				initialCommand: `exec bash '${worktreeScript}'`,
			});
		} finally {
			sb.cleanup();
		}
	});

	test("prefers portable teardown.ts on Windows, teardown.sh elsewhere", () => {
		const sb = makeSandbox();
		try {
			const dir = join(sb.repoPath, ".superset");
			writeFileSync(join(dir, "teardown.sh"), "#!/usr/bin/env bash\n");
			writeFileSync(join(dir, "teardown.ts"), "console.log('bye');\n");
			const worktreePath = join(sb.repoPath, ".worktrees", "feature");

			expect(
				resolveTeardownCommand({
					repoPath: sb.repoPath,
					projectId: "proj-1",
					worktreePath,
					homeDir: sb.homeDir,
					platform: "win32",
					shell: "cmd.exe",
				}),
			).toEqual({
				initialCommand: `bun "${join(dir, "teardown.ts")}" && exit /b 0 || exit /b 1`,
			});

			expect(
				resolveTeardownCommand({
					repoPath: sb.repoPath,
					projectId: "proj-1",
					worktreePath,
					homeDir: sb.homeDir,
					platform: "linux",
				}),
			).toEqual({
				initialCommand: `exec bash '${join(dir, "teardown.sh")}'`,
			});
		} finally {
			sb.cleanup();
		}
	});

	test("discovers Windows-native teardown scripts on Windows", () => {
		const sb = makeSandbox();
		try {
			const dir = join(sb.repoPath, ".superset");
			writeFileSync(join(dir, "teardown.ps1"), "Write-Output bye\n");
			writeFileSync(join(dir, "teardown.cmd"), "@echo off\r\necho bye\r\n");
			const worktreePath = join(sb.repoPath, ".worktrees", "feature");

			expect(
				resolveTeardownCommand({
					repoPath: sb.repoPath,
					projectId: "proj-1",
					worktreePath,
					homeDir: sb.homeDir,
					platform: "win32",
					shell: "cmd.exe",
				}),
			).toEqual({
				initialCommand: `"${join(dir, "teardown.cmd")}" && exit /b 0 || exit /b 1`,
			});

			// No .sh/.ts, so nothing runnable on POSIX.
			expect(
				resolveTeardownCommand({
					repoPath: sb.repoPath,
					projectId: "proj-1",
					worktreePath,
					homeDir: sb.homeDir,
					platform: "linux",
				}),
			).toBeNull();
		} finally {
			sb.cleanup();
		}
	});

	test("carries config cwd for the teardown session", () => {
		const sb = makeSandbox();
		try {
			writeConfig(sb.repoPath, {
				teardown: ["docker compose down"],
				cwd: "apps/web",
			});

			const resolved = resolveTeardownCommand({
				repoPath: sb.repoPath,
				projectId: "proj-1",
				worktreePath: join(sb.repoPath, ".worktrees", "feature"),
				homeDir: sb.homeDir,
				platform: "linux",
			});

			expect(resolved).toEqual({
				initialCommand: "exec bash -c 'docker compose down'",
				cwd: "apps/web",
			});
		} finally {
			sb.cleanup();
		}
	});

	test("returns null (skipped) when neither config nor script provides a teardown", () => {
		const sb = makeSandbox();
		try {
			const resolved = resolveTeardownCommand({
				repoPath: sb.repoPath,
				projectId: "proj-1",
				worktreePath: join(sb.repoPath, ".worktrees", "feature"),
				homeDir: sb.homeDir,
				platform: "linux",
			});

			expect(resolved).toBeNull();
		} finally {
			sb.cleanup();
		}
	});
});
