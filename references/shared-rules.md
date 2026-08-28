# Shared rules compatibility index

`references/shared-rules.md` is retained for old links, assertions, and humans
navigating the repository. It is **not mandatory workflow context** anymore.
Canonical cross-workflow rules live in `references/policy-kernel.md` and
`references/policy/*.md`; selected workflows declare exactly which modules to
load.

## Canonical policy map

- Core invariants: `references/policy-kernel.md` (`GD-CORE-*`)
- Mutation authority and broker: `references/policy/mutation.md` (`GD-AUTH-*`)
- Evidence/snapshot freshness: `references/policy/evidence.md` (`GD-EVID-*`)
- Git/ownership safety: `references/policy/git.md` (`GD-GIT-*`)
- CI/base-health/settle: `references/policy/ci.md` (`GD-CI-*`)
- Review/feedback contracts: `references/policy/reviews.md` (`GD-REVIEW-*`)
- Issue lifecycle: `references/policy/issues.md` (`GD-ISSUE-*`)
- Stack topology: `references/policy/stacks.md` (`GD-STACK-*`)
- Release/live GitHub policy: `references/policy/releases.md` (`GD-REL-*`)
- Durable publication/verdicts: `references/policy/publication.md` (`GD-PUB-*`)

Use `node scripts/policy-bundle.mjs <workflow>` to inspect the exact bundle and
`node scripts/policy-bundle.mjs --validate` to detect drift.

## Compatibility assertions

These summaries preserve old documentation anchors while pointing to their
single canonical rule definition. The anchor registry below is non-normative:
it preserves locked regression-to-document traceability after the normative
text moved into focused policy modules.

<!-- legacy-assertion-anchor-registry:start -->
<!-- assertion: no-unnecessary-loads -->
<!-- assertion: refuse-false-merge-ready -->
<!-- assertion: bots-not-clean -->
<!-- assertion: own-reviews-required -->
<!-- assertion: no-soft-gated -->
<!-- assertion: ci-red-not-done -->
<!-- assertion: keep-fixing -->
<!-- assertion: update-base -->
<!-- assertion: compile-against-tip -->
<!-- assertion: no-stale-ready -->
<!-- assertion: disambiguate-issue-vs-pr -->
<!-- assertion: ask-when-both-exist -->
<!-- assertion: detect-stack -->
<!-- assertion: handoff-manage-stacked-prs -->
<!-- assertion: no-mid-stack-trunk-merge -->
<!-- assertion: utf8-no-bom -->
<!-- assertion: gh-input-file -->
<!-- assertion: verify-refetch -->
<!-- assertion: fork-head-hard-stop -->
<!-- assertion: graphql-review-threads -->
<!-- assertion: paginate-unresolved -->
<!-- assertion: block-if-open -->
<!-- assertion: enforcement-vs-suggestion -->
<!-- assertion: use-pr-policy-gate -->
<!-- assertion: recheck-after-push -->
<!-- assertion: approvals-on-head-sha -->
<!-- assertion: gt3-subagent-fanout -->
<!-- assertion: one-pr-per-subagent -->
<!-- assertion: no-serialize-parent -->
<!-- assertion: harden-not-rerun -->
<!-- assertion: same-failure-twice-fix -->
<!-- assertion: api-timeout-not-infra -->
<!-- assertion: rerun-failed-only -->
<!-- assertion: verify-windows-restarted -->
<!-- assertion: not-green-matrix-legs -->
<!-- assertion: fix-unrelated-required-ci -->
<!-- assertion: not-out-of-scope-excuse -->
<!-- assertion: minimal-harden-in-pr -->
<!-- assertion: base-update-first -->
<!-- assertion: green-is-provisional -->
<!-- assertion: adaptive-settle-default-60 -->
<!-- assertion: extended-settle-after-material-change -->
<!-- assertion: poll-authoritative-gate-20s -->
<!-- assertion: no-silent-sleep-over-30s -->
<!-- assertion: show-reason-remaining-next-check -->
<!-- assertion: reset-on-head-review-workflow-change -->
<!-- assertion: final-unchanged-head-gate -->
<!-- assertion: poll-dont-park -->
<!-- assertion: wake-on-every-change -->
<!-- assertion: keep-wait-visible -->
<!-- assertion: no-single-blocking-sleep-over-30s -->
<!-- assertion: same-head-anti-noise -->
<!-- assertion: reuse-without-material-delta -->
<!-- assertion: no-second-top-level-verdict -->
<!-- assertion: plan-verdict-publication -->
<!-- assertion: supersede-requires-replacement -->
<!-- assertion: supersede-scope-covered -->
<!-- assertion: supersede-linked-issues-stay-open -->
<!-- assertion: overtake-owns-branch-after-handover -->
<!-- assertion: overtake-close-with-reference -->
<!-- legacy-assertion-anchor-registry:end -->

