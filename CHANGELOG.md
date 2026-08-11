# Changelog

All notable changes to `github-delivery` are documented here.

## [Unreleased]

### Added

- Supersede and maintainer-overtake lifecycle actions. A new
  `references/supersede-pr.md` workflow closes an obsolete open PR in favor of
  a replacement PR through the broker `supersede_pr` action (never a bare
  `gh pr close`), names the replacement in the close comment, verifies the
  replacement carries the superseded scope, and keeps linked issues open unless
  the replacement owns them. A new `references/overtake-pr.md` workflow lets a
  maintainer take over an unresponsive author's PR: confirm the author is
  unavailable and the maintainer can push, then run the normal
  `fix-pr-bots` merge-ready bar on the now-owned branch, or
  close-with-reference when the change cannot be finished. Routing
  (`scripts/lib/skill-router.mjs`), workflow/mutation-mode compatibility
  (`scripts/lib/workflow-mode.mjs`), mutation policy (`close_pr`,
  `supersede_pr` in `scripts/lib/mutation-policy.mjs`), broker commands and
  verification (`scripts/lib/github-mutation-broker.mjs`), shared-rules
  contract, offline evals, and unit tests cover the new actions.

- gh-stack-derived stack operational practices in `references/stacked-prs.md`:
  restack work enables `git rerere` (conflict memory across cascading
  rebases); the push remote is resolved via `remote.pushDefault` instead of a
  hardcoded `origin` (multi-remote safety); review/readiness/merge are gated
  on a parent-ancestor `needsRebase` preflight; edits are made only on the
  layer that owns the path; and a merge-queue base may enqueue the contiguous
  lower stack all-or-nothing (per-PR readiness still required before
  enqueue). Regression case `R-stack-restack-preflight-2026-08-05` pins the
  contract.

- Machine-checkable probe-application evidence. The bug and security axes are
  no longer complete on assertion alone: the review must emit a
  `{ probeId, status, files?, reason? }` record for every `requiredProbes[]`
  id and `scripts/verify-probe-coverage.mjs` must exit `0`. Statuses are
  enforced (`clean` / `findings` / `n-a`; n-a requires a concrete reason;
  findings requires reviewed files that are the probe's trigger files; unknown
  or non-required probes are rejected). Regression case
  `R-probe-evidence-required-2026-08-05` pins the contract.

- Deterministic diff-shape → probe routing. Every bug class is a named probe
  declared in `scripts/lib/probe-registry.mjs` (axis, lens/surface, trigger
  regexes, assertion markers). `planReviewScope` now emits `requiredProbes`
  from the diff's added/removed lines and changed paths, and the reference
  docs carry a `<!-- probe: … -->` tag on each Must-probe block. The offline
  evals (`validate-evals.mjs`) execute `tests/evals/scope-cases.jsonl`
  fixtures asserting the exact probe set each CodeRabbit/Codex diff-shape
  class must route to, and verify every probe is tagged in a doc that also
  carries its assertion markers. A trigger that stops firing, a dropped
  probe tag, or an assertion moved off its probe's doc is now a CI break.

- Regression-assertion → probe-anchor binding: `scripts/validate-evals.mjs`
  now requires every `regression-cases.jsonl` assertion id to carry a
  `<!-- assertion: <id> -->` marker inside one of the case's expected
  resources. Deleting or renaming a Must-probe rule in `references/` /
  `SKILL.md` without updating its regression case now fails the offline
  evals (`assertion_not_bound` / `assertion_not_in_expected_resources` /
  `assertion_marker_orphan`), so documented bot-finding classes can no
  longer drift away from their regression cases silently. All 199 retained
  regression assertions are anchored across `references/bug-review.md`,
  `references/security-review.md`, `references/fix-pr-bots.md`,
  `references/spec-standards-review.md`, `references/watch-pr.md`,
  `references/shared-rules.md`, `references/full-review-pr.md`,
  `references/comment-depth.md`, `references/stacked-prs.md`,
  `references/merge-pr.md`, and `SKILL.md`.

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

## [0.2.0] - 2026-08-11

### Added

- Added a layered runtime progress watchdog that detects repeated no-progress
  intent narration, blocks exact stable reads on unchanged state, rate-limits
  volatile status polling, compacts oversized model-facing tool output, and
  rejects oversized subagent briefs in favor of focused source-referenced
  context. The watchdog never grants mutation authority or executes GitHub
  writes.
- Added opt-in Codex lifecycle hooks for `PreToolUse`, `PostToolUse`, `Stop`,
  `SubagentStop`, and `SessionEnd`, plus a Codex App Server streaming proxy
  that can issue one private `turn/interrupt` while pathological repeated
  narration is still being generated. Runtime capability reporting now
  distinguishes `none`, `hooks`, and `stream`.

### Changed

- Added evidence/context economy rules that prefer authoritative aggregate
  reads, reuse valid state snapshots, keep deterministic gate interpretation
  out of unnecessary subagents, and escalate diagnostics from status to a
  focused failing excerpt before loading full raw output. Pending-only required
  CI is owned by `scripts/ci-wait.mjs` instead of parallel manual polling.
- Refreshed the README with a faster natural-language quick start, repository
  workflow visuals, clearer safety/value positioning, and user-facing setup
  and architecture documentation for the progress watchdog.

## [0.1.1] - 2026-08-11

### Fixed

- Prevented severe no-progress agent loops after a GitHub mutation is already
  prepared by adding the global `GD-CORE-008` bounded forward-progress rule.
- Prepared GitHub writes now cross directly into `github-mutate.mjs` once the
  required evidence and authority are satisfied. Re-verification remains
  required after relevant state changes, failed or ambiguous tool results, or
  explicit workflow freshness requirements.
- Added regression coverage that fails when unchanged-state re-planning can
  replace the next required tool call or mutation.

## [0.1.0] - 2026-08-01

### Added

- Natural-language routing for PR review, status, watch, remediation, and merge workflows.
- Snapshot-backed authoritative ship decisions with base-health isolation.
- Guarded GitHub mutation profiles and runtime capability discovery.
- Executable offline routing and retained-regression evaluations.
- Deterministic versioned skill bundles with checksums, installation planning, backups, and restore.
- Tag-bound GitHub Releases with checksum verification, SPDX SBOMs, and artifact attestations.
- Dependabot, Dependency Review, CodeQL, Scorecard, and executable repository workflow policy checks.
