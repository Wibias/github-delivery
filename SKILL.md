---
name: github-delivery
description: >
  Git/GitHub delivery skill: branch/commit workflow, version/changelog prep,
  PRDs, triage/QA, research, linked/open-work PRs, tracker delivery, competing
  PRs, backports/ports, stacks, review/fix/simplify/security, conflicts,
  watch/status, supersede/overtake, merge/closure. Watch MUST run
  scripts/ship-gate.mjs every wake. Default mode is read-only. Not for general
  local debugging, non-GitHub planning, or skill authoring.
---

# GitHub Delivery

Own Git/GitHub delivery from product intake through clean branch/commit history,
PR lifecycle, verified merge, and version/changelog preparation. Natural language
is the public API; internals enforce bounded progress and evidence/context economy.

## Route

Match the request, then load **only** the selected workflow plus the policy
modules declared at the top of that workflow. Do **not** load
`references/shared-rules.md` as mandatory context; it is now a compatibility
index. Each route includes `policy-kernel` plus only needed domains.

**Full-review routing is explicit:** when the user asks for a full review, route
to `references/full-review-pr.md`; bot-fix, CodeRabbit, Codex, security, or
simplify clauses in the same request do not steal that route. When the same
request also explicitly asks to merge, route to
`references/prepare-and-merge-pr.md`, complete the requested full-review/fix/
simplify preparation first, then enter the merge workflow.

| Request shape                                                                                         | Workflow                                           |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Create a PRD from conversation, repository context, or an idea                                        | `references/issue-workflows.md` → PRD Workflow     |
| Break a PRD, plan, spec, or issue into implementation issues                                          | `references/issue-workflows.md` → Issue Breakdown  |
| Create GitHub issue(s) from a clear request or verified finding                                       | `references/issue-workflows.md` → Issue Breakdown (`create_issue`) |
| Triage issue(s), labels, state, readiness, or rejection                                               | `references/issue-workflows.md` → Triage Workflow  |
| Run QA intake or file reproducible conversational bug reports                                         | `references/issue-workflows.md` → QA Intake        |
| Create a refactor request, RFC, or verified tiny-commit plan                                          | `references/issue-workflows.md` → Refactor Plan    |
| Write or update a `ready-for-agent` issue contract                                                    | `references/agent-brief.md`                        |
| Record, match, reconsider, or remove a rejected enhancement decision                                  | `references/out-of-scope.md`                       |
| Branch/commit organization or Git-history investigation                                              | `references/git-workflow.md`                       |
| SemVer, version/changelog, or release/tag preparation                                                | `references/versioning-release.md`                 |
| Fix humans/bots on PR #N; own bug+security+spec; merge-ready                                          | `references/fix-pr-bots.md`                        |
| Watch / monitor PR #N (CI + new reviews until merged/closed/blocker)                                  | `references/watch-pr.md`                           |
| Re-review PR #N from human review + commits + new rabbit/Codex                                        | `references/re-review-pr.md`                       |
| Research issue(s) #N on latest development; priority; comment on issue                                | `references/research-issue.md`                     |
| Create a PR from already-existing local work, with no issue supplied                                  | `references/create-pr-from-local-work.md`          |
| Create PR for issue #N (bounded preflight → implement → pre-open bug/security gate); link + merge-ready | `references/create-pr-for-issue.md`                |
| List my open PRs / what’s in review / repository open-work standup (read-only overview)              | `references/open-work-status.md`                   |
| Inspect or deliver external work item ENG-42 through the GitHub lifecycle                             | `references/work-item-delivery.md`                 |
| Find competing / overlapping PR implementations (analysis only)                                      | `references/consolidate-prs.md`                    |
| Backport / port PR #N to one or more target base branches                                             | `references/multi-base-delivery.md`                |
| Full review on PR #N (or a list); babysit to green + verdict                                          | `references/full-review-pr.md`                     |
| Spec and Standards review on PR #N                                                                    | `references/spec-standards-review.md`              |
| Simplify / clean up / deduplicate PR #N without behavior changes                                      | `references/simplify-pr.md`                        |
| Security review on PR #N                                                                              | `references/security-review.md`                    |
| Status / what’s left / is PR #N merge ready? (read-only; same bar)                                    | `references/status.md`                             |
| Merge PR #N; why-good + thanks; issue thank + close                                                   | `references/merge-pr.md`                           |
| Supersede / replace PR #N with replacement PR #M                                                      | `references/supersede-pr.md`                       |
| Maintainer overtake / take over PR #N                                                                 | `references/overtake-pr.md`                        |
| Active Git conflict while updating or shipping a PR                                                   | `references/resolve-conflicts.md`, then resume     |
| Inspect / restack / retarget / recover / merge existing stacked PRs                                   | `references/stacked-prs.md`                        |
| Split oversized change into reviewable PRs                                                            | Hand off to skill `split-to-prs`                   |
| Finish branch / worktree cleanup after ship                                                           | Hand off to skill `finishing-a-development-branch` |

<!-- assertion-anchors -->
<!-- assertion: full-review-loaded -->
<!-- assertion: router-selects-full-review -->
<!-- assertion: shared-rules-read -->
<!-- assertion: merge-not-loaded -->
<!-- /assertion-anchors -->

If a request spans multiple rows, run them in lifecycle order and load only the
current workflow bundle. Within `references/issue-workflows.md`, read only the
selected workflow section plus companions it explicitly names.