### Bot-thread ownership (no false deferral)

Canonical: `GD-REVIEW-002` and `GD-REVIEW-003`.

For an in-diff valid bot finding, phrases such as “inherited / copied / fabric file — fix in another PR”, “rebase / stack / downstream branch will pick it up”,
“consumer lives elsewhere”, or “non-blocking” are not sufficient reasons to
defer and resolve. Follow the **Fix-or-decline sequence**. `review` may reply to bot threads and **may resolve bot-authored threads** through `--resolve-bot`,
but it must **not** resolve human threads under bot-thread authority.

### PR ownership boundary

Canonical: `GD-GIT-004`.

Resolve the authenticated viewer login before deciding whether the PR branch is
owned by the current operator. For a foreign PR, never update the branch from base
and never apply simplification changes; provide owner-directed instructions
instead. Applies to: `fix-pr-bots`, `full-review-pr`, `simplify-pr`, `no-comments`.

### Proactive contract verification

Canonical: `GD-REVIEW-008`.

Merge-ready review must **find bugs before bots**; bots/checks are necessary, not sufficient. The canonical rule retains:
- Wiring audit
- Operator smoke
- Test honesty
- Docs vs non-goals
- Input shape and evidence semantics
- Hot-path scale and determinism
- Malformed-input robustness
- Serialization and trace budgets
- Recursive/re-entrant lookups must terminate
- CLI/API payload completeness
- Unknown is not false
- Unknown must not outrank measured
- One decision, one clock
- Filter before LIMIT
- Aggregate semantics match the doc
- Byte budgets measure bytes
- No unbounded memory
- Absent vs malformed
- absence of a positive flag is not proof of absence
- Aggregate all contributing source records
- No self-recursion on a resolved target
- **Proactive contract verification incomplete** blocks a positive result.

## Supersede and maintainer overtake

Canonical lifecycle policy is split between `GD-AUTH-003`, `GD-GIT-004`,
`GD-ISSUE-007`, and `GD-STACK-006`, with workflow-specific sequencing in
`references/supersede-pr.md` and `references/overtake-pr.md`.

### Supersede a PR

<!-- assertion: supersede-close-not-merge -->
The obsolete PR is closed with replacement linkage, never treated as merged.
Linked issues remain governed by the replacement's actual closing linkage.

### Maintainer overtake

<!-- assertion: overtake-author-unavailable -->
<!-- assertion: overtake-maintainer-push-rights -->
Overtake requires an unavailable author plus maintainer push authority; it does
not itself authorize merge.

### Full-review verdict publication identity

Canonical: `GD-PUB-002`, `GD-PUB-003`, and `GD-PUB-004`.

The full-review run uses `full-review-run-id`; the **Same-head anti-noise rule (PR #1066)** uses `planVerdictPublication`. Repair the current run marker first,
then **reuse** a completed same-head verdict when the strict label/TLDR material
delta is empty. The idempotency boundary is **current run marker first**, then
**same head + material TLDR/label delta**.

### Full-review verdict completion lock

Canonical: `GD-PUB-004`.

`Publish final verdict` remaining pending or in_progress is never a completed state. `verify-verdict-published.mjs` must show `published: true` plus `format.valid: true` is the only normal completion proof. A blocker changes the verdict. It does not permit the workflow to omit the verdict.
A self-selected stricter mutation mode is not publication unavailability. Only explicit user cancellation may end the required publication workflow without the verdict.

## Full-review semantic completeness

Workflow-specific method: `references/semantic-propagation-review.md`, composed
by `references/full-review-pr.md` under `GD-REVIEW-004` and `GD-REVIEW-008`.
Running every named review axis is not sufficient when the changed abstraction
has untraced variants. When canonical and derived representations coexist,
trace both wherever they coexist. Coverage is not representative of the changed abstraction when one
representative is used without proving equivalence.

## Historical links

Focused references such as `base-health.md`, `gate-helpers.md`,
`mutation-modes.md`, `bug-review.md`, `security-review.md`,
`spec-standards-review.md`, and `semantic-propagation-review.md` remain runtime
methods when the selected workflow explicitly composes them. This index does
not replace those methods and does not make them globally mandatory.
