# Provenance-backed releases design

## Goal

Publish deterministic Agent Skill archives only from an exact version tag, with independently regenerated artifacts, checksums, an SPDX SBOM, GitHub attestations, and a GitHub Release.

## Trust boundary

`workflow_dispatch` is validation-only. Publishing runs only for `refs/tags/v*` and only when the tag equals `v${package.version}`. The privileged job rebuilds from the tagged commit instead of trusting an uploaded workflow artifact.

The publish job receives only `contents: write`, `id-token: write`, and `attestations: write`. All external actions are pinned to full commit SHAs. GitHub CLI creates the release after checking that the tag has no existing release.

## Evidence

Release output includes the deterministic archives, distribution manifest, SHA-256 checksums, SPDX 2.3 SBOM, release notes, and a machine-readable preparation report. Provenance attestations cover both archives; the SBOM attestation binds the SPDX document to the ZIP distribution.
