# Changelog

All notable changes to `github-delivery` are documented here.

## [Unreleased]

### Added

- Pending PR #246 will add a guided Windows approval-GUI choice. Fresh interactive installs will explain the optional component and ask `Install the Windows approval GUI now? [Y/n]`; explicit consent will install the separately verified Authority host without changing an `off` protection mode, while No will finish the skill install without the GUI.

### Changed

- Pending PR #245 will make Windows Authority builds reproducible across local, CI, and release environments by pinning exact .NET SDK 10.0.303 and rejecting self-contained publishes that do not contain Microsoft.NETCore.App runtime 8.0.30.

## [0.6.0] - 2026-08-14

### Fixed

- Bounded `create_pr` idempotency lookup to the requested head branch instead of enumerating every pull request in the repository (PR #244), avoiding pagination overflow and unrelated-PR matches on high-volume repositories.

## [0.5.3] - 2026-08-13

### Added

- Safe migration for genuine legacy manifestless installations (PR #240). Recognized pre-manifest GitHub Delivery targets are identified through multiple identity markers, reported with explicitly unknown prior file integrity, and can migrate through the normal verified stable `update` path. Migration requires an already-verified release candidate, never downgrades, backs up the entire previous target before replacement, installs the manifest-backed payload, and keeps `setup` restricted to managed installations until migration completes.

### Changed

- Verified Codex hook trust now survives normal reinstalls when the exact hook definitions are unchanged (PR #239). A hook-definition change still invalidates the verified trust receipt. Guided install and `doctor` now describe unverified trust factually and only direct users to `/hooks` when review may actually be needed.

### Fixed

- Closed watchdog classifier gaps exposed by a real OpenCodex GUI task (PR #243). Assignment-prefixed PowerShell reads such as `$c=Get-Content ...` now consume the evidence budget, while Bun validation commands (`bun test` and `bun run test|check|lint|build|typecheck|verify`, including scoped scripts) count as execution progress. Regression coverage pins the warning at the 8th consecutive evidence attempt, the block on the 12th, and the Bun execution reset behavior.

## [0.5.2] - 2026-08-12

### Added

- First-class Node.js 26 support across the npm engine contract, bootstrap
  environment validation, generated skill compatibility metadata, and the
  required CI matrix. The supported runtime set is now Node.js 22, 24, or 26,
  with all three majors exercised on Ubuntu, Windows, and macOS.

- Actionable bootstrap health reporting. Guided install now runs the real
  environment preflight before release acquisition or mutation and fails early
  on unsupported/missing prerequisites. After a successful guided install it
  prominently reports when loop interruption is not active, including the
  `/hooks` trust step and `npx github-delivery setup` remediation. `doctor` is
  now human-readable by default, surfaces environment, installed version and
  integrity, Authority status, and a prominent `LOOP INTERRUPTION NOT ACTIVE`
  state; `doctor --json` preserves the raw machine-readable report.

- First-class stable Windows Authority-host delivery and Control Center settings.
  Releases now build a self-contained `win-x64` Authority component from the
  exact tagged commit, publish versioned ZIP + metadata assets, and attest the
  archive through the protected `release.yml` identity. Stable `setup`,
  `doctor`, and `update --apply` can verify/install/repair/upgrade that component
  without a local .NET SDK while preserving `authority.db`, `trust-store.json`,
  and persistent user config. An absent host remains absent when protection is
  `off`; an already-installed host is kept aligned even when the skill itself
  is current; ahead hosts are not automatically downgraded. The WinUI Control
  Center Settings view now writes the existing `off` / `high-assurance` / `all`
  preference and reports stored/effective mode plus Authority version/source
  status. `doctor` reports `missing`, `legacy`, `update`, `already_current`, or
  `already_ahead` component relations and whether the active mode requires the
  host.

- Verified stable self-update for installed skills. `node scripts/install-skill.mjs
  --update` now performs a non-mutating check against the fixed upstream's
  latest published stable Release, while `--update --apply` reuses the existing
  backup/replacement installer only after release metadata, GitHub asset digests
  when exposed, `SHA256SUMS`, the distribution manifest, tag-to-source-commit
  binding, a workflow/tag/commit-constrained GitHub artifact attestation, and a
  strict bounded ZIP extraction all verify successfully. Local installed
  modifications block skill replacement even with `--force`; an already-ahead
  skill is a complete no-op, while an already-current skill can still reconcile
  a stale/legacy Authority component; update mode cannot use `--source`,
  `--restore`, or `--allow-downgrade`; post-install manifest verification and
  persistent user config preservation fail closed and surface the backup path
  after a completed skill replacement. `scripts/update-skill.mjs` is now only a
  compatibility forwarder to the same verified installer path, so there is one
  release trust chain and one skill mutation boundary.

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

## [0.5.1] - 2026-08-12

### Added

- Version Bump

## [0.5.0] - 2026-08-12

### Added

- Added a zero-clone npm bootstrap for `npx github-delivery` with guided
  install/setup, explicit `install`, `setup`, `doctor`, `update`, and
  `update --apply` commands, an exact npm package-surface validator, and
  Trusted Publishing integration in the protected release workflow. The npm
  artifact remains a thin bootstrap only; the installed skill payload still
  comes exclusively from the separately verified stable GitHub Release.
- Added complete protected-stream visibility for generated assistant messages,
  reasoning summaries, supported raw reasoning, and plan deltas, plus sanitized
  App Server replay/telemetry primitives. Protected mode now requires the
  plan/diff/token signals its enforcement depends on instead of claiming
  `stream` while those notifications are unavailable.
- Added hard no-progress generation bounds using Codex cumulative output-token
  telemetry and a generated-character fallback. Material diff changes,
  completed plan steps, and successful execution are real progress; merely
  starting a tool is not. Repeated imminent tool intent and malformed tool
  protocol output such as `<atool>...</atool>` are explicitly bounded, including
  across generated-text channel changes and unique wording.
- Added a semantic evidence registry keyed by resource + state generation.
  Owned helpers publish structured `gdEffect`/coverage metadata, and equivalent
  reads of the same GitHub Actions run or authoritative helper output can be
  reused instead of becoming new evidence merely because shell filters differ.
- Added a persistent delivery workflow controller with route locking, explicit
  phase graphs, checkpoints/resume, blocker/evidence/ref state, per-phase and
  workflow budgets, bounded retries, and measurable no-progress escalation.
  Routed workflows now consume one-shot workflow/policy packets instead of
  repeatedly rediscovering their route and policy surface.
- Added a release-blocking reliability gate that replays the real
  Baseline-is-green/tool-emission stall, malformed protocol output,
  cross-channel narration loops, and repeated CI-evidence acquisition. A
  false-positive corpus also protects legitimate tool-rich investigations and
  long final verdicts, with a separate finalization allowance rather than a
  blanket relaxation of active-workflow bounds.

### Changed

- Successful `PostToolUse` results are no longer replaced or truncated by the
  watchdog. Evidence compaction now belongs at the source/helper where the
  contract is known, preventing a protection mechanism from destroying a valid
  result and provoking a second read through another command shape.
- Windows/PowerShell progress classification now covers `git -C`,
  `Get-ChildItem`, grouped/compound commands and owned GitHub Delivery helpers
  more accurately while retaining conservative neutral handling for ambiguous
  operations.
- Protected-stream runtime reporting now lets a verified live `stream`
  declaration supersede stale hook-era degradation metadata, eliminating the
  contradictory `stream` + `streaming_interruption_unavailable` capability
  report.
- Final answer generation uses larger dedicated character/output-token budgets
  after the plan is complete, while malformed protocol/tool-emission detection
  remains active and any new real tool start exits finalization mode.
- Same-version installs with a byte-identical payload are now successful
  unchanged no-ops; same-version payload drift remains fail-closed, including
  with `--force`.

### Fixed

- Fixed the v0.4 protected-stream blind spot where large loops emitted through
  reasoning or plan channels could bypass a detector that watched only
  `item/agentMessage/delta`.
- Fixed tool-call emission stalls in which the model repeatedly says variants
  of `run`, `execute`, `wire`, `add`, `edit`, or similar actions without ever
  producing a real tool item, including repeated malformed `<atool>` protocol
  scaffolding.
- Fixed CI/read spirals that re-fetched the same underlying evidence with new
  filters or PowerShell command shapes after authoritative evidence was already
  available.
- Fixed the destructive output-compaction feedback loop where a successful read
  could be replaced by hook feedback and immediately re-read through a different
  tool/command.
- Fixed the protected Windows Codex launcher inheriting PowerShell 7's
  `PSModulePath` into Windows PowerShell, which could break inbox-module
  resolution during Codex self-update.

## [0.4.0] - 2026-08-11

### Added

- Added turn-scoped watchdog state and a typed progress model that separates
  evidence acquisition from execution and state-changing progress. Distinct
  reads/searches no longer reset narration-stall detection simply because a
  tool completed.
- Added a bounded evidence-exploration budget for supported Codex hook and
  streaming paths: a model-visible warning at 8 consecutive evidence attempts
  without execution/state progress and a hard read denial or stream interrupt
  at 12. Exact duplicate stable reads and rapid repeated volatile polls remain
  immediate blocks.
- Added regressions for both production loop classes: pure repeated
  `Let me read request-log.test.ts.` narration and interleaved
  `narrate -> read -> narrate -> different read` exploration spirals.

### Changed

- Codex hook persistence is now scoped by `session_id + turn_id`, with
  `agent_id` included when the host actually supplies it. Updates use bounded
  exclusive locking, stale-lock recovery, atomic replacement, restrictive
  permissions, ownership checks, and symlink rejection.
- App Server streaming now keeps an independent watchdog per turn. Evidence is
  charged when an item starts, while only successful execution/state progress
  can reset the exploration/narration window. Concurrent turns therefore cannot
  reset one another.
- Progress classification is conservative by default: unknown or ambiguous
  tools remain neutral instead of being counted as progress. `gh api` REST and
  GraphQL mutations, explicit write cmdlets, mixed read/write names, and
  read-looking shell commands with ambiguous redirection are handled without
  falsely resetting the watchdog.

### Fixed

- Fixed the read-exploration failure where every completed non-write tool was
  treated as progress, allowing dozens or hundreds of different reads to evade
  the stall detector indefinitely.
- Fixed cross-turn contamination in both hook persistence and the App Server
  router.
- Hardened protected stream mode to fail closed when required notifications are
  disabled or disappear, the watchdog router fails, or a private
  `turn/interrupt` is rejected or not acknowledged within the bounded timeout.
  The protected launcher terminates its Codex process tree rather than
  continuing under a false `stream` protection claim.
- Hardened watchdog state storage against predictable temp-path redirection and
  symlink/unowned path attacks without persisting prompts, assistant text, raw
  tool inputs/outputs, bearer tokens, or repository secrets.

## [0.3.0] - 2026-08-11

### Added

- Added a protected Codex streaming launcher, `scripts/codex-with-watchdog.mjs`,
  that starts the real App Server on stdio and places an authenticated loopback
  bridge in front of the Codex remote client. The bridge observes streamed
  assistant deltas and can issue one private `turn/interrupt` while repeated
  no-progress narration is still being generated.
- Added persisted watchdog activation metadata under the active Codex home so
  runtime capability reporting can distinguish configured state from verified
  active protection without storing prompts, conversations, bearer tokens, or
  raw tool inputs.

### Changed

- Normal Codex installation and upgrade now configure GitHub Delivery's
  `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, and `SessionEnd` hooks
  as part of the standard installer flow. The standalone hook installer remains
  available for repair and non-standard installs.
- Watchdog capability reporting now uses the strongest mode that can actually
  be proven: controlled `stream`, explicitly trusted `hooks`, or `none`.
  Newly configured non-managed Codex hooks report `hook_trust_required` until
  their exact unchanged definition is reviewed in `/hooks`; the installer does
  not bypass Codex's hook-trust gate.
- Added same-version activation refresh support so trusted hook state can be
  recorded with `node scripts/install-skill.mjs --hook-trust-verified --apply`
  without reinstalling or backing up the skill again.

### Fixed

- Closed the v0.2.0 activation gap where the watchdog implementation could be
  installed but remain dormant in a normal Codex setup.
- Added end-to-end regression coverage for the observed `Let me check the
  type...` narration loop and require streaming interruption before 500 emitted
  characters, with exactly one interrupt per stalled turn.
- Hardened the protected loopback bridge with bearer authentication, one-client
  enforcement, WebSocket v13 upgrade validation, bounded frames, malformed
  traffic handling, and launcher-owned remote flags that cannot be replaced by
  caller arguments.

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
