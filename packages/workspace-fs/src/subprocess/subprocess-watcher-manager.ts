// Parent-side stand-in for FsWatcherManager that runs the real manager in a
// child process (see run-subprocess.ts for why). Implements the same
// `subscribe` / `close` surface `createFsHostService` depends on, so it drops
// in wherever `new FsWatcherManager()` is used, behind a win32 gate.
//
// The child owns the native @parcel/watcher subscription; if its
// ReadDirectoryChangesW backend faults (native use-after-free, 0xC0000005), the
// child dies and this supervisor respawns it and re-subscribes every live
// watch — the host-service (and the app) survive. See
// docs/windows-crash-forensics.md.

import { type ChildProcess, spawn } from "node:child_process";
import { normalizeAbsolutePath } from "../paths";
import {
	invalidateSearchIndexesForRoot,
	patchSearchIndexesForRoot,
	type SearchPatchEvent,
} from "../search";
import type { FsWatchEvent } from "../types";
import type { FsWatcherRequest, FsWatcherResponse } from "./protocol";

type WatchBatchListener = (batch: { events: FsWatchEvent[] }) => void;

interface Subscription {
	absolutePath: string;
	listener: WatchBatchListener;
	/** Resolvers for the first subscribe() call, pending its initial ack. */
	pending: {
		resolve: (unsubscribe: () => Promise<void>) => void;
		reject: (error: unknown) => void;
	} | null;
}

export interface SubprocessWatcherManagerOptions {
	/** Absolute path to the built fs-watcher-subprocess entry script. */
	scriptPath: string;
	/** Node/Electron binary to run the script with. Defaults to process.execPath. */
	execPath?: string;
	/** Extra env for the child (merged over process.env + ELECTRON_RUN_AS_NODE). */
	env?: NodeJS.ProcessEnv;
	/** Test seam: override how the child is spawned. */
	spawnChild?: () => ChildProcess;
	/** Delay before respawning a crashed child. Defaults to 300ms. */
	respawnDelayMs?: number;
}

// Crash-loop guard: if the child dies this many times within the window, stop
// respawning (a persistent fault would otherwise spin forever burning CPU).
const RESTART_WINDOW_MS = 60_000;
const MAX_RESTARTS_PER_WINDOW = 5;
const RESPAWN_DELAY_MS = 300;

export class SubprocessWatcherManager {
	private readonly opts: SubprocessWatcherManagerOptions;
	private child: ChildProcess | null = null;
	private childReady = false;
	private closed = false;
	private crashLoopStopped = false;
	private nextId = 0;
	private readonly subs = new Map<number, Subscription>();
	private restartTimes: number[] = [];
	private respawnTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(options: SubprocessWatcherManagerOptions) {
		this.opts = options;
	}

	async subscribe(
		options: { absolutePath: string },
		listener: WatchBatchListener,
	): Promise<() => Promise<void>> {
		if (this.closed) {
			throw new Error("SubprocessWatcherManager is closed");
		}
		const absolutePath = normalizeAbsolutePath(options.absolutePath);
		const id = ++this.nextId;

		return await new Promise<() => Promise<void>>((resolve, reject) => {
			this.subs.set(id, {
				absolutePath,
				listener,
				pending: { resolve, reject },
			});
			this.ensureChild();
			if (this.childReady) {
				this.post({ type: "subscribe", id, absolutePath });
			}
			// else: sent for every live sub once the child emits "ready".
		});
	}

	async close(): Promise<void> {
		this.closed = true;
		if (this.respawnTimer) {
			clearTimeout(this.respawnTimer);
			this.respawnTimer = null;
		}
		for (const sub of this.subs.values()) {
			sub.pending?.reject(new Error("watcher manager closed"));
		}
		this.subs.clear();
		const child = this.child;
		this.child = null;
		this.childReady = false;
		if (child) {
			try {
				child.send({ type: "close" } satisfies FsWatcherRequest);
			} catch {
				// channel already gone — kill covers it
			}
			child.kill();
		}
	}

	private ensureChild(): void {
		if (this.child || this.closed || this.crashLoopStopped) {
			return;
		}
		const child =
			this.opts.spawnChild?.() ??
			spawn(this.opts.execPath ?? process.execPath, [this.opts.scriptPath], {
				stdio: ["ignore", "inherit", "inherit", "ipc"],
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...this.opts.env },
				windowsHide: true,
			});
		this.child = child;
		this.childReady = false;

