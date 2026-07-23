---
name: release
description: "Use whenever about to publish a Windows desktop build to the GitHub fork — 'cut a release', 'publish the build', 'release to github', 'upload the latest build', or `/release`. Takes the already-built `.exe` from `apps/desktop/release/`, cuts a GitHub release on the `Laurence-NZ/superset-pwsh` fork with the fork's tag/title/notes format, and handles the version-collision `b`/`c`/… suffix when a release for that version already exists. Assumes the build is already done. Does NOT trigger for building the app, for upstream releases (`bun run release`, `scripts/release/`), or for opening PRs."
---

# release

Publish the already-built native-Windows x64 desktop binary as a GitHub release
on the fork **`Laurence-NZ/superset-pwsh`**. This skill only *uploads* — the
`.exe` must already exist in `apps/desktop/release/` (the user builds with
`bun run dev:desktop` / the desktop build step first).

This is separate from upstream's `bun run release` / `scripts/release/` flow,
which does not apply to this Windows fork.

Run every step from the repo root. Use the question tool for any question — never
ask in plain text.

## The format (copied from existing releases — do not deviate)

For a build of version `X.Y.Z` the canonical release is:

- **Tag:** `vX.Y.Z-win-x64`
- **Title:** `superset-pwsh X.Y.Z`
- **Asset:** `apps/desktop/release/Superset-X.Y.Z-x64.exe` (the `.exe` only — not
  the `.blockmap` or `latest.yml`)
- **Notes** (the `version X.Y.Z` line always uses the **base** version, never the
  suffix):

  ```
  Unofficial native-Windows x64 build of [Superset](https://github.com/superset-sh/superset), version X.Y.Z.

  Windows-specific changes are catalogued in [`docs/windows-port-patch-list.md`](https://github.com/Laurence-NZ/superset-pwsh/blob/main/docs/windows-port-patch-list.md).

  ---

  This is a modified build of [Superset](https://github.com/superset-sh/superset) with native Windows x64 support.
  Not affiliated with or endorsed by Superset, Inc. Licensed under the Elastic License 2.0.
  ```

- Published live (not a draft, not a prerelease).

### Version-collision suffix

If a release for the version already exists, the version gets a **letter suffix
in the tag and title** — the first re-release of `X.Y.Z` is `X.Y.Zb`, the next
`X.Y.Zc`, and so on (`a` is the implicit first, unsuffixed release). Example
seen in the wild: `v1.16.1-win-x64` → `v1.16.1b-win-x64` (title
`superset-pwsh 1.16.1b`).

The suffix appears **only** in the tag and title. The uploaded `.exe` filename
and the `version X.Y.Z` line in the notes keep the **base** version.

## Procedure

1. **Read the version** from `apps/desktop/package.json` — call it `VERSION`
   (e.g. `1.16.1`).

2. **Locate the built `.exe`:** `apps/desktop/release/Superset-$VERSION-x64.exe`.
   - If it's missing, stop and tell the user to build first — do not release a
     stale binary.
   - Sanity-check it's freshly built (newest mtime in the folder). If an older
     build looks newer than the matching-version `.exe`, flag it via the
     question tool before continuing.

3. **Ensure the fork's `main` is at the commit you're releasing.** Releases are
   cut from the fork's default branch (`main`), so its HEAD must match your local
   HEAD or the tag will point at the wrong (older) commit.

   ```bash
   git rev-parse HEAD
   gh api repos/Laurence-NZ/superset-pwsh/commits/main -q .sha
   ```

   If they differ, confirm with the user, then push this branch to the fork's
   `main`:

   ```bash
   git push fork HEAD:main
   ```

4. **Pick the tag** — find the first free suffix. Base is `vX.Y.Z-win-x64`;
   on collision try `b`, `c`, `d`, … The existing tags:

   ```bash
   gh api repos/Laurence-NZ/superset-pwsh/tags --paginate -q '.[].name' | grep -F "v$VERSION"
   ```

   - If `v$VERSION-win-x64` is absent → `TAG=v$VERSION-win-x64`, `TITLE_VER=$VERSION`.
   - Otherwise walk `b`, `c`, … until `v${VERSION}${letter}-win-x64` is free →
     `TAG=v${VERSION}${letter}-win-x64`, `TITLE_VER=${VERSION}${letter}`.

5. **Create the release** (publishes live). Write the notes to a temp file to
   keep the exact formatting, substituting the **base** `$VERSION`:

   ```bash
   gh release create "$TAG" \
     --repo Laurence-NZ/superset-pwsh \
     --title "superset-pwsh $TITLE_VER" \
     --notes-file <notes-file> \
     "apps/desktop/release/Superset-$VERSION-x64.exe"
   ```

6. **Report** the release URL (`gh release view "$TAG" --repo
   Laurence-NZ/superset-pwsh --json url -q .url`) and the tag/title used.

## Notes

- The `.exe` is ~500 MB; the upload takes a while — let it finish, don't retry on
  a slow-looking upload.
- Never touch upstream `origin` (`superset-sh/superset`). All release operations
  target `--repo Laurence-NZ/superset-pwsh`.
