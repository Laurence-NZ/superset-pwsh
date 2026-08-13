import { describe, expect, it } from "bun:test";
import { shouldVerifyInitialCommandEcho } from "./initial-command-echo";

describe("shouldVerifyInitialCommandEcho", () => {
	it("disables echo retries for Windows shells", () => {
		expect(shouldVerifyInitialCommandEcho("win32")).toBe(false);
	});

	it("keeps echo retries for POSIX shells", () => {
		expect(shouldVerifyInitialCommandEcho("darwin")).toBe(true);
		expect(shouldVerifyInitialCommandEcho("linux")).toBe(true);
	});
});
