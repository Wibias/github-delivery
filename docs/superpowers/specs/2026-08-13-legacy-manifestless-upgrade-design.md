# Legacy Manifestless Upgrade Design

## Problem

GitHub Delivery releases now use `manifest.json` as the trust and integrity boundary for discovery and stable self-update. Installations created before that distribution format can still be genuine GitHub Delivery installations but have no manifest. The bootstrap currently reports these installations as `missing_manifest`, excludes them from update target selection, and the stable update planner fails with `installed_manifest_missing`.

A user therefore cannot use the supported update path to migrate a genuine pre-manifest installation into the managed release format.

## Goal

Allow a recognized pre-manifest GitHub Delivery installation to migrate to the latest verified stable release without weakening the normal manifest integrity rules.

## Non-goals

- Do not infer that arbitrary manifestless directories are safe GitHub Delivery installations.
- Do not invent an integrity result for files that have no trusted manifest.
- Do not preserve unknown local modifications in place.
- Do not permit a downgrade during legacy migration.
- Do not change normal managed-installation update behavior.

## Recognition

A manifestless target is migratable only when all of these conditions hold:

1. `manifest.json` is absent.
2. `package.json` exists, parses as JSON, has `name: "github-delivery"`, and has a semantic `x.y.z` version.
3. `SKILL.md` exists and its YAML frontmatter contains `name: github-delivery`.
4. `scripts/install-skill.mjs` exists.

A recognized target is reported as `legacy_manifestless`. It is not treated as a normal managed installation because its file integrity cannot be proven.

## Update flow

The stable update flow first acquires and verifies the release exactly as it does today: release metadata, required assets, checksums, GitHub asset digests when present, source commit, attestation, archive contents, and manifest.

When the target is a recognized manifestless installation:

- if the installed version is newer than the verified stable release, return `already_ahead` and do not replace it;
- if the installed version is equal to or older than the verified stable release, return a `migrate_legacy` plan;
- the migration may only be applied from the already verified release candidate;
- the entire existing target is moved to the normal backup location before replacement;
- the verified release payload replaces the target, including its `manifest.json`;
- post-install manifest verification must succeed using the existing verification path.

The legacy path does not claim that the previous installation was clean. Its integrity is explicitly unknown.

## Discovery and doctor UX

Discovery distinguishes these states:

- managed valid installation;
- recognized `legacy_manifestless` installation that is migratable;
- invalid manifest;
- missing manifest on an unrecognized explicit target.

`update` target selection accepts managed and migratable installations. `setup` continues to require a managed installation.

`doctor` can select and report a recognized legacy installation. It shows the installed version, marks integrity as unavailable because the manifest is missing, and reports whether the latest stable release is current, newer, or older. It tells the user that migration is available through the normal update command.

## Safety properties

- Legacy recognition uses multiple GitHub Delivery identity markers, not path name alone.
- No legacy file hashes are trusted or synthesized.
- A verified stable release is still mandatory before any replacement.
- Migration never downgrades.
- Replacement uses the existing full-directory backup mechanism.
- Normal manifest-backed update safety remains unchanged.
- Setup does not activate against a legacy installation before migration.

## Tests

Regression coverage must prove:

1. Discovery classifies a genuine pre-manifest fixture as migratable and does not classify an arbitrary manifestless target that way.
2. `update` can select a migratable target while `setup` still rejects it.
3. Stable update planning returns `migrate_legacy` for same-version and older recognized installations, and `already_ahead` for a newer one.
4. Applying a verified legacy migration backs up the previous directory and installs the manifest-backed payload.
5. Doctor reports the legacy state without pretending file integrity is known.
6. Existing managed-installation tests remain unchanged and green.
