import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "@superset/pty-daemon";
import { disposeDaemonClient } from "../../src/terminal/daemon-client-singleton";
import {
	initTerminalBaseEnv,
	resetTerminalBaseEnvForTests,
} from "../../src/terminal/env";
import { __resetSessionsForTesting } from "../../src/terminal/terminal";
import { __setAccountShellForTesting } from "../../src/terminal/user-shell";
import { cloudFlows } from "../helpers/cloud-fakes";
import { createFishLikePtySpawner, shellQuote } from "../helpers/fake-pty";
import { makeTestDaemonSocketPath } from "../helpers/platform";
import {
	createFeatureWorktreeScenario,
	type FeatureWorktreeScenario,
} from "../helpers/scenarios";

/**
 * Regression coverage for #6174: the external delete surface (CLI/SDK/MCP →
 * `workspace.delete`) hardcodes `force: true` for its non-interactive git
 * semantics, but teardown must still run — silently skipping it leaks the
 * resources the script provisions.
 */
describe("workspace delete teardown integration", () => {
	let scenario: FeatureWorktreeScenario | null = null;
	let server: Server | null = null;
	let tmp: string | null = null;

	afterEach(async () => {
		__resetSessionsForTesting();
		await disposeDaemonClient();
		resetTerminalBaseEnvForTests();
		__setAccountShellForTesting(undefined);
		delete process.env.SUPERSET_PTY_DAEMON_SOCKET;
		delete process.env.SUPERSET_HOME_DIR;
		if (server) {
			await server.close().catch(() => {});
			server = null;
		}
		if (scenario) {
			await scenario.dispose();
			scenario = null;
		}
		if (tmp) {
			rmSync(tmp, { recursive: true, force: true });
			tmp = null;
		}
	});

	async function setup(teardownScript: {
		posix: string;
		windows: string;
	}): Promise<{
		scenario: FeatureWorktreeScenario;
		markerPath: string;
	}> {
		tmp = mkdtempSync(join(tmpdir(), "host-service-delete-teardown-it-"));
		const socketPath = makeTestDaemonSocketPath(
			"host-service-delete-teardown-it",
		);
		server = new Server({
			socketPath,
			daemonVersion: "0.0.0-delete-teardown-integration-test",
			spawnPty: createFishLikePtySpawner([]),
		});
		await server.listen();

		process.env.SUPERSET_PTY_DAEMON_SOCKET = socketPath;
		process.env.SUPERSET_HOME_DIR = tmp;
		const shell =
			process.platform === "win32"
				? (process.env.COMSPEC ?? "cmd.exe")
				: "/bin/bash";
		__setAccountShellForTesting(shell);
		initTerminalBaseEnv({
			COMSPEC: process.env.COMSPEC ?? "cmd.exe",
			HOME: process.env.HOME ?? process.env.USERPROFILE ?? tmp,
			LANG: "en_US.UTF-8",
			PATH:
				process.env.PATH ??
				(process.platform === "win32" ? "" : "/usr/bin:/bin"),
			SHELL: shell,
			USERPROFILE: process.env.USERPROFILE ?? tmp,
		});

		scenario = await createFeatureWorktreeScenario({
			hostOptions: { apiOverrides: cloudFlows.workspaceDeleteOk() },
		});
		// Script lives in the main repo (gitignored scripts don't exist in
		// worktrees); the marker lands outside the worktree since step 2b
		// deletes the worktree directory.
		const markerPath = join(tmp, "teardown-ran");
		const scriptDir = join(scenario.repo.repoPath, ".superset");
		mkdirSync(scriptDir, { recursive: true });
		if (process.platform === "win32") {
			writeFileSync(
				join(scriptDir, "teardown.ts"),
				teardownScript.windows
					.replaceAll("{{WORKTREE}}", JSON.stringify(scenario.worktreePath))
					.replaceAll("{{MARKER}}", JSON.stringify(markerPath)),
				"utf-8",
			);
		} else {
			writeFileSync(
				join(scriptDir, "teardown.sh"),
				`#!/usr/bin/env bash\n${teardownScript.posix
					.replaceAll("{{WORKTREE}}", shellQuote(scenario.worktreePath))
					.replaceAll("{{MARKER}}", shellQuote(markerPath))}\n`,
				{ mode: 0o755 },
			);
		}
		return { scenario, markerPath };
	}

	test("workspace.delete (external surface) runs teardown before removing the worktree", async () => {
		// `test -d` pins the ordering: the marker only appears if the worktree
		// still exists when teardown runs.
		const { scenario, markerPath } = await setup({
			posix: "test -d {{WORKTREE}} && printf ran > {{MARKER}}",
			windows:
				'import { existsSync } from "node:fs";\nif (existsSync({{WORKTREE}})) await Bun.write({{MARKER}}, "ran");',
		});

		const result = await scenario.host.trpc.workspace.delete.mutate({
			id: scenario.featureWorkspaceId,
		});

		expect(result.success).toBe(true);
		expect(result.worktreeRemoved).toBe(true);
		expect(result.warnings).toEqual([]);
		expect(existsSync(markerPath)).toBe(true);
		expect(existsSync(scenario.worktreePath)).toBe(false);
	});

	test("workspace.delete surfaces a failed teardown as a warning without blocking the delete", async () => {
		const { scenario, markerPath } = await setup({
			posix:
				'echo "external resources not cleaned" >&2\nprintf ran > {{MARKER}}\nexit 7',
			windows:
				'console.error("external resources not cleaned");\nawait Bun.write({{MARKER}}, "ran");\nprocess.exit(7);',
		});

		const result = await scenario.host.trpc.workspace.delete.mutate({
			id: scenario.featureWorkspaceId,
		});

		expect(result.success).toBe(true);
		expect(result.worktreeRemoved).toBe(true);
		expect(existsSync(markerPath)).toBe(true);
		expect(existsSync(scenario.worktreePath)).toBe(false);
		const teardownWarning = result.warnings.find((w) =>
			w.includes("Teardown script failed (exit code 7)"),
		);
		expect(teardownWarning).toBeDefined();
		// The warning must carry the script's output tail, not just the exit code.
		expect(teardownWarning).toContain("external resources not cleaned");
	});

	test("workspaceCleanup.destroy with force still skips teardown (interactive force-retry contract)", async () => {
		const { scenario, markerPath } = await setup({
			posix: "printf ran > {{MARKER}}",
			windows: 'await Bun.write({{MARKER}}, "ran");',
		});

		const result = await scenario.host.trpc.workspaceCleanup.destroy.mutate({
			workspaceId: scenario.featureWorkspaceId,
			force: true,
		});

		expect(result.success).toBe(true);
		expect(result.worktreeRemoved).toBe(true);
		expect(existsSync(markerPath)).toBe(false);
		expect(existsSync(scenario.worktreePath)).toBe(false);
	});
});
