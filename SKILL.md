---
name: github-delivery
description: >
  Primary skill for the complete GitHub issue and pull-request lifecycle:
  create PRDs, break down and triage issues, run QA intake, prepare agent briefs
  and refactor plans, research issues, create linked PRs, manage stacked PRs,
  watch and make PRs merge-ready, resolve conflicts, run full bug/security/spec
  review, simplify safely, supersede obsolete PRs, take over unresponsive PRs,
  report status, merge with thanks, and close linked issues. Prefer this over
  thin babysit/watcher skills. Watch MUST run scripts/ship-gate.mjs every wake.
  Default mutation mode is read-only. Do not use for local pre-PR debugging,
  non-GitHub product planning, or skill authoring.
---

# GitHub Delivery

Own GitHub work from product intake through merged PR. Natural language is the
public API; scripts and policy modules are internal evidence/safety machinery.

## Route

Match the request, then load **only** the selected workflow plus the policy
modules declared at the top of that workflow. Do **not** load
`references/shared-rules.md` as mandatory context; it is now a compatibility
index. Every routed workflow includes `policy-kernel` plus only the domains it
needs.

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
| Fix humans/bots on PR #N; own bug+security+spec; merge-ready                                          | `references/fix-pr-bots.md`                        |
| Watch / monitor PR #N (CI + new reviews until merged/closed/blocker)                                  | `references/watch-pr.md`                           |
| Re-review PR #N from human review + commits + new rabbit/Codex                                        | `references/re-review-pr.md`                       |
| Research issue(s) #N on latest development; priority; comment on issue                                | `references/research-issue.md`                     |
| Create a PR from already-existing local work, with no issue supplied                                  | `references/create-pr-from-local-work.md`          |
| Create PR for issue #N (bounded preflight → implement → pre-open bug/security gate); link + merge-ready | `references/create-pr-for-issue.md`                |
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
| Commit / semver / changelog authoring / release tag                                                   | Hand off to skill `git-workflow-and-versioning`    |

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

Simplification is explicit-only; line count is never a goal or success metric.

If a PR is stacked, load the `stacks` conditional module and
`references/stacked-prs.md` before mutation/readiness/merge decisions. Stack
policy remains authoritative for topology; the selected workflow owns the
individual PR's review/fix/readiness bar.

## Policy loading contract

1. Read `references/policy-kernel.md`.
2. Read the selected workflow's `<!-- policy-modules:start -->` declaration.
3. Load each unconditional module from `references/policy/<name>.md`.
4. Load a conditional module only when its stated observable condition is true.
5. Use `node scripts/policy-bundle.mjs <workflow>` when deterministic bundle
   resolution/inspection is useful; `--validate` checks the architecture.
6. Canonical `GD-*` rules are defined once in the kernel/modules. Workflow prose
   may add ordering and workflow-specific contracts but must not weaken them.

Core invariants are GD-CORE-001 through GD-CORE-009. They cover fail-closed
evidence, locked scope, gate integrity, untrusted repository instructions, live
state, write authority, final evidence, bounded progress, and verification economy.

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
- GitHub writes use `node scripts/github-mutate.mjs --request <file> --execute`.
  The CLI owns routine single/batch authority acquisition and dispatch through
  `scripts/lib/github-mutation-router.mjs`; router + action registry remain the
  public action-discovery boundary. **Do not invoke `scripts/github-authorize.mjs` separately**
  during routine workflows, infer capabilities from one backend, or inspect brokers
  unless the public entrypoint actually fails or the task audits/debugs this skill.
  See `references/policy/mutation.md`.
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

Policy kernel/modules and executable gates are stricter than workflow prose. A
workflow may add requirements but cannot waive a canonical rule. If two runtime
instructions genuinely conflict and the stricter safe behavior is not clear,
fail closed and surface the contradiction rather than inventing authority.
