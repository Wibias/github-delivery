# Update github-delivery

Use this workflow when the user asks to update or upgrade an installed `github-delivery` skill.

## Public path

The canonical updater is the installed skill's normal installer in release-update mode:

```text
node scripts/install-skill.mjs --update
node scripts/install-skill.mjs --update --apply
```

`--update` is a dry-run. It may discover, download, and verify a release candidate in a private temporary workspace, but it does not replace the installed skill. `--update --apply` uses the same verified path and may replace the installation only after the complete pre-mutation trust chain succeeds.

`scripts/update-skill.mjs` remains a compatibility entrypoint only. It forwards its arguments to `scripts/install-skill.mjs --update` and must not implement a second download, verification, extraction, or replacement path.

Unless the caller explicitly supplies `--target`, self-update targets the root of the installed bundle that is running `install-skill.mjs`.

## Source of truth

Update from the **latest published stable GitHub Release** of `Wibias/github-delivery` only.

- Never update from `main`, a branch, a fork, an arbitrary ref, a caller-supplied URL, or GitHub's automatically generated source archives.
- Ignore draft and prerelease releases.
- The release tag must be strict `vX.Y.Z` semantic versioning.
- Never downgrade through `--update`.
- If no stable release exists, report `stable_release_not_found` and stop.

`--update` rejects `--source`, `--restore`, and `--allow-downgrade`. These are separate local installation/recovery operations and cannot weaken release-update provenance.

## Verification chain

Before installation planning can authorize replacement, the updater must complete all of these checks:

1. Fetch and validate the fixed upstream repository's latest stable Release metadata.
2. Require exactly one version-matching ZIP, `manifest.json`, and `SHA256SUMS` asset.
3. Verify each required asset's GitHub `sha256:` digest when GitHub exposes one.
4. Verify the downloaded ZIP and `manifest.json` against strict `SHA256SUMS` entries.
5. Validate the distribution manifest schema, repository identity, version, source commit, file metadata, and safe relative paths.
6. Resolve the release tag through GitHub, peel annotated tags when needed, and require the resulting commit to equal `manifest.sourceCommit`.
7. Run `gh attestation verify` on the ZIP, pinned to repository `Wibias/github-delivery`, signer workflow `Wibias/github-delivery/.github/workflows/release.yml`, the exact release tag, and the resolved source commit. Missing or failed attestation verification has no checksum-only fallback.
8. Extract the verified ZIP with the strict archive reader. Reject traversal, absolute/Windows paths, links, unsupported compression or file types, duplicates, undeclared or missing files, manifest-byte mismatches, CRC failures, unsafe destinations, and configured expansion limits.
9. Rehash and size-check every extracted manifest file before the extracted directory can become an installation source.
10. Compare the current installed manifest with the target release before replacement. Local modifications block replacement when a newer release would otherwise be installed; they remain visible as diagnostics for current/ahead no-op states.

Transport failures, malformed metadata, redirect-policy violations, size-limit failures, verification mismatches, unsafe archives, and unavailable attestation verification all fail before installed-skill replacement.

## Procedure

1. Read the current configuration with `node scripts/github-delivery-config.mjs --show`.
2. Run the canonical dry-run:

   ```text
   node scripts/install-skill.mjs --update
   ```

3. Inspect the returned action:
   - `update`: a strictly newer verified stable release is available and the installed tracked payload is clean.
   - `already_current`: the installed version equals the latest stable release. No replacement is needed. Any reported local modifications are diagnostic only because no replacement is attempted.
   - `already_ahead`: the installed version is newer than the latest stable release. Do not downgrade it. Any reported local modifications are diagnostic only because no replacement is attempted.
   - `blocked_local_modifications`: a newer release exists, but tracked installed files differ from the installed manifest. Do not overwrite them.
4. If the action is `blocked_local_modifications`, show the affected paths and stop. `--force` does not bypass this self-update protection.
5. If the dry-run reports `update`, apply the same verified path:

   ```text
   node scripts/install-skill.mjs --update --apply
   ```

6. The existing installer creates the normal backup before replacement and remains authoritative for install, hook, and watchdog activation semantics.
7. After replacement, the updater reopens the installed target, requires its installed manifest to equal the separately verified release manifest, revalidates all manifest files, and rereads persistent user configuration. Any unexpected user-config change fails closed.
8. If replacement succeeded but a post-install verification fails, report the preserved backup path so the operator can restore it with the existing restore command. Never report the update as successful.
9. Inspect the new `references/configuration.md` and supported config schema. If the release introduces new options, defaults, migrations, or recommended settings, explain them and ask before changing anything.
10. Verify the installed version, effective config, and watchdog activation state.

## Configuration and watchdog trust

Persistent user configuration lives outside the skill payload and must remain unchanged by self-update.

A previously trusted Codex hook definition is not automatically trusted after an update if the exact hook definition changed. The normal installer rules remain authoritative:

- unchanged expected hooks may retain verified trust only under the existing explicit trust assertion rules;
- changed hook definitions report `hook_trust_required` until the user reviews and trusts the new exact definition;
- the updater never uses `--dangerously-bypass-hook-trust`;
- `stream` is reported only when the existing controlled-launch requirements are actually satisfied.

Do not silently reset user settings. Do not silently delete or replace local modifications. Do not opt the user into newly introduced settings merely because a release supports them.
