# Changelog

All notable changes to `github-delivery` are documented here.

## [Unreleased]

### Fixed

- Behavioural-evaluation docs now show the run pack and `<run>.transcript.json` sidecar, matching the scorer that rejects in-pack `trace` objects.
- Installer restore now journals before moving the live target aside, and journal updates replace a complete temp file instead of truncating the live journal, so a crash still leaves a recoverable tree.
- Automatic NuGet dependency submission can restore the Windows Authority host on Linux by setting `EnableWindowsTargeting`, so GitHub's hosted `submit-nuget` job no longer fails with NETSDK1100.
- Offline evals and `policy-bundle --validate` now treat `shared-rules.md` as a compatibility index only: workflows cannot instruct loading it, evals cannot list it as expected context, and each routed workflow's SKILL+kernel+module payload must stay 60% under the old monolith baseline.
- Routed workflows, compact review contract, and Cursor overrides no longer instruct loading `shared-rules.md` as mandatory context; they load the declared policy modules instead.
- `authorityMode=off` no longer treats caller-supplied `explicitInstruction` or `exactTextConfirmed` as independently authenticated consent; those actions still require a verified host grant at execution.
- Mutation-document retry identity hashes the full canonical mutation payload when no idempotency key is present, so retarget, reviewer, and draft differences cannot skip as already applied. Stale autonomous-claim recovery refuses to delete a ref whose SHA or freshness changed, and a timed-out `push_code` re-reads the remote tip instead of assuming failure.
- Release SBOMs now describe the package, use the source-commit created time, emit SPDX package verification codes, and fail closed against the SPDX 2.3 JSON schema.
- Installed manifest comparison now rejects symlink/directory substitutions and enforces declared POSIX modes instead of following links and hashing only.
- Release ZIP construction and extraction now use a portable NFC/case-fold path identity and re-read the extracted tree before trusting it.

## [0.8.7] - 2026-08-19

### Changed

