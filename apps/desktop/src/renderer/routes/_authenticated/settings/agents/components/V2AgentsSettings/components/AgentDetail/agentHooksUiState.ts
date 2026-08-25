export function getAgentHooksSwitchState(
	platform: NodeJS.Platform | undefined,
	hooksEnabled: boolean,
): { checked: boolean; disabledByPlatform: boolean } {
	const disabledByPlatform = platform === "win32";
	return {
		checked: disabledByPlatform ? false : hooksEnabled,
		disabledByPlatform,
	};
}
