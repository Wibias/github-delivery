# Changelog

All notable changes to `github-delivery` are documented here.

## [Unreleased]

## [1.3.3] - 2026-08-28

### Changed

- Bumped the package version from `1.3.2` to `1.3.3`.

### Fixed

- Operational process, job, and worktree status probes such as `Get-Process`, `Get-CimInstance Win32_Process`, `tasklist`, `ps`, `pgrep`, and `git worktree list` now count as volatile watchdog evidence instead of neutral activity. Repeated polling therefore consumes the protected evidence budget rather than bypassing delivery-convergence limits (PR #386).
- Authoritative live `ship-gate` snapshot failures now preserve a bounded upstream cause and return a structured fail-closed `unknown` result with retryability classification. Deterministic GitHub capability or permission failures such as 401/403 stop equivalent retries, transient upstream failures remain distinguishable, and established replay/workflow/argument stderr contracts are unchanged (PR #387).

## [1.3.2] - 2026-08-28

### Added

- Added a `no-comments` workflow that strips source-comment alibis via an independent comment inspector, keeps the closed innocent list, and treats leftover workarounds as merge-ready blockers before review, merge-ready, and create-PR publication (PR #384).

### Changed

- No-comments and simplify now run by default on full review, re-review, merge-ready/fix, and create-PR pre-open unless the request opts out. Their opt-outs are independent, and a bare full review still does not gain `push_code`. Eligible simplify candidates auto-apply on our own PRs only when `push_code` is already allowed (PR #384).
- Bumped the package version from `1.3.1` to `1.3.2`.

### Fixed

- Simplify opt-outs such as `without simplify`, `skip simplify`, and `don't simplify` no longer count as positive simplify intent in full-review or prepare-and-merge routing, so they cannot accidentally promote a read-only review into a `push_code`-capable workflow (PR #384).
- `authorityMode=off` now carries trusted workflow intent through the canonical `github-mutate` controller path using operation-scoped checkpoint evidence instead of caller-controlled mutation JSON. The trusted fact is bound to the exact mutation identity, so changing the target or payload invalidates the context (PR #385).
- Mutation-document idempotency and resume identities now bind the canonical request payload instead of a reusable bare label, preventing two different operations with the same human `idempotencyKey` from being collapsed into `already_applied` (PR #385).
- Replaced the input-dependent trailing Windows-separator regular expression in subprocess path normalization with a linear character scan after GitHub Advanced Security flagged it as potentially polynomial (PR #385).

### Security

- Protected Windows `gh` and `git` launches now resolve only from absolute PATH entries outside the target worktree. Both lexical candidates and canonicalized targets are checked, closing current-working-directory executable hijacking as well as worktree junction/symlink escape paths before the broker spawns a security-sensitive executable (PR #385).

## [1.3.1] - 2026-08-28

### Changed

- Bumped the package version from `1.3.0` to `1.3.1`.

### Fixed

- Exclusive skill and Windows Authority install locks now recover after a hard-crashed github-delivery process leaves a stale owned lock behind. Recovery is limited to the exact github-delivery PID + nonce token format and only proceeds when that PID is provably gone; live, malformed, and permission-uncertain locks remain fail-closed as `install_lock_held` (PR #383).
- Installed `policy-bundle.mjs` and `workflow-brief.mjs` helpers now resolve github-delivery's own installed skill root by default instead of treating the caller repository's current working directory as the workflow root. Explicit root overrides remain supported, so agents can load `git-workflow` and other workflow packets without changing out of the repository they are operating on (PR #383).
- Rewrite-baseline file-store generation allocation is now finalized after the exclusive cross-process lock is acquired, so a waiting writer cannot reuse a generation published by the previous writer between its pre-lock scan and lock acquisition. Existing stale-takeover generation fencing remains intact (PR #383).

## [1.3.0] - 2026-08-27

### Added

- Git workflow is now a first-class github-delivery capability through `references/git-workflow.md`: repository conventions drive branch naming and commit style, task-owned work is separated from unrelated user changes, logical/atomic commit boundaries avoid arbitrary size targets, pre-commit verification uses repository-native checks, generated files follow repository evidence, and `git log` / `blame` / `bisect` are available as bounded delivery evidence (PR #377).
- Versioning and release preparation are now first-class through `references/versioning-release.md`: the workflow inventories the actual delta from the previous release, classifies MAJOR/MINOR/PATCH by observable consumer impact, keeps version sources consistent, curates a human changelog, verifies tag/version identity, and keeps tag/Release/registry publication separately authorized (PR #377).

### Changed

- Bumped the package version from `1.2.0` to `1.3.0`.
- Removed the public handoff to `git-workflow-and-versioning`. Explicit branch/commit and SemVer/changelog/release-preparation requests now route inside github-delivery, while the existing stricter `GD-GIT-*` safety rules and repository-local conventions remain authoritative (PR #377).
- Issue-linked and local-work PR publication now compose the Git-workflow reference when branch/commit preparation is needed, preserving progressive disclosure instead of loading Git/versioning guidance into unrelated GitHub reads (PR #377).
- Git/versioning routes now resolve through the mandatory workflow-packet/controller runtime. Explicit full-review intent keeps precedence over broad Git/version keywords in attributed repository text, and workflow execution packets advertise only actions that exist in the public mutation registry (PR #379).

### Fixed

- Controller head reconciliation now treats verified `reconciled_after_error` pushes as completed and preserves the original request, including `newTip`, across crash/resume `already_applied` receipts so checkpoint recovery can restore the authoritative head without repeating a completed push (PR #380).

### Security

- Native PR approval is now a dedicated first-class `approve_pr` authority action. Generic `post_review` cannot encode approval, explicit approval intent remains required, Windows Authority binds the semantic approval action, and self-approval is rejected before a GitHub approval write is attempted (PR #378).
- Windows update lock recovery now binds graceful-close consent to the inspected PID plus process start identity and re-verifies that identity immediately before `CloseMainWindow()`. PID reuse therefore fails closed instead of redirecting an approved close to a different process (PR #381).

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