		child.on("message", (raw: FsWatcherResponse) => this.onMessage(raw));
		child.on("error", (error) => {
			console.error("[fs-watcher] child process error:", error);
		});
		child.on("exit", (code, signal) => this.onChildExit(child, code, signal));
	}

	private onMessage(message: FsWatcherResponse): void {
		switch (message.type) {
			case "ready":
				this.childReady = true;
				// (Re)establish every live subscription on the current child.
				for (const [id, sub] of this.subs) {
					this.post({ type: "subscribe", id, absolutePath: sub.absolutePath });
				}
				return;
			case "subscribed": {
				const sub = this.subs.get(message.id);
				if (sub?.pending) {
					sub.pending.resolve(() => this.unsubscribe(message.id));
					sub.pending = null;
				}
				return;
			}
			case "subscribe-error": {
				const sub = this.subs.get(message.id);
				console.error("[fs-watcher] subscribe failed:", {
					absolutePath: sub?.absolutePath,
					error: message.message,
				});
				if (sub?.pending) {
					sub.pending.reject(new Error(message.message));
					sub.pending = null;
					this.subs.delete(message.id);
				}
				return;
			}
			case "events": {
				const sub = this.subs.get(message.id);
				if (!sub) {
					return;
				}
				this.patchSearchIndex(sub.absolutePath, message.events);
				sub.listener({ events: message.events });
				return;
			}
		}
	}

	private async unsubscribe(id: number): Promise<void> {
		const sub = this.subs.get(id);
		if (!sub) {
			return;
		}
		this.subs.delete(id);
		if (this.child && this.childReady) {
			this.post({ type: "unsubscribe", id });
		}
		// Last watch gone: let the idle child exit so we don't hold a process open.
		if (this.subs.size === 0 && this.child) {
			this.post({ type: "close" });
		}
	}

	private onChildExit(
		child: ChildProcess,
		code: number | null,
		signal: NodeJS.Signals | null,
	): void {
		if (child !== this.child) {
			return; // superseded by a newer child
		}
		this.child = null;
		this.childReady = false;
		if (this.closed || this.subs.size === 0) {
			return;
		}

		const now = Date.now();
		this.restartTimes = this.restartTimes.filter(
			(t) => now - t < RESTART_WINDOW_MS,
		);
		this.restartTimes.push(now);
		if (this.restartTimes.length > MAX_RESTARTS_PER_WINDOW) {
			this.crashLoopStopped = true;
			console.error(
				`[fs-watcher] child crashed ${this.restartTimes.length} times in ${
					RESTART_WINDOW_MS / 1000
				}s (exit code=${code} signal=${signal}); giving up — file watching disabled until restart`,
			);
			for (const sub of this.subs.values()) {
				sub.pending?.reject(new Error("fs-watcher child crash-looped"));
			}
			return;
		}

		console.error(
			`[fs-watcher] child exited (code=${code} signal=${signal}); respawning and re-subscribing ${this.subs.size} watch(es)`,
		);
		// Events were dropped while the child was down: invalidate each root's
		// search index and nudge consumers to refetch. Re-subscribe happens on
		// the new child's "ready".
		for (const sub of this.subs.values()) {
			invalidateSearchIndexesForRoot(sub.absolutePath);
			sub.listener({
				events: [
					{ kind: "create", absolutePath: sub.absolutePath, isDirectory: true },
				],
			});
		}
		this.respawnTimer = setTimeout(() => {
			this.respawnTimer = null;
			this.ensureChild();
		}, this.opts.respawnDelayMs ?? RESPAWN_DELAY_MS);
		this.respawnTimer.unref?.();
	}

	private patchSearchIndex(rootPath: string, events: FsWatchEvent[]): void {
		const patches: SearchPatchEvent[] = [];
		for (const event of events) {
			if (event.kind === "overflow") {
				continue;
			}
			patches.push({
				kind: event.kind,
				absolutePath: event.absolutePath,
				oldAbsolutePath: event.oldAbsolutePath,
				isDirectory: event.isDirectory ?? false,
			});
		}
		patchSearchIndexesForRoot(rootPath, patches);
	}

	private post(message: FsWatcherRequest): void {
		try {
			this.child?.send(message);
		} catch (error) {
			console.error("[fs-watcher] failed to message child:", error);
		}
	}
}
