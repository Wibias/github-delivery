# Deterministic Skill Packaging Design

## Goal

Turn `shipping-github` into a versioned Agent Skill bundle that can be built twice from one source commit with byte-identical outputs and installed without silently overwriting an existing skill.

## Artifact contract

The build emits `dist/shipping-github/`, a ZIP, a tar.gz archive, `manifest.json`, and `SHA256SUMS`. Runtime payload includes the skill instructions, references, scripts, overrides, evaluation fixtures, package metadata, README, and license. Development plans, unit tests, GitHub workflows, `.git`, and prior build output are excluded.

Text payloads use LF endings. Archive paths, file order, timestamps, owners, and modes are normalized. The manifest records schema version, package version, source commit, byte size, mode, and SHA-256 for every payload file. Packaged `SKILL.md` receives Agent Skills metadata derived from `package.json`.

## Installation safety

The installer is dry-run by default. It classifies absent targets, symlinks, same-version installs, upgrades, downgrades, and incompatible files. Applying an install requires `--apply`; replacement creates a backup first. Downgrades require `--allow-downgrade`. Restore is explicit.

## Validation

Unit tests use temporary fixture repositories and verify file selection, reference validation, metadata injection, archive signatures, reproducibility, collision planning, backup behavior, and restore behavior. `npm run dist:check` performs two isolated builds and compares every output byte.
