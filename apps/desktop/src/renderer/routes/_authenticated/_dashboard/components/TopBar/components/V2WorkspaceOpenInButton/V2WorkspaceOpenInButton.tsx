import { useHostWorkspaces } from "../../../../../providers/HostWorkspacesProvider";
import { useLocalHostService } from "../../../../../providers/LocalHostServiceProvider";
import { V2OpenInMenuButton } from "../V2OpenInMenuButton";

interface V2WorkspaceOpenInButtonProps {
	workspaceId: string;
	/** Forwarded to V2OpenInMenuButton — see its prop docs and F14. */
	alwaysShowBranch?: boolean;
}

export function V2WorkspaceOpenInButton({
	workspaceId,
	alwaysShowBranch,
}: V2WorkspaceOpenInButtonProps) {
	const { machineId, activeHostUrl } = useLocalHostService();

	const { workspaces } = useHostWorkspaces();
	const workspace = workspaces.find((w) => w.id === workspaceId) ?? null;
	const isLocalWorkspace = workspace !== null && workspace.hostId === machineId;

	if (!workspace || !activeHostUrl || !isLocalWorkspace) {
		return null;
	}

	// worktreePath comes from the live workspace list (healed by
	// `workspace:changed`), so a freshly-created workspace's button appears as
	// soon as the worktree is provisioned — no re-selection needed.
	if (!workspace.worktreePath) {
		return null;
	}

	return (
		<V2OpenInMenuButton
			branch={workspace.branch}
			worktreePath={workspace.worktreePath}
			projectId={workspace.projectId}
			alwaysShowBranch={alwaysShowBranch}
		/>
	);
}
