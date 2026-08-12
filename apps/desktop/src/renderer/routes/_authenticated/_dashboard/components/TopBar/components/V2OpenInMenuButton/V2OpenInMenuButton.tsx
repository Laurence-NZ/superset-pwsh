import type { ExternalApp } from "@superset/local-db";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { OverflowFadeText } from "@superset/ui/overflow-fade-text";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useCallback, useMemo } from "react";
import { VscChevronDown } from "react-icons/vsc";
import {
	getAppOption,
	OpenInExternalDropdownItems,
} from "renderer/components/OpenInExternalDropdown";
import { HotkeyLabel, useHotkeyDisplay } from "renderer/hotkeys";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useV2ProjectDefaultApp } from "renderer/routes/_authenticated/hooks/useV2ProjectDefaultApp";
import { useThemeStore } from "renderer/stores";

interface V2OpenInMenuButtonProps {
	worktreePath: string;
	branch: string;
	/** Null for project-less "session" workspaces (no per-project default app). */
	projectId: string | null;
	/**
	 * Where the button is placed, which drives its chrome:
	 * - `"sidebar"` (default): filled `bg-secondary` pill; the `/branch` label is
	 *   gated behind the `@[240px]` container query the sidebar header provides.
	 * - `"tabbar"`: transparent chrome matching the run button (same height,
	 *   `rounded-md`, `hover:bg-muted`) so it blends into the pane tab bar in both
	 *   the empty and populated states; the `/branch` label always shows since the
	 *   tab bar has no wide `@container` ancestor. See F14 in
	 *   docs/windows-port-patch-list.md.
	 */
	variant?: "sidebar" | "tabbar";
}

