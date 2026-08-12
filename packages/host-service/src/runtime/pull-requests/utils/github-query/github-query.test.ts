import { describe, expect, test } from "bun:test";
import type { ExecGhOptions } from "../../../../trpc/router/workspace-creation/utils/exec-gh";
import {
	fetchOpenPullRequestsFromGh,
	fetchPullRequestByHeadFromGh,
	fetchPullRequestChecksFromGh,
	fetchPullRequestMergeQueueStateFromGh,
	fetchPullRequestReviewDecisionFromGh,
} from "./github-query";

interface GhCall {
	args: string[];
	options?: ExecGhOptions;
}

function createExecGh(responses: unknown[]) {
	const calls: GhCall[] = [];
	const execGh = async (args: string[], options?: ExecGhOptions) => {
		calls.push(options ? { args, options } : { args });
		const response = responses.shift();
		if (response instanceof Error) throw response;
		return response;
	};

	return { calls, execGh };
}

describe("GitHub pull request REST queries", () => {
	test("fetches only the PR matching the requested upstream head", async () => {
		const { calls, execGh } = createExecGh([
			[
				{
					number: 42,
					title: "Fix sidebar",
					html_url: "https://github.com/superset-sh/superset/pull/42",
					state: "open",
					draft: false,
					merged_at: null,
					updated_at: "2026-05-08T12:00:00Z",
					head: {
						ref: "fix/sidebar",
						sha: "abc123",
						repo: {
							name: "superset",
							owner: { login: "superset-sh" },
						},
					},
					base: {
						repo: {
							full_name: "superset-sh/superset",
						},
					},
				},
			],
		]);

		const result = await fetchPullRequestByHeadFromGh(
			execGh,
			{ owner: "superset-sh", name: "superset" },
			{ owner: "superset-sh", repo: "superset", branch: "fix/sidebar" },
		);

		expect(result).toEqual({
			number: 42,
			title: "Fix sidebar",
			url: "https://github.com/superset-sh/superset/pull/42",
			state: "OPEN",
			isDraft: false,
			headRefName: "fix/sidebar",
			headRefOid: "abc123",
			isCrossRepository: false,
			headRepositoryOwner: { login: "superset-sh" },
			headRepository: { name: "superset" },
			updatedAt: "2026-05-08T12:00:00Z",
		});
		expect(calls).toEqual([
			{
				args: [
					"api",
					"--method",
					"GET",
					"repos/superset-sh/superset/pulls",
					"-f",
					"state=all",
					"-f",
					"head=superset-sh:fix/sidebar",
					"-f",
					"sort=updated",
					"-f",
					"direction=desc",
					"-f",
					"per_page=10",
				],
			},
		]);
	});

	test("ignores a closed PR that hasn't been updated in over a month", async () => {
		const { execGh } = createExecGh([
			[
				{
					number: 123,
					title: "stale closed pull request",
					html_url: "https://github.com/example-org/example-repo/pull/123",
					state: "closed",
					draft: false,
					merged_at: null,
					updated_at: "2000-01-01T00:00:00Z",
					head: {
						ref: "develop",
						sha: "old123",
						repo: { name: "example-repo", owner: { login: "example-org" } },
					},
					base: { repo: { full_name: "example-org/example-repo" } },
				},
			],
		]);

		const result = await fetchPullRequestByHeadFromGh(
			execGh,
			{ owner: "example-org", name: "example-repo" },
			{ owner: "example-org", repo: "example-repo", branch: "develop" },
		);

		expect(result).toBeNull();
	});

	test("still links a stale but open PR regardless of age", async () => {
		const { execGh } = createExecGh([
			[
				{
					number: 7,
					title: "Long-lived feature",
					html_url: "https://github.com/superset-sh/superset/pull/7",
					state: "open",
					draft: false,
					merged_at: null,
					updated_at: "2000-01-01T00:00:00Z",
					head: {
						ref: "feature/long",
						sha: "abc123",
						repo: { name: "superset", owner: { login: "superset-sh" } },
					},
					base: { repo: { full_name: "superset-sh/superset" } },
				},
			],
		]);

		const result = await fetchPullRequestByHeadFromGh(
			execGh,
			{ owner: "superset-sh", name: "superset" },
			{ owner: "superset-sh", repo: "superset", branch: "feature/long" },
		);

		expect(result?.number).toBe(7);
	});

	test("filters REST head candidates by exact upstream repository", async () => {
		const { execGh } = createExecGh([
			[
				{
					number: 41,
					title: "Wrong fork",
					html_url: "https://github.com/superset-sh/superset/pull/41",
					state: "open",
					draft: false,
					merged_at: null,
					updated_at: "2026-05-08T12:05:00Z",
					head: {
						ref: "fix/sidebar",
						sha: "wrong",
						repo: {
							name: "other-repo",
							owner: { login: "fork-owner" },
						},
					},
					base: {
						repo: {
							full_name: "superset-sh/superset",
						},
					},
				},
				{
					number: 42,
					title: "Right fork",
					html_url: "https://github.com/superset-sh/superset/pull/42",
					state: "open",
					draft: false,
					merged_at: null,
					updated_at: "2026-05-08T12:00:00Z",
					head: {
						ref: "fix/sidebar",
						sha: "abc123",
						repo: {
							name: "fork-repo",
							owner: { login: "Fork-Owner" },
						},
					},
					base: {
						repo: {
							full_name: "superset-sh/superset",
						},
					},
				},
			],
		]);

		const result = await fetchPullRequestByHeadFromGh(
			execGh,
			{ owner: "superset-sh", name: "superset" },
			{ owner: "fork-owner", repo: "fork-repo", branch: "fix/sidebar" },
		);

		expect(result?.number).toBe(42);
		expect(result?.headRepositoryOwner?.login).toBe("Fork-Owner");
		expect(result?.headRepository?.name).toBe("fork-repo");
	});

	// The per-head candidate filter is exact on the branch: it must NOT match a
	// case-variant head, so distinct case-variant branches never cross-match
	// here. Case drift is recovered by the runtime's open-PR sweep instead.
	test("does not match a case-variant branch in per-head filtering", async () => {
		const { execGh } = createExecGh([
			[
				{
					number: 43,
					title: "Case drift",
					html_url: "https://github.com/superset-sh/superset/pull/43",
					state: "open",
					draft: false,
					merged_at: null,
					updated_at: "2026-05-08T12:00:00Z",
					head: {
						ref: "Roshvan/fix-thing",
						sha: "abc123",
						repo: {
							name: "superset",
							owner: { login: "superset-sh" },
						},
					},
					base: {
						repo: {
							full_name: "superset-sh/superset",
						},
					},
				},
			],
		]);

		const result = await fetchPullRequestByHeadFromGh(
			execGh,
			{ owner: "superset-sh", name: "superset" },
			{ owner: "superset-sh", repo: "superset", branch: "roshvan/fix-thing" },
		);

		expect(result).toBeNull();
	});

	test("sweeps open PRs sorted by most recently updated", async () => {
		const { calls, execGh } = createExecGh([
			[
				{
					number: 44,
					title: "Open sweep",
					html_url: "https://github.com/superset-sh/superset/pull/44",
					state: "open",
					draft: false,
					merged_at: null,
					updated_at: "2026-05-08T12:00:00Z",
					head: {
						ref: "Roshvan/fix-thing",
						sha: "def456",
						repo: {
							name: "superset",
							owner: { login: "superset-sh" },
						},
					},
					base: {
						repo: {
							full_name: "superset-sh/superset",
						},
					},
				},
				{ number: "not-a-pr" },
			],
		]);

		const result = await fetchOpenPullRequestsFromGh(execGh, {
			owner: "superset-sh",
			name: "superset",
		});

		expect(result).toHaveLength(1);
		expect(result[0]?.number).toBe(44);
		expect(calls).toEqual([
			{
				args: [
					"api",
					"--method",
					"GET",
					"repos/superset-sh/superset/pulls",
					"-f",
					"state=open",
					"-f",
					"sort=updated",
					"-f",
					"direction=desc",
					"-f",
					"per_page=100",
					"--jq",
					expect.stringContaining("html_url"),
				],
				options: { maxBuffer: 16 * 1024 * 1024 },
			},
		]);
		// The projection must keep every field normalizePullRequest reads;
		// dropping one silently discards PRs from the sweep.
		const jqExpression = calls[0]?.args.at(-1) ?? "";
		for (const field of [
			"number",
			"title",
			"html_url",
			"state",
			"merged_at",
			"draft",
			"updated_at",
			".head.ref",
			".head.sha",
			".head.repo.name",
			".head.repo.owner.login",
			".head.user.login",
			".base.repo.full_name",
		]) {
			expect(jqExpression).toContain(field);
		}
	});

	test("derives review decision from latest REST reviews by author", async () => {
		const { calls, execGh } = createExecGh([
			[
				{
					user: { login: "a" },
					state: "APPROVED",
					submitted_at: "2026-05-08T12:00:00Z",
				},
				{
					user: { login: "a" },
					state: "CHANGES_REQUESTED",
					submitted_at: "2026-05-08T12:05:00Z",
				},
			],
		]);

		const result = await fetchPullRequestReviewDecisionFromGh(
			execGh,
			{ owner: "superset-sh", name: "superset" },
			42,
			"OPEN",
		);

		expect(result).toBe("CHANGES_REQUESTED");
		expect(calls).toEqual([
			{
				args: [
					"api",
					"--method",
					"GET",
					"repos/superset-sh/superset/pulls/42/reviews",
					"-f",
					"per_page=100",
				],
			},
		]);
	});

	test("keeps open PRs pending when no terminal review exists", async () => {
		const { execGh } = createExecGh([[]]);

		const result = await fetchPullRequestReviewDecisionFromGh(
			execGh,
			{ owner: "superset-sh", name: "superset" },
			42,
			"OPEN",
		);

		expect(result).toBe("REVIEW_REQUIRED");
	});

	test("fetches check runs and commit statuses for the matched PR head SHA", async () => {
		const { calls, execGh } = createExecGh([
			{
				check_runs: [
					{
						name: "Typecheck",
						conclusion: "success",
						details_url: "https://github.com/superset-sh/superset/actions/1",
						status: "completed",
						started_at: "2026-05-08T12:00:00Z",
						completed_at: "2026-05-08T12:03:00Z",
					},
				],
			},
			[
				{
					context: "CodeRabbit",
					state: "success",
					target_url: "https://coderabbit.ai",
					created_at: "2026-05-08T12:04:00Z",
				},
			],
		]);

		const result = await fetchPullRequestChecksFromGh(
			execGh,
			{ owner: "superset-sh", name: "superset" },
			"abc123",
		);

		expect(result).toEqual([
			{
				__typename: "CheckRun",
				name: "Typecheck",
				conclusion: "SUCCESS",
				detailsUrl: "https://github.com/superset-sh/superset/actions/1",
				status: "COMPLETED",
				startedAt: "2026-05-08T12:00:00Z",
				completedAt: "2026-05-08T12:03:00Z",
				checkSuite: null,
			},
			{
				__typename: "StatusContext",
				context: "CodeRabbit",
				state: "SUCCESS",
				targetUrl: "https://coderabbit.ai",
				createdAt: "2026-05-08T12:04:00Z",
			},
		]);
		expect(calls).toEqual([
			{
				args: [
					"api",
					"--method",
					"GET",
					"repos/superset-sh/superset/commits/abc123/check-runs",
					"-f",
					"per_page=100",
				],
			},
			{
				args: [
					"api",
					"--method",
					"GET",
					"repos/superset-sh/superset/commits/abc123/statuses",
					"-f",
					"per_page=100",
				],
			},
		]);
	});

	test("detects a PR sitting in the merge queue via GraphQL", async () => {
		const { calls, execGh } = createExecGh([
			{
				data: {
					repository: { pullRequest: { mergeQueueEntry: { id: "MQE_1" } } },
				},
			},
		]);

		const result = await fetchPullRequestMergeQueueStateFromGh(
			execGh,
			{ owner: "superset-sh", name: "superset" },
			42,
		);

		expect(result).toBe(true);
		expect(calls).toEqual([
			{
				args: [
					"api",
					"graphql",
					"-f",
					"query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){mergeQueueEntry{id}}}}",
					"-f",
					"owner=superset-sh",
					"-f",
					"name=superset",
					"-F",
					"number=42",
				],
			},
		]);
	});

	test("reports not-queued when mergeQueueEntry is null", async () => {
		const { execGh } = createExecGh([
			{ data: { repository: { pullRequest: { mergeQueueEntry: null } } } },
		]);

		const result = await fetchPullRequestMergeQueueStateFromGh(
			execGh,
			{ owner: "superset-sh", name: "superset" },
			42,
		);

		expect(result).toBe(false);
	});
});
