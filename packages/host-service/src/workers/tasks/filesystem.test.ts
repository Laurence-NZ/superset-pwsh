import { expect, test } from "bun:test";
import { removeDirectoryWithRetries } from "./filesystem.ts";

test("recursive removal retries transient filesystem locks", async () => {
	let receivedPath: string | undefined;
	let receivedOptions: Parameters<typeof import("node:fs/promises").rm>[1];

	await removeDirectoryWithRetries(
		"C:\\sessions\\example",
		async (path, options) => {
			receivedPath = path.toString();
			receivedOptions = options;
		},
	);

	expect(receivedPath).toBe("C:\\sessions\\example");
	expect(receivedOptions).toEqual({
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
});
