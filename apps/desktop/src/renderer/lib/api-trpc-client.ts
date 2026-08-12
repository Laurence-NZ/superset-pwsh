import type { AppRouter } from "@superset/trpc";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { getAuthToken } from "./auth-client";
import { getRuntimeApiUrl } from "./desktop-runtime-flags";

/**
 * Imperative tRPC client for the API server (bearer-token auth). For
 * component data fetching use the `cloudTrpc` React Query hooks instead.
 */
export const apiTrpcClient = createTRPCProxyClient<AppRouter>({
	links: [
		httpBatchLink({
			url: `${getRuntimeApiUrl()}/api/trpc`,
			transformer: superjson,
			headers: () => {
				const token = getAuthToken();
				return {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
					...(window.App?.appVersion
						? { "x-superset-client": `desktop/${window.App.appVersion}` }
						: {}),
				};
			},
		}),
	],
});
