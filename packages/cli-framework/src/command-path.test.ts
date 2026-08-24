import { describe, expect, test } from "bun:test";
import { getCommandPath } from "./command-path";

describe("getCommandPath", () => {
	test("parses POSIX glob paths", () => {
		expect(getCommandPath("auth/whoami/command.ts")).toEqual([
			"auth",
			"whoami",
		]);
	});

	test("parses Windows glob paths", () => {
		expect(getCommandPath("auth\\whoami\\command.ts")).toEqual([
			"auth",
			"whoami",
		]);
	});
});
