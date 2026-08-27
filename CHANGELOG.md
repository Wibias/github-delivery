# Changelog

All notable changes to `github-delivery` are documented here.

## [Unreleased]

## [1.2.0] - 2026-08-27

### Added

- Windows self-update now recovers from transient `EPERM` / `EBUSY` install-directory locks. After bounded retries, interactive updates inspect the installed skill tree for locking processes, show the blocking applications and PIDs, and ask before requesting a graceful close. Approved closes are never force-killed; the updater waits for the handles to clear and retries the same verified transactional update. Declining the prompt, running non-interactively, an unresolvable probe, or a process that remains locked returns structured `install_target_locked` diagnostics while preserving the existing installation (PR #376).
- Successful interactive updates can now offer to remove older recognized GitHub Delivery backups. The fresh rollback backup created by the current update is always preserved, unrelated directories are ignored, and cleanup failures are reported without rolling back an otherwise successful verified update (PR #376).

### Changed

- Bumped the package version from `1.1.1` to `1.2.0`.
- The npm bootstrap now ships the Windows install-lock probe and the lock-recovery / backup-management helpers required by the updater. Pull-request Windows CI exercises the packaged lock probe on a real Windows runner (PR #376).

### Fixed

- Updating on Windows no longer surfaces the raw directory-rename `EPERM` as the only recovery path when applications such as editors hold handles inside the installed `github-delivery` tree (PR #376).

## [1.1.1] - 2026-08-27

### Added

- Explicit `approve PR #N` requests now route to GitHub-native approval through the controlled mutation boundary, verify an `APPROVED` review on the expected head, and surface GitHub refusal (including self-approval) instead of substituting a `[GD]` verdict comment. `approve and merge PR #N` keeps approval ordered before merge, and Node/Windows authority canonicalization agrees on native approval scope (PR #373).

### Changed

- Bumped the package version from `1.1.0` to `1.1.1`.
- Workflow packets now carry an execution-ready contract with declared helper entrypoints and broker actions, while github-delivery source discovery is diagnostic-only during normal execution. Common workflows can consume one packet instead of repeatedly reading/grepping the skill implementation to rediscover their own execution surface (PR #372).
- PR head identity is controller-owned across mutations: successful `push_code` reconciliation advances controller head state, `ship-gate` can bind repository/PR/head from the workflow checkpoint, and stale explicit head values fail immediately instead of being retried from remembered state (PR #374).

### Fixed

- Deferred merge authority such as `merge PR #42 when I approve it later` remains read-only and is not misrouted as an immediate native approval request (PR #373).

## [1.1.0] - 2026-08-24

### Added

- Full-review verdicts can now submit GitHub Request changes through the mutation broker, and later passes dismiss our pending Request changes before a new request or a merge-ready comment. GitHub Approve stays off unless the user explicitly asks.
- History-only Git rewrites (squash, reword, reorder, commit grouping) must keep the original local `HEAD^{tree}` from a broker-owned `record_rewrite_baseline` captured before the rewrite. `push_code` `originalLocalTip` must equal that baseline (`GD-GIT-008`). The remote lease tip is only a race check. Restack onto a new parent still skips the tree check.
- Behavioural-evaluation gating can use cryptographically attested, hash-bound transcript provenance. Self-consistent local transcripts remain diagnostic-only and cannot become trusted gating evidence by assertion alone (PR #370).

### Changed

- Bumped the package version from `1.0.0` to `1.1.0`.
- Review briefs label files as core, mechanical, or other, and call out relocated blocks of three or more lines as moved code. Textually identical relocation does not prove unchanged behavior; surrounding context still requires review. PR description review notes name the core files when a diff mixes implementation with generated or lockfile changes.
- Absence claims need a positive-control search that matches a known hit before `no residual X`.
- Confirmation checks re-run in the same shell and PATH as the original observation so a PATH switch cannot produce a false result.
- `authorityMode=off` now means zero Windows Hello / Authority-host approval. Direct lifecycle intent and exact-text confirmation still remain mandatory where policy requires them, but caller-controlled mutation JSON cannot mint those facts; governing workflows provide them through trusted execution context (PR #370).

### Fixed

- `rewriteExemption` uses one contract in the lifecycle broker, Node Authority, and Windows Authority: omit undefined, null, and `""`; accept only exact `restack`, `conflicts`, or `simplify-pr`; reject padded, unknown, and non-string values. Empty string is omitted from the Hello hash, not an error.
- Non-fast-forward force-with-lease `push_code` fails closed unless the new tip tree matches a broker-owned rewrite baseline (`record_rewrite_baseline` before the rewrite) or `rewriteExemption` is restack, conflicts, or simplify-pr. `record_rewrite_baseline` stores that SHA in broker state outside the Git repo after a compare-and-swap of the live branch tip, refuses replacement, post-verifies it, and binds it into Node/Windows Authority. Capture uses the same remote/repo identity check as `push_code`, so the recorded SHA is provenance for the authorized repository rather than an unverified checkout label. File-store create and consume take a generation-fenced cross-process lock and refuse to write after a stale takeover, so concurrent mutations cannot drop or resurrect a one-shot baseline. Stale empty or truncated lock files are reclaimed after the stale timeout with a re-check, so a crashed lock create cannot block consume after a successful push. A writable `refs/github-delivery/rewrite-baseline/...` ref is not proof. Successful push verification, including uncertain-push reconciliation, consumes that baseline. Caller-supplied `originalLocalTip` must equal that baseline; the same-request SHA is not provenance. `expectedRemoteTip` stays the lease/race check only. The branch reflog must show the rewrite started from that recorded generation, so a later local commit with a different tree cannot be force-pushed away under a stale baseline. File-store writes publish generation-numbered snapshots, so a rename after the last lock check cannot overlay a newer create or restore a consumed baseline. Reflog generation allows different-tree ancestor commits of the recorded baseline, so a content-preserving squash is not rejected as stale.
- Moved-code hints report exact unchanged line text as a relocation, but they do not tell reviewers to skip that code as not-new-logic. Near-match, indentation-sensitive, and guard-crossing edits stay in review, and file roles follow review-scope logic paths with path-segment mechanical directories.
- Exact moved-code classification uses raw source-line equality, so whitespace inside strings, template literals, and trailing spaces counts as a change.
- Moved-code detection skips oversized replacement diffs when the delete×add line product or candidate-pair budget is exceeded, so a large foreign PR cannot make review-brief quadratic before output limits apply.
- Windows Hello names a content-changing non-fast-forward rewrite and its `rewriteExemption`, and those pushes cannot reuse a branch lease or PR session.
- Final merge execution now independently verifies non-bypassable server-side conversation-resolution enforcement plus the current unresolved-thread set at the expected head/base, closing the unresolved-review-thread TOCTOU window (PR #370).
- Required clean probe evidence must cover the exact deterministic trigger-file set; missing, duplicate, partial, or unrelated file evidence fails closed (PR #370).
- Classic branch-protection matching follows the proven GitHub pathname-style pattern subset and fails closed for syntax the implementation cannot establish as compatible (PR #370).
- Attributed issue/repository text cannot grant current-user merge authority, and named GitHub GraphQL mutations must remain broker-owned and registered even inside privileged mutation files (PR #370).
- Workflow/policy documentation is consistent with progressive disclosure: policy modules are mandatory context while `references/shared-rules.md` remains a compatibility index only (PR #370).

## [1.0.0] - 2026-08-22

### Added

- SHA-bound remote repository context: resolve `owner/repo` or GitHub URLs, discover the real default branch, optionally pin a workflow-selected branch, capture its exact commit SHA, and read files against that snapshot instead of guessing `main`, `master`, or `HEAD`. Workflows that already load evidence policy compose this through `GD-EVID-007` without a new public route or mutation authority (PR #300).
- Optional Windows Authority **PR sessions**: after one Hello approval, later exact-scope `push_code` and `merge_pr` batches on one allowlisted repo, one PR, one head branch, and the approved merge base can skip repeated Hello for 5, 15, 30, or 60 minutes (`approvalMethod: pr_session`). A retargeted base requires Hello again. Branch leases stay `push_code` only for 1–10 minutes. Comments, human replies, close, and delete still need Hello (PRs #348, #351).

### Changed

- First stable public release after `0.8.7`.
- Bumped the package version from `0.8.7` to `1.0.0`.
- `watch PR #N and merge it` stays on prepare-and-merge. `watch and autonomously merge PR #N` stays on watch with merge authority and hands a ready PR to `merge-pr-driver.mjs`. Bare `watch autonomously` still does not merge. Autonomous is not the default mutation mode (PRs #312, #323, #348).
- Policy modules are the mandatory workflow context. `references/shared-rules.md` is a compatibility index only; evals and `policy-bundle --validate` reject loading it as required context (PRs #342, #343).
- Router merge intent is explicit: `merge it` / `ship it` prefixes, negated merge, and attributed GitHub text such as `comment says: merge it` are not user merge authority even when the attributed quote continues past the first sentence (PRs #321, #322, #347, #350).
- Durable GitHub prose now deletes chatbot phrases, process narration, puffery, and `not just X, but Y` crutches. It still must not add personality, score "sounds human," or ban em dashes, and it still cannot strengthen `unknown` / `blocked` evidence states (PR #354).

### Fixed

- Ship-gate and merge fail closed on GitHub `UNKNOWN` mergeability instead of treating it as ready, and snapshot capture retries rate-limited read-only GitHub calls instead of failing the first 429 (PRs #303, #361).
- Native GitHub stacked PRs are a hard stop: github-delivery will not `gh pr merge` a native-stack member, and native-stack protection is evaluated against the stack base (PRs #304, #306).
- Merge grants bind the approved base; Windows Hello `merge_pr` and `close_linked_issue` scopes hash the same fields Node already required; `close_linked_issue` binds the governing PR (PRs #335, #336, #349).
- Live repository-policy CI fails closed when it cannot attest ruleset bypass actors or cannot see protected release tags (PRs #305, #308).
- `authorityMode=off` still requires a verified host grant for lifecycle intent; caller-supplied `explicitInstruction` / exact-text flags are not independently authenticated consent (PR #340).
- Mutation retries hash the full canonical payload, including draft-state ready identity, so retarget, reviewer, and draft differences cannot skip as already applied (PRs #341, #344, #346).
- GitHub write transport no longer expands GraphQL `-F` values as local files, folds sibling API body fields into JSON stdin, and treats `gh api --input` as a write for rate-limit retry (PRs #313, #324, #325).
- The mutation-boundary scanner still inspects privileged broker and lifecycle files, rejects constructed or spread mutation argv, and allows only registered REST/GraphQL shapes there (PRs #360, #362).
- Install, update, and Authority cutover keep the previous skill/broker when a step fails: staged installer payloads, dist-not-cwd identity, exclusive reconcile/hooks locks, skill-backup restore, broker keep-alive, Startup-shortcut autostart, bundle-root fallback, crash recovery after `target → backup` before `staging → target`, staging journalled before copy with no promotion of unverified or journal-less leftover staging, restore journaling before aside swap, journal updates that replace a complete temp file, and journal replacement that moves the previous valid journal aside instead of deleting it (PRs #314, #326–#332, #353, #355, #357, #359).
- Release artifacts fail closed on SPDX 2.3 schema, non-regular installed-manifest substitutions, and extraction path identity. Windows Authority can restore on Linux CI via `EnableWindowsTargeting`. `npm pack` spawns through Node, not a Windows shell (PRs #307, #337–#339, #345).
- Watchdog hooks fail closed on throw, fence stale lock steals, do not treat an empty model as a quarantine wildcard, and spawn `verify-pr-head` as argv (PRs #309, #310, #315–#317).
- Pre-open review treats agent-instruction markdown, Copilot MCP `servers.json`, and Cursor `mdc` project rules as operational policy, and classifies code paths with trailing format characters as logic (PRs #311, #318–#320).
- Orphan-workflow cleanup rechecks ref SHAs before each delete. Behavioural eval scores require a hash-bound transcript sidecar instead of in-pack traces (PRs #333, #334, #352).
- Behavioural-evaluation docs show the run pack and `<run>.transcript.json` sidecar, and set `transcriptsSha256` to the SHA-256 of `canonicalJson` of the parsed sidecar object, matching `hashBehaviouralTranscripts` (PRs #356, #358).

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
- Redeem trusted authority before the first mutating GitHub command, including autonomous idempotency tag/ref coordination, so a rejected grant cannot leave a coordination write behind before the requested mutation (PR #299).
- Preserve rename/copy source and destination paths with NUL-delimited local branch diff parsing, keep both path generations in review classification, and make every deterministic required probe a first-class pre-open blocker until its canonical structured probe-evidence record validates against the deterministic trigger files (PR #299).
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
