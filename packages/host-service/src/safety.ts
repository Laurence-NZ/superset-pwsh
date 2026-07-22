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

import { monitorEventLoopDelay } from "node:perf_hooks";

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
