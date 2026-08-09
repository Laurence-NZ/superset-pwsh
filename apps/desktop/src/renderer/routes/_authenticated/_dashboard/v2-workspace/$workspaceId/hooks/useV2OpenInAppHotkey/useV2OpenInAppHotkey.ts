import type { ExternalApp } from "@superset/local-db";
import { toast } from "@superset/ui/sonner";
import { useCallback } from "react";
import { getAppOption } from "renderer/components/OpenInExternalDropdown";
import { useHotkey } from "renderer/hotkeys";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useV2ProjectDefaultApp } from "renderer/routes/_authenticated/hooks/useV2ProjectDefaultApp";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

/**
 * Registers the OPEN_IN_APP hotkey at the always-mounted workspace level so
 * ⌘/Ctrl+O opens the worktree in the chosen editor regardless of whether the
 * right sidebar — which hosts the visible Open-in button — happens to be open.
 *
 * Upstream #5824 moved that button into the sidebar's PR action header, and the
 * hotkey used to live inside the button, so collapsing the sidebar unmounted
 * the button and silently tore the shortcut down with it. The button no longer
 * registers the hotkey; this hook owns it. See F13 in
 * docs/windows-port-patch-list.md.
 */
export function useV2OpenInAppHotkey(workspaceId: string): void {
	const { machineId } = useLocalHostService();
	const { workspaces } = useHostWorkspaces();
	const workspace = workspaces.find((w) => w.id === workspaceId) ?? null;
	const isLocalWorkspace = workspace !== null && workspace.hostId === machineId;

	const { app: persistedApp, setApp: persistDefaultApp } =
		useV2ProjectDefaultApp(workspace?.projectId ?? undefined);
	const storedApp: ExternalApp = persistedApp ?? "finder";
	const resolvedApp: ExternalApp = getAppOption(storedApp)?.id ?? "finder";

	const openInApp = electronTrpc.external.openInApp.useMutation({
		onSuccess: (_data, variables) => {
			persistDefaultApp(variables.app);
		},
		onError: (error) => toast.error(`Failed to open: ${error.message}`),
	});

	// Only local workspaces with a provisioned worktree can be opened; mirrors
	// the render gate on V2WorkspaceOpenInButton.
	const worktreePath = isLocalWorkspace ? workspace?.worktreePath : undefined;

	const openInEditor = useCallback(() => {
		if (!worktreePath || openInApp.isPending) return;
		openInApp.mutate({ path: worktreePath, app: resolvedApp });
	}, [worktreePath, resolvedApp, openInApp]);

	useHotkey("OPEN_IN_APP", openInEditor);
}
