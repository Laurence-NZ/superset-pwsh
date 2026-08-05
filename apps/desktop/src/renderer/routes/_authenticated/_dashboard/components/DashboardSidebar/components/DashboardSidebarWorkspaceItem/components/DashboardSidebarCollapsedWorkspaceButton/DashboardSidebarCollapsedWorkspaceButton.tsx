import { cn } from "@superset/ui/utils";
import { type ComponentPropsWithoutRef, forwardRef } from "react";
import type { ActivePaneStatus } from "shared/tabs-types";
import type {
	DashboardSidebarWorkspaceHostType,
	DashboardSidebarWorkspacePullRequest,
	DashboardSidebarWorkspaceType,
} from "../../../../types";
import { DashboardSidebarWorkspaceIcon } from "../DashboardSidebarWorkspaceIcon";
import { DashboardSidebarWorkspaceRunIndicator } from "../DashboardSidebarWorkspaceRunIndicator";

interface DashboardSidebarCollapsedWorkspaceButtonProps
	extends ComponentPropsWithoutRef<"button"> {
	hostType: DashboardSidebarWorkspaceHostType;
	workspaceType: DashboardSidebarWorkspaceType;
	hostIsOnline: boolean | null;
	isActive: boolean;
	workspaceStatus?: ActivePaneStatus | null;
	isRunActive: boolean;
	isCreatePending: boolean;
	pullRequestState?: DashboardSidebarWorkspacePullRequest["state"] | null;
}

export const DashboardSidebarCollapsedWorkspaceButton = forwardRef<
	HTMLButtonElement,
	DashboardSidebarCollapsedWorkspaceButtonProps
>(
	(
		{
			hostType,
			workspaceType,
			hostIsOnline,
			isActive,
			workspaceStatus = null,
			isRunActive,
			isCreatePending,
			pullRequestState = null,
			className,
			...props
		},
		ref,
	) => {
		return (
			<button
				type="button"
				ref={ref}
				className={cn(
					"relative flex items-center justify-center size-8 rounded-md",
					"transition-colors cursor-pointer",
					isActive
						? "bg-fill-selected hover:bg-fill-selected"
						: "hover:bg-fill-hover",
					className,
				)}
				{...props}
			>
				<DashboardSidebarWorkspaceIcon
					hostType={hostType}
					workspaceType={workspaceType}
					hostIsOnline={hostIsOnline}
					isActive={isActive}
					variant="collapsed"
					workspaceStatus={workspaceStatus}
					isCreatePending={isCreatePending}
					pullRequestState={pullRequestState}
				/>
				{isRunActive && (
					<span
						className="absolute right-0.5 bottom-0.5"
						title="Workspace run active"
					>
						<DashboardSidebarWorkspaceRunIndicator />
					</span>
				)}
			</button>
		);
	},
);
