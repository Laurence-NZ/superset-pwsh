// Child-process entrypoint body for the isolated fs-watcher. Runs the real
// FsWatcherManager and bridges it to the parent over the IPC channel. Kept in
// @superset/workspace-fs so both consumers (host-service and the desktop main
// process) share one implementation; the per-app entry script is a one-liner
// that calls runFsWatcherSubprocess().
//
// Why a child process (not a worker thread): the crash we are isolating is a
// native use-after-free in @parcel/watcher's Windows ReadDirectoryChangesW
// backend, on its own IO-completion thread. A worker thread shares the process,
// so a native fault there still aborts the whole process. Only a separate
// process contains it — when this child dies, the parent respawns it.

import { FsWatcherManager, type FsWatcherManagerOptions } from "../watch";
import type { FsWatcherRequest, FsWatcherResponse } from "./protocol";

export interface RunFsWatcherSubprocessOptions {
	managerOptions?: FsWatcherManagerOptions;
}

/**
 * Wire an FsWatcherManager to the parent over `process.send` / `process.on`.
 * Resolves (effectively never, until close) once the IPC channel closes.
 */
export function runFsWatcherSubprocess(
	options: RunFsWatcherSubprocessOptions = {},
): void {
	const send = process.send?.bind(process);
	if (!send) {
		throw new Error(
			"fs-watcher subprocess started without an IPC channel — spawn it with an 'ipc' stdio slot",
		);
	}
	const post = (message: FsWatcherResponse) => send(message);

	const manager = new FsWatcherManager(options.managerOptions);
	// id → unsubscribe fn for the live subscriptions this child owns.
	const unsubscribers = new Map<number, () => Promise<void>>();

	const shutdown = async () => {
		unsubscribers.clear();
		await manager.close().catch(() => {});
		process.exit(0);
	};

	process.on("message", (raw: FsWatcherRequest) => {
		switch (raw.type) {
			case "subscribe": {
				const { id, absolutePath } = raw;
				void manager
					.subscribe({ absolutePath }, (batch) => {
						post({ type: "events", id, events: batch.events });
					})
					.then((unsubscribe) => {
						// Lost the race with an unsubscribe/close that arrived first.
						if (!process.connected) {
							void unsubscribe();
							return;
						}
						unsubscribers.set(id, unsubscribe);
						post({ type: "subscribed", id });
					})
					.catch((error: unknown) => {
						post({
							type: "subscribe-error",
							id,
							message: error instanceof Error ? error.message : String(error),
						});
					});
				return;
			}
			case "unsubscribe": {
				const unsubscribe = unsubscribers.get(raw.id);
				unsubscribers.delete(raw.id);
				if (unsubscribe) void unsubscribe().catch(() => {});
				return;
			}
			case "close":
				void shutdown();
				return;
		}
	});

	// Parent went away (crash or normal exit): tear down and follow it out.
	process.on("disconnect", () => void shutdown());

	post({ type: "ready" });
}
