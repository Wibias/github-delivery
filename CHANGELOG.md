# Changelog

All notable changes to `github-delivery` are documented here.

## [Unreleased]

### Added

- Same-head full-review verdict anti-noise (PR #1066): second full-review
  runs on the exact same head reuse the completed format-valid verdict when
  the label and required TLDR bullets are unchanged. Machine helper:
  `planVerdictPublication` in `scripts/lib/verdict-publication.mjs`; verifier
  supports `--allow-same-head-reuse` + `--body-file`.

- Verdict format gate: `scripts/verify-verdict-published.mjs` now requires
  `published: true` **and** `format.valid: true`. The verifier enforces the
  strict `## [GD] Verdict: <label>` heading, a `### TLDR` block with every
  required bullet, and the full verdict inside a `<details>` dropdown after
  the TLDR; a comment failing the gate must be repaired, never marked
  published.

## [0.1.0] - 2026-08-01

### Added

- Natural-language routing for PR review, status, watch, remediation, and merge workflows.
- Snapshot-backed authoritative ship decisions with base-health isolation.
- Guarded GitHub mutation profiles and runtime capability discovery.
- Executable offline routing and retained-regression evaluations.
- Deterministic versioned skill bundles with checksums, installation planning, backups, and restore.
- Tag-bound GitHub Releases with checksum verification, SPDX SBOMs, and artifact attestations.
- Dependabot, Dependency Review, CodeQL, Scorecard, and executable repository workflow policy checks.
