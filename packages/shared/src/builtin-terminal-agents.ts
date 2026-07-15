import {
	createTerminalAgentDefinition,
	type TerminalAgentDefinition,
	type TerminalAgentDefinitionInput,
} from "./agent-definition";
import type { PromptTransport } from "./agent-prompt-launch";
import { DEFAULT_TERMINAL_TASK_PROMPT_TEMPLATE } from "./agent-prompt-template";

interface BuiltinTerminalAgentManifest
	extends Omit<
		TerminalAgentDefinitionInput,
		"source" | "kind" | "enabled" | "taskPromptTemplate"
	> {
	description: string;
	includeInDefaultTerminalPresets?: boolean;
}

export interface BuiltinTerminalAgentDefinition
	extends TerminalAgentDefinition {
	description: string;
	includeInDefaultTerminalPresets?: boolean;
}

type AgentIdTuple<T extends readonly { id: string }[]> = {
	[K in keyof T]: T[K] extends { id: infer TId } ? TId : never;
};

function mapAgentIds<const T extends readonly { id: string }[]>(
	agents: T,
): AgentIdTuple<T> {
	return agents.map((agent) => agent.id) as AgentIdTuple<T>;
}

function createAgentRecord<const T extends readonly { id: string }[], TValue>(
	agents: T,
	getValue: (agent: T[number]) => TValue,
): Record<T[number]["id"], TValue> {
	return Object.fromEntries(
		agents.map((agent) => [agent.id, getValue(agent)]),
	) as Record<T[number]["id"], TValue>;
}

function createBuiltinTerminalAgent<
	const T extends BuiltinTerminalAgentManifest,
>(manifest: T): BuiltinTerminalAgentDefinition & { id: T["id"] } {
	return {
		...createTerminalAgentDefinition({
			...manifest,
			source: "builtin",
			kind: "terminal",
			enabled: true,
			taskPromptTemplate: DEFAULT_TERMINAL_TASK_PROMPT_TEMPLATE,
		}),
		description: manifest.description,
		includeInDefaultTerminalPresets: manifest.includeInDefaultTerminalPresets,
	};
}

export const BUILTIN_TERMINAL_AGENTS = [
	createBuiltinTerminalAgent({
		id: "claude",
		label: "Claude",
		description: "Dario take the wheel!",
		command: "claude --dangerously-skip-permissions",
		includeInDefaultTerminalPresets: true,
	}),
	createBuiltinTerminalAgent({
		id: "amp",
		label: "Amp",
		description:
			"Amp's coding agent for terminal-first coding, subagents, and task work.",
		command: "amp",
		promptTransport: "stdin",
		includeInDefaultTerminalPresets: true,
	}),
	createBuiltinTerminalAgent({
		id: "codex",
		label: "Codex",
		description: "In Altman we trust.",
		command: "codex --dangerously-bypass-approvals-and-sandbox",
		promptCommand: "codex --dangerously-bypass-approvals-and-sandbox --",
		includeInDefaultTerminalPresets: true,
	}),
	createBuiltinTerminalAgent({
		id: "gemini",
		label: "Gemini",
		description:
			"Google's open-source terminal agent for coding, problem-solving, and task work.",
		command: "gemini --approval-mode=auto_edit",
		promptCommand: "gemini --approval-mode=auto_edit",
		includeInDefaultTerminalPresets: true,
	}),
	createBuiltinTerminalAgent({
		id: "mastracode",
		label: "Mastracode",
		description:
			"Mastra's coding agent for building, debugging, and shipping code from the terminal.",
		command: "mastracode",
		promptCommand: "mastracode --prompt",
		promptCommandSuffix: "; mastracode",
	}),
	createBuiltinTerminalAgent({
		id: "opencode",
		label: "OpenCode",
		description: "Open-source coding agent for the terminal, IDE, and desktop.",
		command: "opencode",
		promptCommand: "opencode --prompt",
	}),
	createBuiltinTerminalAgent({
		id: "pi",
		label: "Pi",
		description: "Absolutely maths.",
		command: "pi",
	}),
	createBuiltinTerminalAgent({
		id: "copilot",
		label: "Copilot",
		description: "Devs love Microsoft!",
		command: "copilot --allow-tool=write",
		promptCommand: "copilot --allow-tool=write -i",
		includeInDefaultTerminalPresets: true,
	}),
	createBuiltinTerminalAgent({
		id: "vibe",
		label: "Mistral Vibe",
		description:
			"Mistral's coding agent for reading, editing, and running code from the terminal.",
		command: "vibe --trust --auto-approve",
		includeInDefaultTerminalPresets: true,
	}),
	createBuiltinTerminalAgent({
		id: "cursor-agent",
		label: "Cursor Agent",
		description: "Cursor gonna curse.",
		command: "cursor-agent",
	}),
	createBuiltinTerminalAgent({
		id: "droid",
		label: "Droid",
		description: "Factory's autonomous coding agent for terminal workflows.",
		command: "droid",
	}),
	createBuiltinTerminalAgent({
		id: "polygraph",
		label: "Polygraph",
		description:
			"The meta-harness that gives agents cross-repo visibility and memory that survives every session.",
		command: "polygraph session start",
		promptCommand: "polygraph session start --",
	}),
] as const;

export type BuiltinTerminalAgentType =
	(typeof BUILTIN_TERMINAL_AGENTS)[number]["id"];

export const BUILTIN_TERMINAL_AGENT_TYPES = mapAgentIds(
	BUILTIN_TERMINAL_AGENTS,
);

export const BUILTIN_TERMINAL_AGENT_LABELS = createAgentRecord(
	BUILTIN_TERMINAL_AGENTS,
	(agent) => agent.label,
);

export const BUILTIN_TERMINAL_AGENT_DESCRIPTIONS = createAgentRecord(
	BUILTIN_TERMINAL_AGENTS,
	(agent) => agent.description,
);

export const BUILTIN_TERMINAL_AGENT_COMMANDS = createAgentRecord(
	BUILTIN_TERMINAL_AGENTS,
	(agent) => [agent.command],
);

export const BUILTIN_TERMINAL_AGENT_PROMPT_COMMANDS = createAgentRecord(
	BUILTIN_TERMINAL_AGENTS,
	(
		agent,
	): {
		command: string;
		suffix?: string;
		transport: PromptTransport;
	} => ({
		command: agent.promptCommand,
		suffix: agent.promptCommandSuffix,
		transport: agent.promptTransport,
	}),
);

export const DEFAULT_TERMINAL_PRESET_AGENT_TYPES =
	BUILTIN_TERMINAL_AGENTS.filter(
		(agent) => agent.includeInDefaultTerminalPresets,
	).map((agent) => agent.id) satisfies BuiltinTerminalAgentType[];
