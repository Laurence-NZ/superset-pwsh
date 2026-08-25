import { describe, expect, test } from "bun:test";
import { getAgentHooksSwitchState } from "./agentHooksUiState";

describe("getAgentHooksSwitchState", () => {
	test("forces managed hooks off on Windows", () => {
		expect(getAgentHooksSwitchState("win32", true)).toEqual({
			checked: false,
			disabledByPlatform: true,
		});
	});

	test("preserves the configured state on other platforms", () => {
		expect(getAgentHooksSwitchState("darwin", true)).toEqual({
			checked: true,
			disabledByPlatform: false,
		});
		expect(getAgentHooksSwitchState("linux", false)).toEqual({
			checked: false,
			disabledByPlatform: false,
		});
	});
});
