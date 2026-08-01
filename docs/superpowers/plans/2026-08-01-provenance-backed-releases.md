# Provenance-backed releases implementation plan

**Goal:** Add a tag-bound, reproducible, attested GitHub Release pipeline.

### Task 1: Release contract
- Add failing tests for tag/version matching, dry-run dispatches, checksum verification, and SPDX output.
- Implement `scripts/lib/release-contract.mjs`.

### Task 2: Preparation CLI
- Add `scripts/prepare-release.mjs`.
- Emit SBOM, notes, and release metadata after validating deterministic distribution output.

### Task 3: Release workflow
- Add read-only validation and tag-only privileged publication jobs.
- Pin every action to a full commit SHA.
- Rebuild in the privileged job, create provenance and SBOM attestations, and publish with `gh release create`.

### Task 4: Repository integration
- Add `CHANGELOG.md`.
- Add syntax, unit, and workflow contract tests to `npm run check`.
