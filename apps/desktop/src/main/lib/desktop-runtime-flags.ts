import { env } from "main/env.main";
import {
	type DesktopRuntimeFlags,
	getPostHogKeyOrNull,
	normalizeDesktopRuntimeFlags,
} from "shared/desktop-runtime-flags";
import { appState } from "./app-state";

export function getDesktopRuntimeFlags(): DesktopRuntimeFlags {
	try {
		return normalizeDesktopRuntimeFlags(appState.data.desktopRuntimeFlags);
	} catch {
		return normalizeDesktopRuntimeFlags(undefined);
	}
}

export function isAutoUpdateDisabledByRuntimeFlags(): boolean {
	// Windows fork: this build is never published with a Windows release feed, so
	// every update check polls a manifest that doesn't exist and fails. Auto-update
	// is force-disabled here and the settings toggle is locked on (see
	// ExperimentalSettings). Restore the runtime-flag/env logic below if a real
	// Windows release feed ever ships:
	//   return (
	//     getDesktopRuntimeFlags().disableAutoUpdate ||
	//     isTruthyRuntimeFlag(process.env.SUPERSET_DISABLE_AUTO_UPDATE)
	//   );
	return true;
}

export function getMainPostHogKey(key: string | undefined): string | null {
	return getPostHogKeyOrNull(key, {
		disabled: getDesktopRuntimeFlags().disableAnalytics,
	});
}

export function getMainApiUrl(): string {
	return env.NEXT_PUBLIC_API_URL;
}
