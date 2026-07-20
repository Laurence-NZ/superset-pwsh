---
name: update-from-main
description: "Use whenever about to merge upstream `main` into the local-only Windows-port branch (`windows-superset-port`) — 'update from main', 'pull in main', 'merge main', 'sync with main', or `/update-from-main`. Refreshes `main`, merges it into the current branch, re-verifies the applied Windows patch commits survived the merge, re-applies any that upstream refactors broke, and reports what to test locally. Records the pre-merge SHA so the user can revert. Does NOT trigger for ordinary feature merges, pushing (this branch is never pushed), or applying a brand-new Windows patch from scratch."
---

# update-from-main

Merge upstream `main` into the Windows-port branch without losing the applied
Windows adaptations. The definitive list of those adaptations — plus the
unrelated bug fixes/features this branch carries — is
`docs/windows-port-patch-list.md`: commit-keyed patch entries (§1 Windows
support, §2 features & fixes), each with an invariant, the files it touches, and
a **Scan for** signature. Its **How to walk this list** section is the
authoritative per-entry procedure. Narrative context is the "Windows port"
section of `AGENTS.md`. Read the patch list before merging.

Run every step from the repo root. Use the `ask_user` tool for any question.

## 1. Preflight — record the escape hatch

- `git status --porcelain` must be empty. If dirty, stop and tell the user to commit/stash first.
- Capture and **print to the user** the current branch and HEAD so they can revert:
  - `git branch --show-current` (this is the Windows-port branch — return to it in step 3)
  - `git rev-parse HEAD` → this is the pre-merge SHA.
- Tell the user plainly: *"To undo this update later: `git reset --hard <SHA>` on `<branch>` (or `git merge --abort` mid-merge)."*

## 2. Refresh main

`git checkout main && git pull --ff-only`. If the pull isn't fast-forward, stop and surface it — `main` should never have local commits on this setup.

## 3. Merge into the Windows-port branch

- `git checkout <branch-from-step-1>`
- `git merge --no-ff main` — one merge commit; keep Windows adaptations in follow-up commits (per `AGENTS.md`).
- Resolve conflicts favouring the Windows adaptation (each patch-list entry names the files it touches). If `.git/index.lock` appears, delete it and retry.
- Commit the merge (resolved).

## 4. Re-verify every applied patch survived

Text auto-merges but behaviour breaks silently: upstream moves or rewrites a
file and the adaptation vanishes with no conflict marker. Walk **every entry**
in `docs/windows-port-patch-list.md`, following its **How to walk this list**
section. Per entry:

- `git show <commit-hash>` (from the entry's **Commits**) to see the original change.
- Confirm the target file still exists and still carries the adaptation.
- Run the entry's **Scan for** signature against the merged-in diff to catch *new* violation sites (see the general reminder below).
- Apply the entry's **Override policy**: LOCKED → keep ours; OVERRIDABLE → if upstream now ships the equivalent fix/feature, notify the user and let them decide before switching.
- If upstream refactored ours away, re-apply it (the entry's **Invariant / Why** is the intent), then commit it **separately** with a `fix(...)` message describing the Windows re-adaptation. One commit per adaptation so the integration and the Windows work review apart.

Also scan the merged-in upstream diff for **new** code that needs the same
treatment an existing patch applies (e.g. a new `child_process` spawn without
`windowsHide`, a new terminal command joined with `&&` instead of shell-aware
chaining, a new Unix-socket path). Patch and commit those the same way.

**Update `docs/windows-port-patch-list.md` whenever the walk changes the truth
it records** — it's the SSOT and goes stale otherwise:
- Re-applied a patch or patched a **new** violation site → append the new
  `fix(...)` commit hash to that entry's **Commits** (and widen **Where** if the
  surface grew).
- Dropped an **OVERRIDABLE** patch because upstream now ships the equivalent
  (with the user's go-ahead) → delete the entry, noting the upstream replacement.
- The merge surfaces a genuinely new invariant to protect → add a new entry in
  the right section (§1/§2) with its Commits, Invariant/Why, Where, Scan for,
  and Override policy.

Commit the patch-list edit alongside the change it documents, not as an
afterthought — and call it out in the step 6 report (which entries you added,
extended, or removed) so the user knows the SSOT moved.

## 5. Validate

- Run `bun i` to ensure dependencies are up-to-date.
- `bun run typecheck` — upstream frequently changes a shared helper's signature (`resolveScript`, `writeTempAskpass`, …) that the Windows layer builds on; the types break with no conflict marker. Must pass.
- `bun run lint` must exit 0 (CI treats warnings as errors). `biome lineEnding` stays `lf` — never let it flip to `auto`. Run `bun run lint:fix` for auto-fixes.

## 6. Report what to test locally

The user validates by running `bun run dev:desktop`. Do not claim runtime
correctness — you can't observe it. List concrete things to check, driven by
what the merge actually touched.

**Derive each check from the patch list — don't keep a hardcoded list here.**
For every patch you re-applied (or every entry whose surface the merge touched),
read that entry's **Where** (the surface to exercise) and **Symptom if broken**
(what failure looks like), and turn them into a concrete manual step. That keeps
this step correct as entries are added, instead of drifting from the SSOT.

Example of the shape (for a re-applied W-entry touching terminals/pty): open a
V2 terminal, run a bare command (`git status`) to confirm PATHEXT/PowerShell env
(W9), and run an auto-executing preset to confirm `\r` / `&&` handling (W19/W7).

If nothing in the applied-patch surface changed, say so — testing is lower-risk.

**Report any patch-list changes** from step 4: name each entry you added,
extended (new commit hash / widened Where), or removed (OVERRIDABLE dropped for
upstream), so the user knows the SSOT moved and can eyeball the edits.

End by restating the pre-merge SHA and the revert command.
