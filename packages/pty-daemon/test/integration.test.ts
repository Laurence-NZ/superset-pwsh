// Smoke / happy-path integration test for pty-daemon.
//
// Runs under Node (`node --experimental-strip-types --test`); see
// test/control-plane.test.ts for the exhaustive control-plane scenarios.

import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import { after, before, test } from "node:test";
import { adoptFromFd, spawn as spawnPty } from "../src/Pty/Pty.ts";
import { Server } from "../src/Server/index.ts";
import { connect, connectAndHello, payloadAsString } from "./helpers/client.ts";
import {
	commandMeta,
	inputLine,
	interactiveMeta,
	makeDaemonSocketPath,
	sleepCommand,
} from "./helpers/platform.ts";

const sockPath = makeDaemonSocketPath("pty-daemon-smoke");
let server: Server;

before(async () => {
	server = new Server({ socketPath: sockPath, daemonVersion: "0.0.0-test" });
	await server.listen();
});

after(async () => {
	await server.close();
});

test("handshake: hello → hello-ack", { timeout: 10_000 }, async () => {
	const c = await connect(sockPath);
	c.send({ type: "hello", protocols: [2] });
	const ack = await c.waitFor((m) => m.type === "hello-ack");
	assert.equal(ack.type, "hello-ack");
	if (ack.type === "hello-ack") {
		assert.equal(ack.protocol, 2);
		assert.equal(ack.daemonVersion, "0.0.0-test");
	}
	await c.close();
});

test(
	"open → subscribe → output → exit lifecycle",
	{ timeout: 10_000 },
	async () => {
		const c = await connectAndHello(sockPath);
		c.send({
			type: "open",
			id: "smoke-0",
			meta: commandMeta("echo daemon-smoke"),
		});
		await c.waitFor((m) => m.type === "open-ok" && m.id === "smoke-0");
		c.send({ type: "subscribe", id: "smoke-0", replay: true });

		await c.waitFor(
			(m) =>
				m.type === "output" &&
				m.id === "smoke-0" &&
				payloadAsString(m).includes("daemon-smoke"),
			3000,
		);
		const exit = await c.waitFor(
			(m) => m.type === "exit" && m.id === "smoke-0",
			3000,
		);
		if (exit.type === "exit") assert.equal(exit.code, 0);
		await c.close();
	},
);

test(
	"input is forwarded and echoed via output",
	{ timeout: 10_000 },
	async () => {
		const c = await connectAndHello(sockPath);
		c.send({
			type: "open",
			id: "smoke-1",
			meta: interactiveMeta(),
		});
		await c.waitFor((m) => m.type === "open-ok");
		c.send({ type: "subscribe", id: "smoke-1", replay: false });
		c.send({ type: "input", id: "smoke-1" }, inputLine("echo abc-marker"));
		await c.waitFor(
			(m) =>
				m.type === "output" &&
				m.id === "smoke-1" &&
				payloadAsString(m).includes("abc-marker"),
			3000,
		);
		c.send({ type: "list" });
		const list = await c.waitFor((m) => m.type === "list-reply", 3000);
		assert.equal(list.type, "list-reply");
		if (list.type === "list-reply") {
			const session = list.sessions.find((entry) => entry.id === "smoke-1");
			assert.ok(session, "live session should be listed");
			assert.ok(
				Number.isInteger(session.pid) && session.pid > 0,
				`expected a positive live session PID, got ${session.pid}`,
			);
		}
		c.send({
			type: "close",
			id: "smoke-1",
			signal: process.platform === "win32" ? "SIGKILL" : "SIGTERM",
		});
		await c.waitFor((m) => m.type === "closed" && m.id === "smoke-1");
		await c.close();
	},
);

test("Pty.getMasterFd returns a usable kernel fd", { timeout: 10_000 }, () => {
	if (process.platform === "win32") return;

	// Phase 2 fd-handoff depends on this — surface a clear failure if the
	// node-pty private-property contract changes under us.
	const pty = spawnPty({
		meta: commandMeta(sleepCommand(1)),
	});
	try {
		const fd = pty.getMasterFd();
		assert.ok(Number.isInteger(fd), `expected integer fd, got ${fd}`);
		assert.ok(fd > 2, `expected fd > 2 (not stdio), got ${fd}`);
		// fstatSync confirms the fd is open in our process.
		const stat = fs.fstatSync(fd);
		assert.ok(stat, "fstat should succeed on master fd");
	} finally {
		pty.kill("SIGKILL");
	}
});

test("adoptFromFd validates inputs", { timeout: 10_000 }, () => {
	const meta = commandMeta("");
	assert.throws(() => adoptFromFd({ fd: -1, pid: 1, meta }), /invalid fd/);

	const invalidPidFd = fs.openSync("/dev/null", "r");
	try {
		assert.throws(
			() => adoptFromFd({ fd: invalidPidFd, pid: 0, meta }),
			/invalid pid/,
		);
		assert.throws(
			() => fs.fstatSync(invalidPidFd),
			(err: unknown) => (err as NodeJS.ErrnoException).code === "EBADF",
		);
	} finally {
		try {
			fs.closeSync(invalidPidFd);
		} catch {
			// adoptFromFd closed it as required
		}
	}

	const invalidDimsFd = fs.openSync("/dev/null", "r");
	try {
		assert.throws(
			() =>
				adoptFromFd({
					fd: invalidDimsFd,
					pid: 1,
					meta: { ...meta, cols: 0 },
				}),
			/invalid cols/,
		);
		assert.throws(
			() => fs.fstatSync(invalidDimsFd),
			(err: unknown) => (err as NodeJS.ErrnoException).code === "EBADF",
		);
	} finally {
		try {
			fs.closeSync(invalidDimsFd);
		} catch {
			// adoptFromFd closed it as required
		}
	}
});

test("adoptFromFd wraps a real PTY master fd without crashing", async () => {
	if (process.platform === "win32") return;
	// API-surface check only. End-to-end I/O on an adopted fd is validated
	// in the cross-process handoff integration test — in this test process,
	// node-pty's native worker is actively reading from the master fd, so
	// adoptFromFd's read stream would race with it. In a real successor
	// daemon, node-pty doesn't exist for the adopted session.
	const original = spawnPty({
		meta: commandMeta(sleepCommand(1)),
	});
	// Adopt a /dev/fd dup, not node-pty's own fd: AdoptedPty owns (and
	// closes) the fd it's given, and closing node-pty's copy under its
	// internal ReadStream surfaces as an uncaught EBADF. Only this test
	// double-owns a master fd; a real successor daemon owns it exclusively.
	const dupFd = fs.openSync(`/dev/fd/${original.getMasterFd()}`, "r+");
	let adopted: ReturnType<typeof adoptFromFd> | null = null;
	try {
		adopted = adoptFromFd({
			fd: dupFd,
			pid: original.pid,
			meta: original.meta,
		});
		assert.equal(adopted.pid, original.pid);
		assert.equal(adopted.getMasterFd(), dupFd);
		// resize updates meta but not kernel-side window (TODO: koffi ioctl)
		adopted.resize(120, 40);
		assert.equal(adopted.meta.cols, 120);
		assert.equal(adopted.meta.rows, 40);
	} finally {
		original.kill("SIGKILL");
		// Let both sides observe the exit inside the test window so no
		// async tail gets attributed to after-test activity.
		await Promise.all([
			new Promise<void>((r) => original.onExit(() => r())),
			new Promise<void>((r) => {
				adopted ? adopted.onExit(() => r()) : r();
			}),
		]);
	}
});
