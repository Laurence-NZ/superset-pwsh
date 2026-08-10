import { rm } from "node:fs/promises";
import { defineWorkerTask } from "../define-worker-task.ts";

const RECURSIVE_REMOVE_OPTIONS = {
	recursive: true,
	force: true,
	maxRetries: 5,
	retryDelay: 100,
} as const;

export async function removeDirectoryWithRetries(
	path: string,
	remove: typeof rm = rm,
): Promise<void> {
	await remove(path, RECURSIVE_REMOVE_OPTIONS);
}

export const removeDirectoryTask = defineWorkerTask<
	{ path: string },
	Record<string, never>
>({
	type: "filesystem/removeDirectory",
	handler: async ({ path }) => {
		await removeDirectoryWithRetries(path);
		return {};
	},
});

export const filesystemTasks = [removeDirectoryTask];