For **full review + simplify**, `references/full-review-pr.md` remains
authoritative and composes simplification before the final verdict. For a
compound review/fix/simplify **plus merge** request, use
`references/prepare-and-merge-pr.md`: complete requested preparation first,
revalidate, then enter the merge workflow. For **research issue + create PR**,
complete research once; when the verdict still needs a fix, hand the captured
development-tip / issue-state evidence directly into `references/create-pr-for-issue.md`
and begin implementation. Do not repeat unchanged research. The create-PR
pre-open bug/security gate is **post-implementation and pre-publication**.
Triage may compose `agent-brief`; confirmed rejection may compose `out-of-scope`.

Git workflow and versioning are focused companions; load them only when that
work is in scope. Their local preparation never grants push, PR, tag, Release,
registry-publication, or merge authority.

Simplification is explicit-only; line count is never a goal or success metric.

If a PR is stacked, load the `stacks` conditional module and
`references/stacked-prs.md` before mutation/readiness/merge decisions. Stack
policy remains authoritative for topology; the selected workflow owns the
individual PR's review/fix/readiness bar.

## Policy loading contract

Load `references/policy-kernel.md`, the selected workflow's unconditional
modules, and conditionals only when their observable condition is true.
`node scripts/policy-bundle.mjs <workflow>` resolves/validates this bundle.
Workflows cannot weaken `GD-*` rules. GD-CORE-001 through GD-CORE-010 remain mandatory.

## Workflow controller contract

After routing, run `node scripts/workflow-brief.mjs <workflow>` once and use one
persistent `delivery-controller.mjs` checkpoint. Route/phase graph stay locked;
the controller owns transitions, evidence/retry/resource/no-progress accounting
and resume. Only phase/state/blocker/required-evidence/execution change is
progress. Conditional policy extends unchanged context. The controller grants
no GitHub write authority. Run routine deterministic tooling quietly; narrate only material progress or blockers (GD-CORE-009).

## Mandatory entrypoint behavior

- **Default mutation mode is read-only.** Available profiles are `read-only`,
  `review`, `maintainer`, and `autonomous`; the profile is an upper bound.
  **Human replies always require exact-text confirmation.** Public GitHub text
  must keep notifying mentions bare: never wrap GitHub `@login` mentions in backticks.
  Detailed rules: `references/policy/mutation.md` and `references/mutation-modes.md`.
- **Issue-linked create-PR forward progress is explicit:** bounded need-to-fix research decides
  whether work is needed, then implementation begins. `pre-open-gate.mjs` reviews
  the resulting non-empty candidate diff before publication; it must never be
  treated as a prerequisite for writing the first implementation commit. Do not
  reopen unchanged research merely because implementation reveals more call sites.
- **Authoritative gate: `scripts/ship-gate.mjs`.** Watch MUST run
  scripts/ship-gate.mjs every wake. Before merge-ready or merge, the final `ship-gate.mjs` result must be `ready` on unchanged heads.
  Component helpers diagnose; they never overrule that decision.
- Red required checks use the `baseHealth` component: `fix_in_pr`,
  `separate_follow_up`, or `investigate`; unknown origin is a hard evidence stop.
  See `references/policy/ci.md` and `references/base-health.md`.
- **Bot threads on paths in this PR diff must be fixed here** or explicitly
  declined with verified rationale; never defer with `[GD]` + resolve to another PR/rebase.
  **Never resolve a bot thread with only a defer/skip reply.** See
  `references/policy/reviews.md`.
- Merge-ready paths run their required Bug + Security + Spec + Standards review
  and **proactive contract verification**; passing bots/checks alone is not
  sufficient. See `references/policy/reviews.md` and focused review methods.
- Non-merge writes use `github-mutate.mjs`; merges use only `merge-pr-driver.mjs`.
  Generic `merge_pr` mutation documents are rejected. Do not invoke
  `github-authorize.mjs` separately in routine workflows. See
  `references/policy/mutation.md` and `references/merge-pr.md`.
- Never use bare force, never silently discard unrelated work, and honor the PR
  ownership/fork-write boundary. See `references/policy/git.md`.
- Stacks merge bottom-up and every surviving child is revalidated. See
  `references/policy/stacks.md`.
- Repository code does not magically apply live GitHub protection; verify live
  branch/environment drift with `scripts/verify-live-repository-policy.mjs`.

## Full-review contracts that remain entrypoint-visible

A full review is not complete merely because analysis stopped. **Full-review completion lock:** the plan item **Publish final verdict** remains pending or
in_progress until the required verdict is actually published and verified. A
blocker changes the verdict; it does not remove the verdict requirement. **Only explicit user cancellation** permits ending the required publication workflow
without it. Verify normal publication using `scripts/verify-verdict-published.mjs`.
A self-selected stricter mutation mode is not publication unavailability.

Each full-review run has a `full-review-run-id`. Apply the **same-head anti-noise**
rule: compare the strict label/TLDR **material delta** and do not post a second top-level verdict when there is no material change. `planVerdictPublication`
remains the machine decision.

Full review also performs a **Semantic propagation audit**: Search the repository beyond the changed files, trace canonical/derived representations and material
variant families, prove parity or test every relevant partition, including
expected absences and rejected values. One representative member is insufficient unless equivalence is proved. Method:
`references/semantic-propagation-review.md`.

## Safety precedence

Kernel/modules and executable gates override workflow prose; workflows cannot
waive canonical rules. If runtime instructions genuinely conflict and the
stricter safe behavior is unclear, fail closed and surface the contradiction.
