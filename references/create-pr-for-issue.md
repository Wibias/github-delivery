<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- evidence
- git
- ci
- reviews
- issues
- publication
- stacks (when stack topology is detected)
<!-- policy-modules:end -->

# Create PR for issue -> merge-ready

**Trigger:** Create a PR for issue `#N`, make it merge-ready, do not merge.

## Goal

Open exactly the requested PR count, normally one, on the issue's canonical repository. Fix the verified issue, preserve unrelated user work, pass the pre-open and merge-ready gates, link the work to the issue as GitHub permits for the selected base, self-assign when possible, notify once, and stop before merge.

## Runtime contract

- Load this workflow plus its declared policy modules. Load large review methods only when a gate or review axis needs their detail.
- Every network-visible GitHub write uses an exact broker action through:
  `node scripts/github-mutate.mjs --request <file> --execute [--audit <file>]`.
- Let `github-mutate.mjs` own authority setup, attachment, and redemption. Batch independent exact writes only when none depends on earlier generated output.
- Local edits/tests/commits are not publication; remote pushes and GitHub state changes remain brokered.
- **Do not merge.**

## A. Need-to-fix preflight

Capture one current issue/development snapshot and answer these four questions before coding:

1. Is the issue still needed on the latest development/base tip?
2. Was it already fixed there? If yes, identify the SHA/PR.
3. Is an open PR already covering it?
4. Is it an obvious duplicate of another issue?

### Full issue thread intake

Before deciding scope, read the issue body, **every comment** with pagination, labels, linked PRs, and timeline scope changes. Extract `## Agent Brief`, maintainer clarifications, `[GD]` research notes, repro updates, acceptance criteria, screenshots, and explicit non-goals. Carry that contract into implementation, PR description, and Spec review.

### Screenshot gate

Check the body and full issue thread for author-provided images/screenshots. If present, review them before implementation. If required screenshots cannot be reviewed, stop instead of opening a speculative PR.

### Preflight outcome

- **Already fixed/shipped:** do not create a PR.
- **Covering PR exists:** do not create a duplicate; report/use that PR.
- **Duplicate issue:** do not create a PR for the duplicate; use the canonical issue.
- **Still needs fix:** continue.
- **Evidence incomplete:** restore the missing evidence; do not guess.

Reuse an unchanged `research-issue.md` verdict on the same development tip/issue conversation. Re-enter preflight only when new evidence invalidates it.

## B. Confirm scope

Default to one cohesive PR. Split only for independently shippable concerns that need different validation/review boundaries or have conflicting acceptance criteria. Batches over three issues use fan-out.

## C. Implement locally

1. Start from the exact base/development tip captured in A. Use a task branch/worktree that preserves unrelated local user work.
2. For non-trivial implementation, apply `references/minimal-solution.md`, then make the smallest complete change that satisfies the issue contract without weakening required safeguards.
3. Follow concrete dependencies as they appear; inspect and update required consumers instead of returning to broad preflight research. For broad migrations or deterministic sweeps, apply `references/change-execution.md`.
4. Run focused validation appropriate to the changed code: tests, typecheck, build, repro, and repository-local checks as available.
5. Require a non-empty base-to-head candidate diff. If no change is needed, return to the matching preflight outcome and do not open an empty PR.

## D. Pre-open bug + security gate

After implementation and before any push/open action, run:

```text
node <github-delivery>/scripts/pre-open-gate.mjs OWNER/REPO <base> <head>
```

- `ready`: continue.
- `blocked` with `workflow:implementation_missing`: return to C and implement.
- other `blocked`: run the required branch-diff bug and security passes, load `bug-review.md` / `security-review.md` only for the triggered lenses/surfaces, fix Confirmed High/Critical findings, record `done` or honest `n/a (why)` evidence, then re-evaluate.
- `unknown`: stop and restore complete branch evidence before publication.

Carry the completed gate/review evidence into the PR validation notes.

## E. Publish the canonical PR

1. Resolve repository identity from the **issue**, not from whichever remote is convenient. Resolve the correct base branch for that repository.
2. Publish the exact local commit using broker action `push_code` through the one-call mutation entrypoint. Bind the observed remote generation and use force-with-lease only when the selected Git workflow explicitly permits rewriting that branch.
3. Build the PR description from `references/pr-description.md`, the final candidate diff, issue acceptance criteria, thread clarifications, and completed validation. Do not narrate planned work as completed work.
4. Create the PR with broker action `create_pr` through the same entrypoint. Use a stable idempotency key and exact base/head/title/body.
5. Confirm the returned PR is on the canonical issue repository and the intended base/head. Wrong topology is a hard stop; do not silently repair a different repository.

## F. Link, assign, notify

GitHub's closing-keyword behavior depends on the PR base:

- **PR targets the repository default branch:** put `Fixes #N` or `Closes #N` on its own line and verify `closingIssuesReferences` includes the issue.
- **PR targets a non-default branch:** GitHub ignores closing keywords for linking/auto-close. Do **not** loop on an empty `closingIssuesReferences`. Keep an explicit issue reference in the PR body (for example `Refs #N`) and verify the visible cross-reference/linkage path used by the repository. The opened-PR issue comment below provides the durable issue-side pointer.

Then:

1. Assign yourself on the issue with broker action `assign_issue` when permissions permit. If denied, report once and continue.
2. Post exactly one idempotent issue comment with broker action `post_issue_comment`: `[GD] Opened PR #<pr> to address this.`
3. Spot-check that issue/PR references point at the canonical PR, not a fork-only or superseded PR.

## G. Make merge-ready

Work on the current PR head until the authoritative merge-ready bar is satisfied:

1. Keep the branch current with base and resolve conflicts safely. Every remote branch update uses `push_code`.
2. Process current human/bot review feedback. Fix required findings on this diff or decline them with verified rationale under review policy.
3. Required CI must be green on the authoritative current SHA. Use the CI helpers for diagnosis; they do not override `ship-gate.mjs`.
4. Complete own bug, security, Spec + Standards, semantic propagation, proactive contract verification, and relevant CODEOWNERS checks. Load detailed review references only for the axis currently being executed.
5. Reconcile the PR description with the final head and update stale scope, validation, limitations, or linkage through broker action `update_pr_body` when needed.
6. Run the appropriate settle window, then re-read current reviews/checks/rules/base/head and run the authoritative final ship gate. If the head changes, invalidate head-bound evidence and revalidate.
7. When ready, publish the merge-ready PR and linked-issue notifications through brokered actions. **Do not merge.**

## H. Completion report

Before final reporting, apply `references/completion-claims.md` to current authoritative evidence; re-measure material counts and preserve unknown, blocked, not-run, and partial states.

## Done when

- Requested PR count only; no surprise batch.
- Canonical issue repository and intended base/head.
- Full issue thread and screenshot gate completed.
- Bounded preflight reached an evidence-backed outcome without repeated unchanged research.
- Non-empty implementation diff existed before the pre-open gate.
- Pre-open bug/security requirements cleared before publication.
- Every network-visible write went through `github-mutate.mjs`; required trusted authority was obtained and redeemed by the mutation runtime.
- PR description matches the final head and issue contract.
- Default-base closing reference is verified, or non-default-base linkage follows the explicit non-default rule above without futile `closingIssuesReferences` retries.
- Issue self-assigned when possible; one complete opened-PR comment; no duplicates.
- Own reviews, current review feedback, required CI, freshness checks, and final ship gate are satisfied on the final head.
- Final report satisfies `references/completion-claims.md`.
- Merge-ready was published and **the PR was not merged**.
