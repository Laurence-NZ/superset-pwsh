import { spawnSync } from "node:child_process";

const [envName, defaultPort, command, ...args] = process.argv.slice(2);

if (!envName || !defaultPort || !command) {
	console.error(
		"Usage: bun run scripts/dev-with-port.ts <ENV_NAME> <DEFAULT_PORT> <command> [...args]",
	);
	process.exit(1);
}

const port = process.env[envName] || defaultPort;
const commandArgs = [...args, "--port", port];

if (
	process.platform === "win32" &&
	command === "next" &&
	commandArgs[0] === "dev" &&
	!commandArgs.includes("--webpack") &&
	!commandArgs.includes("--turbopack")
) {
	commandArgs.splice(1, 0, "--webpack");
	console.log(
		"[dev-with-port] Using webpack because Next Turbopack emits invalid file URLs on Windows",
	);
}

const result = spawnSync("bun", ["x", command, ...commandArgs], {
	stdio: "inherit",
	shell: false,
	env: process.env,
});

if (result.error) {
	console.error(
		`[dev-with-port] Failed to run ${command}: ${result.error.message}`,
	);
	process.exit(1);
}

process.exit(result.status ?? 1);
