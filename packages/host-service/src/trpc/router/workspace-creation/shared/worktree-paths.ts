import { homedir } from "node:os";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";
import { TRPCError } from "@trpc/server";

// Kept outside the primary checkout so editors, file watchers, and
// ignore rules treat worktrees as separate trees, not nested ones.
export function defaultWorktreesRoot(): string {
	return join(homedir(), ".superset", "worktrees");
}

export function normalizeWorktreeBaseDir(
	input: string | null | undefined,
): string | null {
	const trimmed = input?.trim();
	if (!trimmed) return null;

	if (trimmed.startsWith("~")) {
		const rest = trimmed.slice(1);
		if (rest === "" || rest.startsWith("/") || rest.startsWith("\\")) {
			return normalize(join(homedir(), rest));
		}
	}

	if (!isAbsolute(trimmed)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Worktree location must be an absolute path or start with ~",
		});
	}

	return resolve(trimmed);
}

// Human-readable, filesystem-safe folder name for a project's worktrees.
// `<repoName-slug>-<short-id>` reads at a glance and stays shorter than the
// bare 36-char GUID (a win for Windows MAX_PATH). The 8-char GUID prefix keeps
// it collision-safe and stable per project even when two repos share a name.
export function projectDirName(
	projectId: string,
	repoName?: string | null,
): string {
	const slug = (repoName ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32);
	const shortId = projectId.slice(0, 8);
	return slug ? `${slug}-${shortId}` : shortId;
}

export function projectWorktreesRoot(
	projectId: string,
	worktreeBaseDir?: string | null,
	repoName?: string | null,
): string {
	return resolve(
		worktreeBaseDir ?? defaultWorktreesRoot(),
		projectDirName(projectId, repoName),
	);
}

export function safeResolveWorktreePath(
	projectId: string,
	branchName: string,
	worktreeBaseDir?: string | null,
	repoName?: string | null,
): string {
	const projectRoot = projectWorktreesRoot(
		projectId,
		worktreeBaseDir,
		repoName,
	);
	const worktreePath = resolve(projectRoot, branchName);
	if (
		worktreePath !== projectRoot &&
		!worktreePath.startsWith(projectRoot + sep)
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Invalid branch name: path traversal detected (${branchName})`,
		});
	}
	return worktreePath;
}
