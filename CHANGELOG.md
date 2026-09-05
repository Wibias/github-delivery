# Changelog

All notable changes to `github-delivery` are documented here.

## [Unreleased]

## [1.4.6] - 2026-09-05

### Added

- Added opt-in protected Codex stream debug tracing for false-positive diagnosis. `GITHUB_DELIVERY_DEBUG_TRACE=1` (or `true`) writes bounded local JSONL under `${GITHUB_DELIVERY_STATE_DIR:-~/.github-delivery}/debug-traces`; tracing remains disabled by default and records only visible reasoning-summary deltas plus sanitized turn/tool/watchdog lifecycle metadata, excluding hidden/raw reasoning, prompts, full tool arguments/results, diffs, and token payloads (PR #428).

### Changed

- Bumped the package version from `1.4.5` to `1.4.6`.

### Fixed

- `workflow-brief.mjs create-pr-from-local-work` now bootstraps local PR publication with an exact repository + routed-head identity, creates or recovers the deterministic persistent controller checkpoint, and returns that checkpoint path as part of the execution packet. Repeating the same bound bootstrap resumes the same controller state without re-deciding the route, while a different head gets a distinct checkpoint and the old unbound local-PR brief fails closed (PR #427).

## [1.4.5] - 2026-09-05

### Changed

- Bumped the package version from `1.4.4` to `1.4.5`.

### Fixed

- The Codex progress watchdog now counts successful direct Node source-file invocations and explicit `node --input-type=module -e/--eval` diagnostic module harnesses as execution progress, so a completed reproduction or validation run resets the consecutive evidence-exploration streak before narrow follow-up source inspection. Generic inline Node eval/print snippets remain neutral, and the existing evidence thresholds, duplicate-read protection, and volatile-poll protections are unchanged (PR #425).
- Stable `update --apply` now keeps an installed Windows Authority host in place when the newly verified release payload's program files are byte-identical, ignoring only `authority-host-version.json`; changed, missing, legacy, or unverifiable payloads still take the normal replacement or repair path (PR #426).

## [1.4.4] - 2026-09-04

### Added

- Added deterministic local-PR hygiene orchestration that derives Comment Inspector scope from diff-added lines, validates one structured final result, verifies reviewer bytes, and emits current-head hygiene evidence without manual receipt construction (PR #424).
- Added aggregate pre-open review evidence expansion that converts complete bug/security axis coverage plus canonical probe records into the existing schema-v2 obligations without reducing required semantic IDs or file coverage (PR #424).

### Changed

- Bumped the package version from `1.4.3` to `1.4.4`.
- `create-pr-from-local-work` now documents one executable happy path for hygiene, compact pre-open evidence, planner locking, and broker receipt completion; Comment Inspector guidance is aligned to generated immutable scope and structured final output (PR #424).

### Fixed

- Selected local-PR workflows now reject direct `git push` / `gh pr create` execution through the protected Codex hook with `create_pr_direct_write_forbidden`, eliminating the observed fallback/re-decision loop before the canonical publication boundary (PR #424).

## [1.4.3] - 2026-09-03

### Added

- Added deterministic diff-added-line Comment Inspector scope, structured final-result validation, head-bound pre-open hygiene evidence, and authoritative remote-base resolution for local PR publication (PR #423).

### Changed

- Bumped the package version from `1.4.2` to `1.4.3`.

### Fixed

- `create-pr-from-local-work` now locks the exact planner operation identities into the workflow checkpoint and requires matching successful broker receipts before publication can complete. Raw controller hygiene-receipt minting is removed, Comment Inspector classifications are confined to the new-side candidate diff, and local pre-open review binds to the remote base SHA without weakening the existing issue-linked workflow's checkpoint base authority (PR #423).

## [1.4.2] - 2026-09-03

### Added

- Added deterministic local-PR orchestration primitives: compact `pre-open-gate --compact` output, a CLI for the canonical create-PR publication planner, and a scoped comment-review byte guard that verifies and restores the reviewer window before parent-owned edits are applied (PR #421).

### Changed

- Bumped the package version from `1.4.1` to `1.4.2`.

### Fixed

- `create-pr-from-local-work` now consumes one locked workflow packet and canonical generated publication plan instead of repeatedly rediscovering route, draft state, mutation entrypoint, or gate semantics. Initial PR creation remains draft-only, direct `git push` / `gh pr create` fallback is forbidden once the workflow is selected, and Comment Inspector is report-only so failed or interrupted reviewer runs cannot leave ambiguous workspace mutations (PR #421).

## [1.4.1] - 2026-09-03

### Added

- Added a deterministic create-PR publication planner that composes the canonical maintainer `push_code` and initial draft `create_pr` request shapes, preserves force-with-lease tip identities including `expectedRemoteTip: "absent"`, and points execution at the checkpointed `scripts/github-mutate.mjs` boundary without duplicating broker, authority, or pre-open policy (PR #418).

### Changed

- Bumped the package version from `1.4.0` to `1.4.1`.

### Fixed

- Create-PR publication now requires current-head completion receipts for both default pre-open hygiene passes, `no-comments` and `simplify`, at the controller transition and mutation checkpoint. Missing or stale hygiene receipts therefore fail closed even when bug/security evidence is otherwise ready (PR #415).
- Routed `create_pr` publication now keeps initial PR creation draft-only. A routed non-draft create payload is rejected instead of silently publishing ready-for-review, while any later ready-for-review transition remains a separate explicit operation (PR #416).
- Pre-open bug/security review evidence now requires structured provenance bound to the current candidate head with bounded method and reviewed-file context. Bare `"done"` strings cannot satisfy schema v2, and stale structured evidence cannot clear current-head obligations (PR #417).
- Comment Inspector execution now freezes the parent-provided file/diff scope, classifies each scoped comment once after context gathering, emits only the final report without provisional reversals or progress narration, binds root-cause flags to the exact symbol directly covered by the deleted alibi, and rejects scope escapes, speculative architecture expansion, and incidental application-code edits (PR #420).

## [1.4.0] - 2026-09-01

### Added

- Added installable protected Codex watchdog entrypoints for both hook-driven clients and app-server stream clients. The hook adapter persists only compact derived watchdog state between events, the app-server proxy observes live JSONL turn/item/diff/plan/token notifications and can issue a private `turn/interrupt` request, and `scripts/verify-install.mjs` / `scripts/install.mjs` now fail closed when the installed watchdog entrypoint metadata drifts from the verified package (PR #412).
- Added repository-level security standards for the package itself: CodeQL analysis in CI, dependency review on pull requests, automated Dependabot npm and GitHub Actions updates, and a published `SECURITY.md` vulnerability-reporting policy (PR #414).

### Changed

- Bumped the package version from `1.3.1` to `1.4.0`.
- The package description now explicitly includes protected Codex workflows, and the README documents the installed watchdog surfaces for Codex-compatible clients (PR #412).

### Fixed

- The comment-cleanliness path now derives a canonical authoritative scope from `base...candidate` and rejects consumer-supplied scopes that omit changed files, added lines, or candidate identity. Optional supplied scopes may only narrow the authoritative scope and can no longer redefine it (PR #409).
- Mutation authority classification is now deterministic: `push_code`, `create_pr`, `ready_for_review`, and merge/release-related requests are always maintainer operations, GitHub broker receipts are parsed before controller transitions, and publication completion now requires a successful broker receipt from the canonical maintainer path (PR #408).
- The progress watchdog now distinguishes state-changing tool completions, successful execution, bounded evidence exploration, duplicate result reads, repeated volatile polling, and neutral non-progress actions. Repeated blocked retries cannot reset progress, explicit exhaustion reasons are surfaced through the Codex hook, and false-positive regression coverage includes same-turn CI checks, duplicate inspector reads, shell/search evidence loops, and recovery after real progress (PR #410).
- The workflow brief and reference runbooks now carry a first-class `watchdogPolicy` with soft/hard generated-output budgets, bounded evidence-exploration and duplicate-read limits, conditional single extra-investigation allowance, false-positive exemptions, executable Codex interruption semantics, and installed-hook enforcement metadata (PR #411).
- Closed the final no-progress loopholes in the progress watchdog: identical evidence calls are charged at attempt start even when interrupted before completion, volatile poll attempts are debounced before repeated results exist, tool-emission intent is tracked as a diagnostic signal but cannot reset generation budgets, and executable app-server interruption is coupled to the configured watchdog limits (PR #413).
