import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
	checkWindowsNativeBuildPrerequisites,
	formatWindowsNativeBuildPrereqError,
} from "./windows-native-build-prereqs";

if (process.env.SUPERSET_SKIP_DESKTOP_INSTALL_DEPS) {
	console.log(
		"[install:deps] Skipping desktop native dependency rebuild because SUPERSET_SKIP_DESKTOP_INSTALL_DEPS is set.",
	);
	process.exit(0);
}

const prereqCheck = checkWindowsNativeBuildPrerequisites();
if (!prereqCheck.ok) {
	console.error(
		formatWindowsNativeBuildPrereqError(prereqCheck, "install:deps"),
	);
	process.exit(1);
}

// node-pty's vendored winpty.gyp runs `cmd /c "cd shared && GetCommitHash.bat"`
// with a bare (unqualified) batch name. When NoDefaultCurrentDirectoryInExePath
// is set (common under Windows security policy) cmd won't resolve executables in
// the current directory, so the .bat is "not recognized" and the rebuild fails.
// Drop it for the build subprocess only.
const childEnv = { ...process.env };
delete childEnv.NoDefaultCurrentDirectoryInExePath;

/**
 * electron-builder rebuilds node-pty from source for Electron. The rebuilt
 * conpty.node lives in build/Release, while node-pty resolves its optional
 * modern ConPTY DLL relative to that binary. The package only ships those
 * runtime assets in prebuilds, so mirror them after the rebuild.
 */
function installNodePtyConptyAssets(): void {
	if (process.platform !== "win32") return;

	const requireFromDesktop = createRequire(
		join(import.meta.dirname, "..", "package.json"),
	);
	const requireFromPtyDaemon = createRequire(
		join(
			import.meta.dirname,
			"..",
			"..",
			"..",
			"packages",
			"pty-daemon",
			"package.json",
		),
	);
	const nodePtyDirs = new Set(
		[requireFromDesktop, requireFromPtyDaemon].map((requireFrom) =>
			dirname(requireFrom.resolve("node-pty/package.json")),
		),
	);
	const assets = ["conpty.dll", "OpenConsole.exe"];

	for (const nodePtyDir of nodePtyDirs) {
		const sourceDir = join(
			nodePtyDir,
			"prebuilds",
			`${process.platform}-${process.arch}`,
			"conpty",
		);
		const targetDir = join(nodePtyDir, "build", "Release", "conpty");

		for (const asset of assets) {
			const source = join(sourceDir, asset);
			if (!existsSync(source)) {
				throw new Error(
					`node-pty ${asset} is missing from its prebuild assets: ${source}`,
				);
			}
		}

		mkdirSync(targetDir, { recursive: true });
		for (const asset of assets) {
			copyFileSync(join(sourceDir, asset), join(targetDir, asset));
		}
		console.log(
			`[install:deps] Installed node-pty modern ConPTY assets in ${targetDir}`,
		);
	}
}

const result = spawnSync("bun", ["x", "electron-builder", "install-app-deps"], {
	encoding: "utf8",
	shell: false,
	env: childEnv,
});

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");

if (result.error) {
	console.error(
		`[install:deps] Failed to run electron-builder: ${result.error.message}`,
	);
	process.exit(1);
}

if (result.status === 0) {
	try {
		installNodePtyConptyAssets();
	} catch (error) {
		console.error(
			`[install:deps] Failed to install node-pty ConPTY assets: ${(error as Error).message}`,
		);
		process.exit(1);
	}
	process.exit(0);
}

if (process.platform === "win32" && output.includes("MSB8040")) {
	console.error(
		[
			"",
			"[install:deps] Windows native rebuild failed because Visual Studio Spectre-mitigated libraries are missing.",
			"Install them from Visual Studio Installer > Build Tools 2022 > Individual components:",
			"- MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs",
			"- Windows 10 or Windows 11 SDK",
			"",
			"After installing, rerun `bun run --cwd apps/desktop install:deps`.",
			"Set SUPERSET_SKIP_DESKTOP_INSTALL_DEPS=1 only when you intentionally want `bun install` to skip Electron native rebuilds.",
		].join("\n"),
	);
}

process.exit(result.status ?? 1);
