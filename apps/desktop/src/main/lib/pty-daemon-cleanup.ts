import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import log from "electron-log/main";
import { SUPERSET_HOME_DIR } from "./app-environment";
import { treeKillWithEscalation } from "./tree-kill";

// v2-terminals only. host-service spawns the pty-daemon detached + unref'd so
// it survives host-service restarts (PTYs reattach on relaunch). Nothing else
// reaps it, so a full "Quit Completely" must tree-kill it explicitly —
// otherwise the daemon (and its shell PTYs) linger after the app exits. The
// v1 terminal-host already has its teardown (teardownTerminalHost in
// main/index.ts); this is the missing v2 counterpart. v2 is still considered
// experimental upstream, so this cleanup likely just hasn't been added there
// yet — drop this file if upstream grows an equivalent. The daemon pid is
// recorded in a manifest written by host-service at
// $SUPERSET_HOME_DIR/host/{orgId}/pty-daemon-manifest.json — see
// packages/host-service/src/daemon/manifest.ts.
const MANIFEST_FILENAME = "pty-daemon-manifest.json";

function readDaemonPids(): number[] {
	const hostDir = join(SUPERSET_HOME_DIR, "host");
	if (!existsSync(hostDir)) return [];
	const pids: number[] = [];
	try {
		for (const entry of readdirSync(hostDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const file = join(hostDir, entry.name, MANIFEST_FILENAME);
			if (!existsSync(file)) continue;
			try {
				const pid = JSON.parse(readFileSync(file, "utf-8")).pid;
				if (typeof pid === "number" && pid > 0) pids.push(pid);
			} catch {
				// Best-effort — a malformed/partial manifest just gets skipped.
			}
		}
	} catch {
		// Best-effort — host dir unreadable, nothing to kill.
	}
	return pids;
}

/**
 * Tree-kill every recorded pty-daemon. Called only on full teardown
 * ("Quit Completely" / dev shutdown), never on a plain "Close Superset"
 * where the daemon is intentionally left running for the next launch.
 */
export async function killAllPtyDaemons(): Promise<void> {
	const pids = readDaemonPids();
	if (pids.length === 0) return;
	log.info(`[quit] killing ${pids.length} pty-daemon(s): ${pids.join(", ")}`);
	await Promise.all(pids.map((pid) => treeKillWithEscalation({ pid })));
}
