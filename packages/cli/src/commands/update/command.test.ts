import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import cliConfig from "../../../cli.config";
import updateCommand, {
	buildWindowsDeferredReplaceScript,
	cliBinaryNameForTarget,
	detectTargetFor,
	isCliSelfUpdateSupported,
} from "./command";

function invoke() {
	return updateCommand.run({
		ctx: {} as never,
		args: {} as never,
		options: {} as never,
		signal: new AbortController().signal,
	});
}

afterEach(() => {
	delete process.env.SUPERSET_CLI_CHANNEL;
});

describe("update", () => {
	test("refuses to run from the desktop-bundled CLI", async () => {
		process.env.SUPERSET_CLI_CHANNEL = "desktop-bundled";
		await expect(invoke()).rejects.toThrow(
			/bundled with the Superset desktop app/,
		);
	});

	test("standalone dev builds hit the dev-build guard instead", async () => {
		const expectedError =
			process.platform === "win32"
				? /not available on Windows/
				: /only available in built binaries/;
		await expect(invoke()).rejects.toThrow(expectedError);
	});
});

describe("update command platform helpers", () => {
	test("detects the Windows CLI artifact target", () => {
		expect(detectTargetFor("win32", "x64")).toBe("win32-x64");
		expect(() => detectTargetFor("win32", "arm64")).toThrow(
			"Unsupported platform: win32/arm64",
		);
	});

	test("uses the Windows executable name for Windows CLI archives", () => {
		expect(cliBinaryNameForTarget("win32-x64")).toBe("superset.exe");
		expect(cliBinaryNameForTarget("darwin-arm64")).toBe("superset");
		expect(cliBinaryNameForTarget("linux-x64")).toBe("superset");
	});

	test("leaves Windows desktop updates owned by electron-updater", () => {
		expect(isCliSelfUpdateSupported("win32")).toBe(false);
		expect(isCliSelfUpdateSupported("darwin")).toBe(true);
		expect(isCliSelfUpdateSupported("linux")).toBe(true);
	});

	test("builds a deferred Windows replacement script for locked binaries", () => {
		const script = buildWindowsDeferredReplaceScript({
			installRoot: String.raw`C:\Tools 100%\superset`,
			newRoot: String.raw`C:\Tools 100%\superset.update-1\superset-win32-x64`,
			tempDir: String.raw`C:\Tools 100%\superset.update-1`,
			parentPid: 12345,
		});

		expect(script).toContain('set "PARENT_PID=12345"');
		expect(script).toContain(
			String.raw`set "INSTALL_ROOT=C:\Tools 100%%\superset"`,
		);
		expect(script).toContain("tasklist.exe");
		expect(script).toContain('move /Y "%NEW_ROOT%" "%INSTALL_ROOT%"');
		expect(script).toContain('rmdir /S /Q "%TEMP_DIR%"');
	});
});

// Release binaries get SUPERSET_CLI_CHANNEL via build-time define replacement,
// not runtime env. Assert that wiring statically so a regression cannot slip
// past the runtime-env tests above.
describe("channel build wiring", () => {
	test("cli.config.ts bakes SUPERSET_CLI_CHANNEL, defaulting to standalone", () => {
		expect(cliConfig.define?.["process.env.SUPERSET_CLI_CHANNEL"]).toBe(
			JSON.stringify("standalone"),
		);
	});

	test("desktop bundled-CLI build sets the desktop-bundled channel", () => {
		// Importing the script would run it and trips the CLI tsconfig rootDir,
		// so assert against its source instead.
		const buildScript = readFileSync(
			new URL(
				"../../../../../apps/desktop/scripts/build-bundled-cli.ts",
				import.meta.url,
			),
			"utf8",
		);
		expect(buildScript).toMatch(
			/SUPERSET_CLI_CHANNEL\s*[:=]\s*"desktop-bundled"/,
		);
	});
});
