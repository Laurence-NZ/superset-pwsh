export function shouldVerifyInitialCommandEcho(
	platform: NodeJS.Platform = process.platform,
): boolean {
	// The verifier protects POSIX shells from startup stdin readers. ConPTY
	// does not echo pending PowerShell/cmd input in the form it expects, so the
	// verifier would send Ctrl+U and type the preset repeatedly.
	return platform !== "win32";
}
