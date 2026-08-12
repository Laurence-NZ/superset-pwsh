import { describe, expect, it } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { normalizeAbsolutePath } from "../paths";
import type { FsWatcherRequest, FsWatcherResponse } from "./protocol";
import { SubprocessWatcherManager } from "./subprocess-watcher-manager";

// Watch roots are normalized to native absolute form, which differs by OS
// (POSIX "/repo" vs win32 "D:\\repo"), so compare against the normalized value.
const REPO = normalizeAbsolutePath("/repo");

function nonNull<T>(value: T | undefined | null, label = "value"): T {
	if (value == null) {
		throw new Error(`expected ${label} to be present`);
	}
	return value;
}

// Minimal stand-in for the spawned child: records what the parent sends and
// lets the test drive the child→parent messages and the exit event.
class FakeChild extends EventEmitter {
	readonly sent: FsWatcherRequest[] = [];
	killed = false;
	send(message: FsWatcherRequest): boolean {
		this.sent.push(message);
		return true;
	}
	kill(): boolean {
		this.killed = true;
		return true;
	}
	reply(message: FsWatcherResponse): void {
		this.emit("message", message);
	}
	crash(code = 3221225477): void {
		this.emit("exit", code, null);
	}
	get subscribeRequests(): Array<FsWatcherRequest & { type: "subscribe" }> {
		return this.sent.filter(
			(m): m is FsWatcherRequest & { type: "subscribe" } =>
				m.type === "subscribe",
		);
	}
	firstSubscribeId(): number {
		return nonNull(this.subscribeRequests[0], "subscribe request").id;
	}
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeManager() {
	const spawned: FakeChild[] = [];
	const manager = new SubprocessWatcherManager({
		scriptPath: "/unused",
		respawnDelayMs: 0,
		spawnChild: () => {
			const child = new FakeChild();
			spawned.push(child);
			// Emit "ready" on the next microtask, as a real child would post it async.
			queueMicrotask(() => child.reply({ type: "ready" }));
			return child as unknown as ChildProcess;
		},
	});
	return { manager, spawned };
}

describe("SubprocessWatcherManager", () => {
	it("subscribes once the child is ready and routes events to the listener", async () => {
		const { manager, spawned } = makeManager();
		const batches: Array<{ events: unknown[] }> = [];

		const subscribePromise = manager.subscribe(
			{ absolutePath: "/repo" },
			(batch) => batches.push(batch),
		);
		await tick();

		const child = nonNull(spawned[0], "child");
		const request = nonNull(child.subscribeRequests[0], "subscribe request");
		expect(request.absolutePath).toBe(REPO);

		child.reply({
			type: "subscribed",
			id: request.id,
			prunedRelPrefixes: ["generated-old"],
		});
		await expect(subscribePromise).resolves.toBeInstanceOf(Function);
		expect(manager.isPathPruned("/repo", "/repo/generated-old/app.js")).toBe(
			true,
		);
		expect(manager.isPathPruned("/repo", "/repo/src/app.ts")).toBe(false);

		child.reply({
			type: "events",
			id: request.id,
			events: [
				{ kind: "update", absolutePath: "/repo/a.ts", isDirectory: false },
			],
		});
		expect(batches).toHaveLength(1);
		expect(batches[0]?.events).toHaveLength(1);

		await manager.close();
		expect(child.killed).toBe(true);
	});

	it("respawns and re-subscribes after a crash, nudging the listener to refetch", async () => {
		const { manager, spawned } = makeManager();
		const batches: Array<{ events: Array<{ kind: string }> }> = [];

		const subscribePromise = manager.subscribe(
			{ absolutePath: "/repo" },
			(batch) => batches.push(batch as { events: Array<{ kind: string }> }),
		);
		await tick();
		const first = nonNull(spawned[0], "first child");
		first.reply({
			type: "subscribed",
			id: first.firstSubscribeId(),
			prunedRelPrefixes: [],
		});
		await subscribePromise;

		first.crash();
		await tick();
		await tick();

		// A fresh child was spawned and the live watch re-subscribed on it.
		expect(spawned).toHaveLength(2);
		const second = nonNull(spawned[1], "second child");
		expect(second.subscribeRequests[0]?.absolutePath).toBe(REPO);
		// The listener was nudged with a synthetic root-create so consumers refetch
		// after the events dropped while the child was down.
		expect(batches.at(-1)?.events.at(0)?.kind).toBe("create");

		await manager.close();
	});

	it("refreshes ignore state through the child", async () => {
		const { manager, spawned } = makeManager();
		const subscribePromise = manager.subscribe(
			{ absolutePath: "/repo" },
			() => {},
		);
		await tick();
		const child = nonNull(spawned[0], "child");
		child.reply({
			type: "subscribed",
			id: child.firstSubscribeId(),
			prunedRelPrefixes: ["generated-old"],
		});
		await subscribePromise;

		const refreshPromise = manager.refreshIgnores("/repo");
		const request = nonNull(
			child.sent.find((message) => message.type === "refresh-ignores"),
			"refresh request",
		);
		child.reply({
			type: "ignores-refreshed",
			id: request.id,
			swapped: true,
			prunedRelPrefixes: ["generated-new"],
		});

		await expect(refreshPromise).resolves.toBe(true);
		expect(manager.isPathPruned("/repo", "/repo/generated-old/app.js")).toBe(
			false,
		);
		expect(manager.isPathPruned("/repo", "/repo/generated-new/app.js")).toBe(
			true,
		);
		await manager.close();
	});

	it("stops respawning after a crash loop", async () => {
		const { manager, spawned } = makeManager();

		const subscribePromise = manager.subscribe(
			{ absolutePath: "/repo" },
			() => {},
		);
		await tick();
		const first = nonNull(spawned[0], "first child");
		first.reply({
			type: "subscribed",
			id: first.firstSubscribeId(),
			prunedRelPrefixes: [],
		});
		await subscribePromise;

		// Crash each successive child immediately. After MAX_RESTARTS_PER_WINDOW
		// (5) respawns the supervisor gives up rather than spawning forever, so at
		// most 1 initial + 5 respawns = 6 children are ever spawned.
		for (let i = 0; i < 10; i++) {
			nonNull(spawned.at(-1), "current child").crash();
			await tick();
			await tick();
		}

		expect(spawned).toHaveLength(6);

		await manager.close();
	});
});