- Bumped the package version from `0.8.6` to `0.8.7`.
- Restricted temporary Windows Authority branch leases to repeated `push_code` batches and tightened classic branch-protection, routing, mutation-boundary, security-policy, and stack portability contracts (PR #297).
- Windows Authority CI and C# CodeQL now run on every pull request so candidate code cannot scope out its own security-critical lanes; the remaining Node 22 compatibility selector is executed from the pull request base version (PR #299).
- Review briefs now apply a global model-facing diff-hunk budget while preserving complete structured review scope for deterministic tooling and on-demand inspection (PR #299).
- Made quiet execution an entrypoint-visible contract: routine rule/skill/workflow loading, file reads, Git/GitHub snapshots, remote fetches, obvious retries, and shell-quoting corrections run without per-tool user-facing narration unless they materially change the plan or expose a blocker (PR #299).

### Fixed

- Stopped Control Center Recent activity from flashing on every refresh by binding a stable collection, rebuilding only when audit data changes, and inserting Today/Yesterday/date separators between day groups (PR #293).
- Kept skill-authoring requests outside GitHub Delivery routing even when they end with PR publication (PR #295).
- Fail closed when a published GitHub PR or comment body contains literal escape sequences instead of real markdown newlines, including stdin body transport, create/update verification, and live comment re-reads (PR #294).
- Bound GitHub, Git, PowerShell, and registry subprocess helpers now copy argv and force a direct spawn (`shell: false`), so library-provided arguments cannot be reconstructed as a shell command (PR #294).
- Prevented unusual valid Git filenames from hiding sensitive path changes from scoped CI/CodeQL detection, and made required scoped lanes fail closed when their scope producer fails (PR #296).
- Fail closed when classic branch protection may apply but cannot be proved absent, added GitHub-style classic branch-pattern coverage, restored contextual `make this green` routing, and strengthened dynamic mutation-command boundary checks (PR #297).
- Redeem trusted authority before the first mutating GitHub command, including autonomous idempotency tag/ref coordination, so a rejected grant cannot leave coordination state behind before the requested mutation (PR #299).
- Preserve rename/copy source and destination paths with NUL-delimited local branch diff parsing, keep both path generations in review classification, and make every deterministic required probe a first-class pre-open blocker until its canonical structured probe evidence validates against the deterministic trigger files (PR #299).
- Enforce open stack-parent ordering at the mutation execution boundary before merge authority, and abort orphan-workflow cleanup before deletion when the default-branch generation changed during preflight (PR #299).
- Protected Codex streaming now bounds repetitive interleaved tool micro-narration separately from tool-emission stalls: three future-action narration intents without execution/state/workflow progress trigger an interrupt, and evidence/read tool starts do not reset that budget (PR #299).

## [0.8.6] - 2026-08-18

### Changed

- Bound leftover GitHub and Git subprocesses on review, verdict, CI forensics, ship-gate, runtime, live-fixture, release, and npm helper paths so a stuck `gh`/`git` child cannot hang the delivery process indefinitely.
- Bumped the package version from `0.8.5` to `0.8.6`.

### Fixed

- Fail closed when a reviewed PR head has moved instead of retargeting the signed scope, treat queued and auto-merge GitHub states as not merged, persist per-operation mutation receipts, stop a mutation batch at the first failed write, and route the remaining public workflows (PR #291).

## [0.8.5] - 2026-08-18

### Added

- Added a repository-scoped, read-only open-work workflow for the authenticated GitHub user, including complete PR pagination, deterministic ordering, bounded next-action signals, and ranked work-item references that never invent tracker hosts or authority from PR text (PR #283).
- Added tracker-aware external work-item delivery orchestration with Linear as the first normalized tracker shape. Delivery phases are derived from verified GitHub evidence, tracker status selection fails closed on missing/ambiguous mappings, and planned tracker transitions bind the observed current status so stale writes must re-plan (PR #284).
- Added read-only competing-PR consolidation analysis. Candidate clusters use durable work-item identity plus non-noise implementation overlap, never auto-select a canonical PR, and require direct supersede-grade evidence between the chosen canonical PR and every PR proposed for replacement (PR #285).
- Added conditional visual-review evidence for rendered/UI changes. Screenshot, video, or deterministic render artifacts must be bound to the exact current head SHA; stale artifacts and text-only claims are rejected, while genuine preview/runtime blockers remain explicitly `blocked` (PR #286).
- Added head-bound multi-base delivery for backports/ports. Each target base gets an independent `parallel-port` identity and deterministic provenance marker bound to repository, source PR, exact source head SHA, and target base; wrong-base, duplicate, ambiguous-marker, and incomplete-required-target states fail closed (PR #287).

### Changed

- Reworked pull-request CI from a 3-OS × 2-Node matrix plus three full Node 26 reruns into one canonical Node 24/Ubuntu full `npm run check`, bounded Node 26 compatibility on that workspace, a scoped Node 22/Ubuntu compatibility lane, and a scoped Node 24/Windows Authority lane. Superseded CI/CodeQL/Dependency Review runs are cancelled, C# CodeQL is scoped on PRs, the duplicate Architecture Contracts workflow is removed, repository-policy polling is daily, and orphan-workflow cleanup is weekly (PR #288).
- Reduced ordinary runtime-relevant PR execution from 9 full repository checks to 1, from 9 full unit-suite runtime executions to 3, from 2 Windows Authority lanes to 1 when relevant, and from 2 macOS PR jobs to 0 while retaining Node 22/24/26 compatibility coverage and live-fixture overrides (PR #288).
- Reorganized the README around a clearer start-here path, grouped capability map, concise safety model, consolidated installation/maintenance guidance, dedicated stack/competing-PR/backport explanation, updated workflow reference, and the current lean CI topology. Release-specific implementation detail is no longer embedded in the hero text.
- Bumped the package version from `0.8.2` to `0.8.5` for the complete post-0.8.2 rollup.

### Fixed

- Moved the remaining workflow-level `actions: write` permission down to the cleanup job, kept top-level workflow permissions read-only, and added validation that rejects future top-level write scopes while still permitting explicitly allowlisted job-level writes (PR #282).
- Hardened PR publication identity and retries: exact duplicate detection now binds target repository, head repository/ref, and base; qualified REST head filters prevent same-repository misses; explicit cross-repository `head_repo` identity is supported; and exact owned idempotent retries converge before the broader duplicate preflight (PR #283).
- Protected existing PR-body screenshots, videos, GitHub uploads, reference-style Markdown images, and other recognized media from accidental body rewrites. Intentional media removal requires an exact approved identity list that is included in trusted `update_pr_body` authority scope (PR #283).
- Prevented cross-repository closing issues and unsafe display URLs from masquerading as trustworthy same-repository work-item evidence, and tightened open-work fixtures so PR-number normalization and repository boundaries are actually exercised (PR #283).

## [0.8.2] - 2026-08-17

### Changed

- Tightened protected-stream no-progress generation budgets for active workflow work to **4,000 / 8,000** generated characters and **1,024 / 2,048** generated output tokens soft/hard, while keeping completed-plan finalisation on the larger **12,000 / 16,000** output-token allowance and retaining the six-clause imminent-tool threshold that avoids legitimate tool-start false positives (PR #280).

### Fixed

- Fixed lifecycle-hook recovery after a severe no-progress stall of at least **8,000** characters so the already-selected recovery tool still runs, then `PostToolUse` returns `continue: false` before another model response can start, and the model is quarantined for the task until the model changes or a new task begins (PR #280).
- Fixed repeated same-turn stalls after a smaller recovered narration recovery by retaining per-turn recovery probation and hard-stopping plus quarantining the model on a second fresh narration stall instead of restarting a full 1/3 recovery cycle (PR #280).

## [0.8.1] - 2026-08-16

### Changed

- Delivery Authority approval windows now use a fixed shell: header, repository, security, branch controls, and footer remain visible while only long proposed-action content scrolls. The window enforces a 560 × 640 minimum and uses responsive horizontal gutters.
- Exact repository + branch temporary grants can now be selected for 1 through 10 minutes.
- The Control Center Recent activity / Audit trail viewport is capped at 420 px with internal scrolling, and Control Center content uses responsive horizontal gutters.

### Fixed

- Fixed Windows Hello desktop approval startup and recovery handling, including fail-closed classification of TPM/TBS error `0x80284002`, retry/sign-in recovery, and exact owner-window verification.
- Fixed approval windows appearing behind other windows by keeping a pending approval window above other application windows until the approval is completed or cancelled.
- Fixed approval summaries so branch-driving fields are explicit and temporary branch grants remain bound to one exact repository and branch.
- Fixed lifecycle-hook narration recovery so short no-progress follow-up messages keep the corrective obligation active until a real `PreToolUse` boundary is reached, with up to three corrective continuations by default before failing closed. Real tool boundaries clear the pending recovery signal, while malformed tool-protocol stalls still stop immediately (PR #277).

## [0.8.0] - 2026-08-16

### Added

- Added an explicit rule-by-rule anti-slop checklist to the typed-code Standards companion (PR #267). Reviews now cover chained assertions, known-value widening, broad internal `object` parameters, unnecessary `Reflect.apply` / `Reflect.get`, widen-then-assert flows, and repository-required assertion safety justification while preserving valid boundary `unknown`, runtime narrowing, dynamic interop, open dictionaries, and repository test seams as false-positive controls.
- Added adversarial audit regression coverage and resumable cross-system release helpers (PR #268). Release publication can publish or verify GitHub assets before npm, verify an already-published npm version by registry integrity, and resume safely after a partial publication attempt.

### Changed

- Merge execution now has one canonical destructive boundary in `merge-pr-driver.mjs` (PR #268). Generic `merge_pr` mutation documents are rejected, execution requires settle, and the driver binds head, base, active-rules, feedback, and review-evidence generations before destructive authority and recaptures them again immediately before the merge write after any approval delay.
- The ship gate now fails closed on unsupported active ruleset types and unexplained GitHub `BLOCKED` merge state, while successful merges with failed post-merge thanks report partial success and already-merged retries can reconcile only the missing idempotent ceremony (PR #268).
- Missing persistent user configuration now defaults trusted-authority mode to `high-assurance` instead of `off`. Autonomous idempotency claims are timestamped, scope-bound annotated Git tags with bounded stale recovery, visible-write ownership is rechecked immediately before mutation, and close/draft operations assert semantic postconditions (PR #268).
- Required CI remains Node 22 and Node 24 across Ubuntu, Windows, and macOS, with the full Node 26 compatibility check executed inside every protected Node 24 platform lane before lane-specific follow-up. Dependabot now also covers the nested `.github/npm-publish` toolchain (PR #268).
- Compound `research and implement issue #N` intent now routes to the implementation workflow while retaining its bounded research preflight, and stack mutation guidance points back to the canonical workflows instead of stale raw helper commands (PR #268).

### Fixed

- Fixed release ordering that could strand an npm-only release when GitHub publication failed later; GitHub Release assets are now the resumable first publication boundary and npm is the final irreversible cross-system write (PR #268).
- Fixed merge transaction reporting so a successful merge is never converted into a generic failure solely because the post-merge thank-you failed, and later reconciliation does not attempt the merge again (PR #268).

## [0.7.3] - 2026-08-16

### Added

- Added a reusable minimal-solution contract for issue implementation and refactor planning (PR #266). Non-trivial work now starts by understanding the real call flow and choosing the lowest-complexity complete solution in this order: existing repository capability, standard library/runtime, native platform, already-installed dependency, then the minimum custom implementation. Required validation, security, accessibility, compatibility, lifecycle, observability, and evidence are never traded away for a smaller diff.
- Added completion-claim evidence rules for durable final reports (PR #266). Merge-ready, migration-complete, review-coverage, absence, count, and other material completion claims must now come from current authoritative workflow evidence; volatile/head-bound state is refreshed and material numbers are re-measured instead of recalled from prose or memory.
- Added a read-only triage attention inbox (PR #266) that surfaces unlabeled/untriaged issues, `needs-triage` issues, and `needs-info` issues with new reporter activity since the last triage note, ordered oldest-first within each bucket.

### Changed

- Difficult bug diagnosis now prefers a tight red-capable symptom signal before theory-building, minimizes the reproducer, and uses ranked falsifiable hypotheses with one controlled variable at a time. Obvious defects with an already-proved causal chain do not get forced into an unnecessary harness (PR #266).
- Broad internal migrations can now use an explicit expand → migrate → contract strategy. Temporary overlap is treated as migration scaffold rather than permanent compatibility, caller families move in independently verifiable batches, and the old path is removed only after the final residual proof is clean (PR #266).
- Advisory design/simplification review now includes deletion-test, interface/test-surface, real-seam, leverage, and locality signals while keeping repository standards and concrete Bug/Security/Spec contracts authoritative. Existing anti-slop/Oxlint/typecheck diagnostics remain evidence inputs rather than a reason to vendor or install a second lint stack (PR #266).

## [0.7.2] - 2026-08-15

### Added

- Added a typed-code type-evidence Standards companion for TypeScript and typed JavaScript (PR #263). Review can now trace known-value widening, widen-then-assert flows, broad internal contracts, reflective bypasses, assertion proof quality, and test wiring hidden by mocks while keeping valid boundary `unknown`, runtime narrowing, justified interop assertions, genuinely open dictionaries, and ordinary dependency-seam mocks as explicit non-findings.
- Added a real sanitized agent-loop incident replay to the release-blocking reliability gate plus explicit runtime protection visibility (PR #264). Startup capability snapshots, setup, install, and `doctor` distinguish `Full (STREAM)`, `Partial (HOOKS)`, and `Off (NONE)` and report whether the current boundary can interrupt an already-generating turn.
- Added operational Control Center settings and trust management for the Windows Authority host (PR #262): repository allowlist add/remove controls, a login auto-start toggle synchronized with the CLI, the committed Authority icon in the window and notification area, and an explicit tray `Exit` action.

### Changed

- `npx github-delivery start` now ensures the Authority host is running and brings the Control Center into view even when an existing instance is already in the notification area. Successful output identifies the installed host location, explains that closing the window leaves Authority running in the tray, and points to tray right-click → `Exit` for a complete shutdown (PR #262).
- `npx github-delivery autostart` remains the backwards-compatible enable form and now has explicit `autostart on`, `autostart off`, and `autostart status` variants. The Control Center Settings switch reads and writes the same current-user Windows Run registration, so CLI and GUI stay synchronized (PR #262).
- The Control Center now uses only the useful `Overview` navigation plus native `Settings`, uses the full available content width, hides to the notification area on normal close, and has three deliberate responsive layouts: Compact below 900 px, Medium from 900 px, and Wide from 1360 px. Windows enforces a best-effort 720 × 620 minimum window size, while the five summary metrics keep the same symmetric 3+2 geometry at every size (PR #262).

### Fixed

- Fixed the v0.7.1 unpackaged WinUI startup failure by restoring the generated XAML process-requirements check and making compiled application XBFs plus the root `resources.pri` mandatory publish artifacts. CI now exercises the real compiled Control Center through build, self-test, XAML smoke, self-contained publish, release-ZIP round trip, install, and installed XAML smoke boundaries (PR #262).
- Fixed malformed tool-protocol loops that emitted high-confidence `<parameter name="notify">` / `<parameter name="exec_command">` scaffolding or wrapped `run` / `execute` narration without reaching a real tool boundary. The detector reuses the existing protocol/tool-emission budgets and retains false-positive controls for ordinary XML and documentation examples (PR #264).

## [0.7.1] - 2026-08-14

### Added

- Staged human-readable progress for `npx github-delivery update --apply`, so release verification, skill replacement, post-install verification, and Windows Authority reconciliation are visible while they happen instead of appearing to stall until a final receipt is printed.
- Best-effort local Windows Authority startup diagnostics at `%LOCALAPPDATA%\GitHubDeliveryAuthority\startup-error.log`, including top-level, AppDomain, and WinUI unhandled startup exceptions. Windows CI now also executes the published self-contained Authority executable with `--self-test` after publish.

### Changed

- `npx github-delivery start` now treats the existing Authority named-pipe `status` response as the readiness boundary. A successful process spawn alone is no longer reported as a running GUI; the command waits for `status: ready` and reports a bounded failure with the diagnostics path when readiness is not established.
- Default `update` and `autostart` output is now concise human-readable CLI text. Raw machine-readable output remains explicit where supported, including `doctor --json`.

### Fixed

- Fixed the npm bootstrap package closure after the new readiness probe introduced an import of `scripts/lib/authority-host-client.mjs`: the runtime client is now included in the published package and in both exact package-surface validators, so a real packed tarball can run the bootstrap CLI after an offline local install.
- Fixed false-positive `start` success reporting when the Windows Authority process exits during startup or never opens its status pipe.
- Fixed `update` and `autostart` falling through to raw internal JSON receipts despite existing user-facing renderers.

## [0.7.0] - 2026-08-14

### Added

- Advisory design-quality review for changed executable behavior and architecture. Standards review can now evaluate happy-path readability, owning trust boundaries, abstraction/reader cost, domain modeling, mutable-state ownership, shared-state discipline, and evidence-before-complexity without turning generic design taste into an automatic blocker.
- Safe change-execution guidance for broad deterministic sweeps and internal API migrations. Workflows now inventory the migration surface, migrate known callers before deleting obsolete internal paths when compatibility is not required, use scripts, codemods, or generators when they materially lower change risk, and advance through independently verifiable units with residual old-form checks.
- Stable verification-boundary guidance for regression and refactor evidence. Checks now target the narrowest stable contract that would actually fail if protected behavior broke, rather than automatically preferring helper-level unit tests or oversized end-to-end harnesses.

### Changed

- Regression-first bug fixes now select evidence by stable behavior boundary while preserving broken-before/fixed-after proof and the existing rule against brittle, low-signal test harnesses.
- Refactor characterization/equivalence evidence now prefers stable behavior boundaries that survive internal restructuring and records what production path remains unexercised when external dependencies are substituted.
- Invalid external data is handled at the owning trust boundary, with deeper checks reserved for distinct security, authorization, persistence, corruption, lifecycle, concurrency, or fail-loud contracts instead of repeating identical validation through every internal layer.
- Refactor planning and issue-to-PR implementation can invoke the new change-execution companion for migrations and mechanical sweeps while keeping the compact core workflow within its context budget.

## [0.6.2] - 2026-08-14

### Added

- Evidence-preserving prose guidance for durable GitHub text such as PR descriptions, issues, PRDs, reviews, status comments, and merge-ready summaries. The guidance prefers concrete repository terms and plain wording while preserving exact commands, identifiers, evidence states, security redaction, and user-confirmed text.
- Regression-first bug-fix guidance that requires executable broken-before/fixed-after evidence while preferring the narrowest useful check. Focused failing tests remain preferred when they are natural, but low-signal harness work or brittle mocks are not required solely for test-first compliance.
- Safety-invariant review guidance for material non-local risk. Reviews now name the fact a positive verdict depends on, record the strongest proof level reached from claimed through reproduced, and keep material assumptions explicitly `unproven` when the evidence does not establish them.

### Changed

- Bug-hunt regression coverage is now sized by behavior partitions and failure paths instead of arbitrary cyclomatic-complexity test-count targets, and central-file/non-local risk can escalate into explicit safety-invariant proof.

## [0.6.1] - 2026-08-14

### Added

- Authority host environment variables are documented as optional explicit overrides. Normal installations use built-in defaults and no longer persist these variables in the user environment.
- Guided Windows approval-GUI choice. Fresh interactive installs explain the optional component and ask `Install the Windows approval GUI now? [Y/n]`; explicit consent installs the separately verified Authority host without changing an `off` protection mode, while No finishes the skill install without the GUI.
- User-facing `npx` bootstrap summaries, an explicit `npx github-delivery start` command, and opt-in Windows login auto-start. Fresh installs ask `Enable Windows login auto-start? [y/N]`; users can enable it later with `npx github-delivery autostart`. The `start` command launches the GUI without changing the login setting.

### Changed

- Windows Authority builds are reproducible across local, CI, and release environments by pinning the .NET SDK to 10.0.303 and rejecting self-contained publishes that do not contain the Microsoft.NETCore.App runtime 8.0.30.

### Fixed

- Repeated grid or malformed tool-protocol placeholder output now hard-stops immediately on the first stall instead of being retried, and the offending model is quarantined across turns and `SessionEnd` so a resume with the same model is blocked before inference until the model is changed. Subagent protocol stalls no longer quarantine the parent task.
- Windows login auto-start is now opt-in (previously enabled by default); users explicitly consent via guided install or `npx github-delivery autostart`.

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
  symlink/unowned path attacks without persisting prompts, conversations, bearer
  tokens, or raw tool inputs.

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