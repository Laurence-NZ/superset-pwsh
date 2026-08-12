/**
 * Host-service crash isolation.
 *
 * Policy: the main host-service process must stay up even when a subsystem
 * throws. We rely on a process-level safety net as the primary mechanism —
 * Node already routes throws from `setInterval`, `setTimeout`, `EventEmitter`
 * listeners, native callbacks (`pty.onData`/`onExit`), and orphaned promise
 * continuations into `uncaughtException` / `unhandledRejection`, so a single
 * handler covers all of them.
 *
 * The two places where this isn't enough are fan-out loops over multiple
 * subscribers (broadcasts, listener iteration). A throw there skips the
 * remaining iterations, so those sites use inline `try/catch` directly.
 */

import type { IncomingMessage } from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Duplex } from "node:stream";
import * as Sentry from "@sentry/node";

const DIAGNOSTIC_INTERVAL_MS = 60_000;

let safetyNetInstalled = false;
let diagnosticsStarted = false;

function bytesToMiB(bytes: number): number {
	return Math.round(bytes / 1024 / 1024);
}

function activeResourceCounts(): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const resource of process.getActiveResourcesInfo()) {
		counts[resource] = (counts[resource] ?? 0) + 1;
	}
	return Object.fromEntries(
		Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
	);
}

/**
 * Node detaches its own socket error handling before emitting 'upgrade',
 * and @hono/node-ws awaits app.request() before ws adopts the socket — a
 * peer reset in that window is an uncaught ECONNRESET at TCP.onStreamRead
 * (and a peer gone before the reject-path socket.end() is an uncaught
 * EPIPE). Keep a listener attached for the socket's lifetime so resets are
 * logged instead. Must be installed by every entrypoint that calls
 * injectWebSocket — shipped in serve.ts by #6196, but the desktop
 * entrypoint has its own bootstrap and kept crashing (HOST-SERVICE-5).
 */
export function installUpgradeSocketGuard(server: {
	on(
		event: "upgrade",
		listener: (request: IncomingMessage, socket: Duplex) => void,
	): unknown;
}): void {
	server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
		// Path only: the upgrade URL's query string carries HOST_SERVICE_SECRET
		// as `token` for relayed connections.
		const requestPath = request.url?.split("?")[0] ?? "<unknown>";
		socket.on("error", (error: NodeJS.ErrnoException) => {
			console.warn(
				`[host-service] upgrade socket error (${error.code ?? error.message}) on ${requestPath} from ${request.socket.remoteAddress ?? "<unknown>"}`,
			);
		});
	});
}

export function installProcessSafetyNet(): void {
	if (safetyNetInstalled) return;
	safetyNetInstalled = true;

	process.on("uncaughtException", (error, origin) => {
		console.error("[host-service] uncaughtException — staying up", {
			origin,
			error,
		});
	});

	process.on("unhandledRejection", (reason) => {
		console.error("[host-service] unhandledRejection — staying up", { reason });
		Sentry.captureException(reason);
	});
}

/**
 * Emit a compact, process-wide heartbeat for diagnosing abrupt native exits.
 * Values are operational counters only; no commands, paths, or user data are
 * included. The timer is unref'd so it never keeps the host-service alive.
 */
export function startProcessDiagnostics(): void {
	if (diagnosticsStarted) return;
	diagnosticsStarted = true;

	const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
	eventLoopDelay.enable();
	let previousCpu = process.cpuUsage();
	let previousTime = performance.now();

	const interval = setInterval(() => {
		const now = performance.now();
		const elapsedMicros = (now - previousTime) * 1000;
		const cpu = process.cpuUsage(previousCpu);
		const memory = process.memoryUsage();
		console.info("[host-service:diagnostics] heartbeat", {
			at: new Date().toISOString(),
			uptimeSeconds: Math.round(process.uptime()),
			memoryMb: {
				rss: bytesToMiB(memory.rss),
				heapTotal: bytesToMiB(memory.heapTotal),
				heapUsed: bytesToMiB(memory.heapUsed),
				external: bytesToMiB(memory.external),
				arrayBuffers: bytesToMiB(memory.arrayBuffers),
			},
			cpuPercent: {
				user: Math.round((cpu.user / elapsedMicros) * 100),
				system: Math.round((cpu.system / elapsedMicros) * 100),
			},
			eventLoopDelayMs: {
				mean: Math.round(eventLoopDelay.mean / 1_000_000),
				max: Math.round(eventLoopDelay.max / 1_000_000),
			},
			activeResources: activeResourceCounts(),
		});

		previousCpu = process.cpuUsage();
		previousTime = now;
		eventLoopDelay.reset();
	}, DIAGNOSTIC_INTERVAL_MS);
	interval.unref();
}