export function V2OpenInMenuButton({
	worktreePath,
	branch,
	projectId,
	variant = "sidebar",
}: V2OpenInMenuButtonProps) {
	const isTabBar = variant === "tabbar";
	const activeTheme = useThemeStore((state) => state.activeTheme);

	const { app: persistedApp, setApp: persistDefaultApp } =
		useV2ProjectDefaultApp(projectId ?? undefined);
	const storedApp: ExternalApp = persistedApp ?? "finder";

	const openInApp = electronTrpc.external.openInApp.useMutation({
		onSuccess: (_data, variables) => {
			persistDefaultApp(variables.app);
		},
		onError: (error) => toast.error(`Failed to open: ${error.message}`),
	});
	const copyPath = electronTrpc.external.copyPath.useMutation({
		onSuccess: () => toast.success("Path copied to clipboard"),
		onError: (error) => toast.error(`Failed to copy path: ${error.message}`),
	});

	const currentApp = useMemo(
		() => getAppOption(storedApp) ?? null,
		[storedApp],
	);
	const resolvedApp: ExternalApp = currentApp?.id ?? "finder";
	const openInDisplay = useHotkeyDisplay("OPEN_IN_APP");
	const copyPathDisplay = useHotkeyDisplay("COPY_PATH");
	const showOpenInShortcut = openInDisplay.text !== "Unassigned";
	const showCopyPathShortcut = copyPathDisplay.text !== "Unassigned";
	const isLoading = openInApp.isPending || copyPath.isPending;
	const isDark = activeTheme?.type === "dark";

	const handleOpenInEditor = useCallback(() => {
		if (openInApp.isPending || copyPath.isPending) return;
		openInApp.mutate({ path: worktreePath, app: resolvedApp });
	}, [worktreePath, resolvedApp, openInApp, copyPath.isPending]);

	const handleOpenInOtherApp = useCallback(
		(appId: ExternalApp) => {
			if (openInApp.isPending || copyPath.isPending) return;
			openInApp.mutate({ path: worktreePath, app: appId });
		},
		[worktreePath, openInApp, copyPath.isPending],
	);

	const handleCopyPath = useCallback(() => {
		if (openInApp.isPending || copyPath.isPending) return;
		copyPath.mutate(worktreePath);
	}, [worktreePath, copyPath, openInApp.isPending]);

	// The OPEN_IN_APP hotkey is registered at the workspace level
	// (useV2OpenInAppHotkey) so it works even when this button is unmounted with
	// a collapsed right sidebar — see F13 in docs/windows-port-patch-list.md.

	return (
		<div className="flex shrink-0 items-center no-drag">
			<Tooltip delayDuration={1000}>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={handleOpenInEditor}
						disabled={isLoading || !currentApp}
						aria-label={
							currentApp
								? `Open in ${currentApp.displayLabel ?? currentApp.label}`
								: "Open in editor"
						}
						className={cn(
							// Icon-only when the nearest @container is narrow; the branch
							// label comes back once there's room (right sidebar is resizable,
							// so viewport breakpoints don't apply here). The threshold is
							// higher than the PR badge's so the badge (with its merge
							// chevron) keeps space priority and never clips in the 240-320px
							// dead zone (#6385).
							"group flex h-6 items-center justify-center gap-1.5 rounded-l border border-r-0 border-border/60 bg-secondary/50 px-1.5 text-xs font-medium @[320px]:pr-2",
							"transition-all duration-150 ease-out",
							"group flex h-6 items-center gap-1.5 border border-r-0 text-xs font-medium",
							"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
							// tabbar: transparent chrome matching the run button; sidebar:
							// filled pill with the branch label gated behind @[240px].
							isTabBar
								? "rounded-l-md border-border/50 bg-transparent px-2 transition-colors hover:bg-muted/60"
								: "rounded-l border-border/60 bg-secondary/50 px-1.5 @[240px]:pr-2 transition-all duration-150 ease-out hover:bg-secondary hover:border-border active:scale-[0.98]",
							isLoading && "opacity-50 pointer-events-none",
						)}
					>
						{currentApp && (
							<img
								src={isDark ? currentApp.darkIcon : currentApp.lightIcon}
								alt=""
								className="size-3.5 object-contain shrink-0"
							/>
						)}
						{branch && (
							<OverflowFadeText
								className={cn(
									"text-muted-foreground tabular-nums",
									isTabBar ? "inline-block" : "hidden @[320px]:inline-block",
									isTabBar ? "max-w-24" : "max-w-[140px]",
								)}
								title={branch}
							>
								/{branch}
							</OverflowFadeText>
						)}
					</button>
				</TooltipTrigger>
				<TooltipContent side="bottom" sideOffset={6}>
					{currentApp ? (
						<HotkeyLabel
							label={`Open in ${currentApp.displayLabel ?? currentApp.label}`}
							id="OPEN_IN_APP"
						/>
					) : (
						"Select an editor from the dropdown"
					)}
				</TooltipContent>
			</Tooltip>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						disabled={isLoading}
						className={cn(
							"flex size-6 items-center justify-center border text-muted-foreground",
							"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
							isTabBar
								? "rounded-r-md border-border/50 bg-transparent transition-colors hover:bg-muted/60 hover:text-foreground"
								: "rounded-r border-border/60 bg-secondary/50 transition-all duration-150 ease-out hover:bg-secondary hover:border-border hover:text-foreground active:scale-[0.98]",
							isLoading && "opacity-50 pointer-events-none",
						)}
					>
						<VscChevronDown className="size-3" />
					</button>
				</DropdownMenuTrigger>

				<DropdownMenuContent align="end" className="w-48">
					<OpenInExternalDropdownItems
						isDark={isDark}
						activeApp={resolvedApp}
						onOpenIn={handleOpenInOtherApp}
						onCopyPath={handleCopyPath}
						renderAppTrailing={(appId, group) => {
							if (
								appId !== resolvedApp ||
								!showOpenInShortcut ||
								group === "jetbrains"
							) {
								return null;
							}
							return (
								<DropdownMenuShortcut>
									{openInDisplay.text}
								</DropdownMenuShortcut>
							);
						}}
						copyPathTrailing={
							showCopyPathShortcut ? (
								<DropdownMenuShortcut>
									{copyPathDisplay.text}
								</DropdownMenuShortcut>
							) : null
						}
						subContentClassName="w-40"
						appContentClassName="gap-0"
						appIconClassName="size-4 object-contain mr-2"
						subTriggerIconClassName="size-4 object-contain mr-2"
						subTriggerContentClassName="flex items-center gap-0"
						copyPathContentClassName="gap-0"
						copyPathIconClassName="mr-2"
					/>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
