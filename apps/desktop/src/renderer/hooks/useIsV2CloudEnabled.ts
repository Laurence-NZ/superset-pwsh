import { isV2OnlyUser } from "@superset/shared/v2-only-user";
import { authClient } from "renderer/lib/auth-client";

/**
 * True for accounts created on/after V2_ONLY_USER_CUTOFF — these users
 * default to v2.
 */
export function useIsV2OnlyUser(): boolean {
	const { data: session } = authClient.useSession();
	return isV2OnlyUser(session?.user?.createdAt);
}

/** Returns whether v2 is currently active for this user. */
export function useIsV2CloudEnabled(): boolean {
	// ponytail: Windows fork forces v2 on for everyone and hides the opt-out
	// toggle (see ExperimentalSettings). v1 is untested on Windows. Restore the
	// opt-in/env logic if v1 support is ever wanted here.
	return true;
}
