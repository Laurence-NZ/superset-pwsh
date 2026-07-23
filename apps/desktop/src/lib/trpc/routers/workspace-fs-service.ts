import { existsSync } from "node:fs";
import path from "node:path";
import {
	createFsHostService,
	type FsHostService,
	FsWatcherManager,
	SubprocessWatcherManager,
} from "@superset/workspace-fs/host";
import { shell } from "electron";
import { getWorkspace } from "./workspaces/utils/db-helpers";
import { execWithShellEnv } from "./workspaces/utils/shell-env";
import { getWorkspacePath } from "./workspaces/utils/worktree";

// win32: isolate @parcel/watcher's crash-prone native backend in a child
// process (see docs/windows-crash-forensics.md). Other platforms keep the
// in-process native watcher. fs-watcher-subprocess.js is emitted side-by-side
// with the main bundle (__dirname === dist/main).
function createWatcherManager(): Pick<FsWatcherManager, "subscribe" | "close"> {
	if (process.platform !== "win32") {
		return new FsWatcherManager();
	}
	const scriptPath =
		process.env.SUPERSET_FS_WATCHER_SCRIPT_PATH ??
		path.join(__dirname, "fs-watcher-subprocess.js");
	if (!existsSync(scriptPath)) {
		console.error(
			`[fs-watcher] subprocess script not found at ${scriptPath}; falling back to in-process watcher (crash risk)`,
		);
		return new FsWatcherManager();
	}
	return new SubprocessWatcherManager({ scriptPath });
}

const filesystemWatcherManager = createWatcherManager();

const sharedHostServiceOptions = {
	trashItem: async (absolutePath: string) => {
		await shell.trashItem(absolutePath);
	},
	runRipgrep: async (
		args: string[],
		options: { cwd: string; maxBuffer: number },
	) => {
		const result = await execWithShellEnv("rg", args, {
			cwd: options.cwd,
			maxBuffer: options.maxBuffer,
			windowsHide: true,
		});
		return { stdout: result.stdout };
	},
};

export function resolveWorkspaceRootPath(workspaceId: string): string {
	const workspace = getWorkspace(workspaceId);
	if (!workspace) {
		throw new Error(`Workspace not found: ${workspaceId}`);
	}

	const rootPath = getWorkspacePath(workspace);
	if (!rootPath) {
		throw new Error(`Workspace path not found: ${workspaceId}`);
	}

	return rootPath;
}

const serviceCache = new Map<string, FsHostService>();

export function getServiceForRootPath(rootPath: string): FsHostService {
	let service = serviceCache.get(rootPath);
	if (!service) {
		service = createFsHostService({
			rootPath,
			watcherManager: filesystemWatcherManager,
			...sharedHostServiceOptions,
		});
		serviceCache.set(rootPath, service);
	}
	return service;
}

export function getServiceForWorkspace(workspaceId: string): FsHostService {
	return getServiceForRootPath(resolveWorkspaceRootPath(workspaceId));
}

export function toRegisteredWorktreeRelativePath(
	worktreePath: string,
	absolutePath: string,
): string {
	const normalizedWorktreePath = path.resolve(worktreePath);
	const normalizedAbsolutePath = path.resolve(absolutePath);
	const relativePath = path.relative(
		normalizedWorktreePath,
		normalizedAbsolutePath,
	);

	if (
		relativePath === "" ||
		relativePath === "." ||
		relativePath === ".." ||
		relativePath.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relativePath)
	) {
		throw new Error(`Path is outside worktree: ${absolutePath}`);
	}

	return relativePath.replace(/\\/g, "/");
}
