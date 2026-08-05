import { cn } from "@superset/ui/utils";

interface DashboardSidebarWorkspaceRunIndicatorProps {
	className?: string;
}

export function DashboardSidebarWorkspaceRunIndicator({
	className,
}: DashboardSidebarWorkspaceRunIndicatorProps) {
	return (
		<span className={cn("relative flex size-1.5 shrink-0", className)}>
			<span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-40" />
			<span className="relative inline-flex size-1.5 rounded-full bg-emerald-500 ring-1 ring-background" />
		</span>
	);
}
