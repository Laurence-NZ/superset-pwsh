import { useQuery } from "@tanstack/react-query";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useWorkspaceHostUrl } from "../useWorkspaceHostUrl";

/**
 * STOPGAP (Windows port branch only) — DELETE ON MERGE.
 *
 * Number of commits the workspace's branch is behind its upstream — i.e. how
 * many commits there are to pull from the remote. Feeds the temporary "commits
 * to pull" (↓N) badge in DashboardSidebarExpandedWorkspaceRow. This whole hook,
 * the badge JSX, and the host-service `git.getCommitsToPull` procedure exist
 * only until upstream/main ships a proper ahead/behind indicator in the v2
 * sidebar; remove all three together when it does.
 *
 * The host-service procedure schedules a background upstream fetch (coalesced,
 * ~5 min TTL), so with the interval below the count converges on the real
 * remote state rather than only reflecting the last manual fetch.
 */
export function useCommitsToPull(workspaceId: string): number {
	const hostUrl = useWorkspaceHostUrl(workspaceId);

	const { data } = useQuery({
		queryKey: ["commits-to-pull", hostUrl, workspaceId] as const,
		enabled: Boolean(workspaceId) && Boolean(hostUrl),
		queryFn: () => {
			if (!hostUrl) return null;
			return getHostServiceClientByUrl(hostUrl).git.getCommitsToPull.query({
				workspaceId,
			});
		},
		refetchOnWindowFocus: true,
		// Poll so a background upstream fetch from a previous poll is picked up.
		// Cheap between fetches (local rev-list); the actual network fetch is
		// throttled to ~5 min host-side regardless of how often we poll.
		refetchInterval: 2 * 60_000,
		staleTime: 60_000,
	});

	return data?.pullCount ?? 0;
}
