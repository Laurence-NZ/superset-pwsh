// IPC protocol between the parent (SubprocessWatcherManager) and the fs-watcher
// child process. Messages travel over Node's built-in IPC channel
// (`child.send` / `process.send`), so they must be plain JSON-serializable
// objects. Payloads are the already-coalesced/throttled event batches the
// in-child FsWatcherManager emits, so volume across the channel stays low.

import type { FsWatchEvent } from "../types";

/** Parent → child. */
export type FsWatcherRequest =
	| { type: "subscribe"; id: number; absolutePath: string }
	| { type: "unsubscribe"; id: number }
	| { type: "refresh-ignores"; id: number; absolutePath: string }
	| { type: "close" };

/** Child → parent. */
export type FsWatcherResponse =
	| { type: "ready" }
	| { type: "subscribed"; id: number; prunedRelPrefixes: string[] }
	| { type: "subscribe-error"; id: number; message: string }
	| {
			type: "ignores-refreshed";
			id: number;
			swapped: boolean;
			prunedRelPrefixes: string[];
	  }
	| { type: "refresh-error"; id: number; message: string }
	| { type: "events"; id: number; events: FsWatchEvent[] };
