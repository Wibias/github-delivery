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

Open only the requested PRs, normally one, on the issue's canonical repository. Fix the verified issue, preserve unrelated work, pass the required gates, link/assign/notify as permitted, and stop before merge.

## Runtime contract

- Load this workflow and its declared policy modules; load large review methods only when a gate or review axis needs them.
- Every network-visible GitHub write uses an exact broker action through:
  `node scripts/github-mutate.mjs --request <file> --execute [--audit <file>]`.
- Let `github-mutate.mjs` own authority setup, attachment, and redemption. Batch only independent exact writes.
- Local edits/tests/commits are not publication; remote pushes and GitHub state changes remain brokered.
- **Do not merge.**

## A. Need-to-fix preflight

Capture one current issue/development snapshot and answer before coding:

1. Is the issue still needed on the latest development/base tip?
2. Was it already fixed there? If yes, identify the SHA/PR.
3. Is an open PR already covering it?
4. Is it an obvious duplicate of another issue?

### Full issue thread intake

Read the issue body, **every comment** with pagination, labels, linked PRs, and timeline scope changes. Extract the Agent Brief, maintainer clarifications, `[GD]` research notes, repro updates, acceptance criteria, screenshots, and explicit non-goals. Carry that contract into implementation, PR description, and Spec review.

### Screenshot gate

Review author-provided screenshots/images before implementation. If required screenshots cannot be reviewed, stop instead of opening a speculative PR.

### Preflight outcome

- **Already fixed/shipped:** do not create a PR.
- **Covering PR exists:** do not create a duplicate; report/use that PR.
- **Duplicate issue:** do not create a PR for the duplicate; use the canonical issue.
- **Still needs fix:** continue.
- **Evidence incomplete:** restore the missing evidence; do not guess.

If `research-issue.md` just produced the same verdict on the same development tip and unchanged issue conversation, reuse it. Do not restart broad research merely because implementation reveals another call site, adapter, UI surface, test, or documentation consumer. Re-enter preflight only when a new fact invalidates the original decision.

## B. Confirm scope

Default to one cohesive PR. Split only when independently shippable concerns need separate validation/review boundaries or acceptance criteria conflict. Batches over three issues use fan-out.

## C. Implement locally

1. Start from the exact base/development tip captured in A. Use a task branch/worktree that preserves unrelated local work. Apply `references/git-workflow.md`; repository rules and `GD-GIT-*` remain authoritative.
2. For non-trivial implementation, apply `references/minimal-solution.md`, then make the smallest complete change that satisfies the issue contract without weakening required safeguards.
3. Follow required consumers as dependencies appear; for broad migrations or deterministic sweeps apply `references/change-execution.md`.
4. Run focused validation appropriate to the changed code: tests, typecheck, build, repro, and repository-local checks as available.
5. Require a non-empty base-to-head candidate diff. If no change is needed, return to the matching preflight outcome; do not open an empty PR.
6. Hygiene: run `references/no-comments.md` then `references/simplify-pr.md` unless this request opts out (`skip no-comments`, `without simplify`); a failed no-comments pass blocks publication.

## D. Pre-open bug + security gate

After implementation and before any push/open action, run:

```text
node <github-delivery>/scripts/pre-open-gate.mjs OWNER/REPO <base> <head>
```

- `ready`: continue.
- `blocked` with `workflow:implementation_missing`: return to C and implement.
- other `blocked`: run required branch-diff bug/security passes, load `bug-review.md` / `security-review.md` only for triggered lenses/surfaces, fix Confirmed High/Critical findings, record `done` or honest `n/a (why)` evidence, then re-evaluate.
- `unknown`: stop and restore complete branch evidence before publication.

Carry completed gate/review evidence into the PR validation notes.

## E. Publish the canonical PR

1. Resolve repository identity from the **issue**, not whichever remote is convenient, and resolve the correct base branch.
2. Publish the exact commit using broker action `push_code`. Bind the observed remote generation; use force-with-lease only when the selected Git workflow permits rewriting that branch.
3. Build the PR description from `references/pr-description.md`, the final candidate diff, issue acceptance criteria, thread clarifications, and completed validation. Do not narrate planned work as completed work.
4. After push, re-check exact publication identity: canonical repository + pushed head identity + intended base. One exact open PR → reuse it; multiple → fail closed and report them; none → create. This is narrower than A's semantic covering-PR check, and `create_pr` preflight repeats it immediately before execution.
5. Create with broker action `create_pr`, a stable idempotency key, and exact base/head/title/body. `create_pr_existing` names the publication result; do not bypass it or retry under another title.
6. Confirm the created/reused PR has the canonical issue repository and intended base/head. Wrong topology is a hard stop.

## F. Link, assign, notify

GitHub's closing-keyword behavior depends on the PR base:

- **Default branch:** put `Fixes #N` or `Closes #N` on its own line and verify `closingIssuesReferences` includes the issue.
- **Non-default branch:** GitHub ignores closing keywords for linking/auto-close. Do **not** loop on empty `closingIssuesReferences`; keep an explicit issue reference such as `Refs #N` and verify visible linkage. The issue comment below provides the durable issue-side pointer.

Then:

1. Assign yourself on the issue with broker action `assign_issue` when permissions permit. If denied, report once and continue.
2. Post exactly one idempotent issue comment with broker action `post_issue_comment`: `[GD] Opened PR #<pr> to address this.` Reuse the canonical PR number whether newly created or found by the exact publication check.
3. Spot-check that issue/PR references point at the canonical PR, not a fork-only or superseded PR.

## G. Make merge-ready

Work on the current PR head until the authoritative merge-ready bar is satisfied:

1. Keep the branch current with base and resolve conflicts safely. Remote branch updates use `push_code`.
2. Process current human/bot feedback. Fix required findings or decline them with verified rationale under review policy.
3. Required CI must be green on the authoritative current SHA. CI helpers aid diagnosis; they do not override `ship-gate.mjs`.
4. Complete own bug, security, Spec + Standards, semantic propagation, proactive contract verification, and relevant CODEOWNERS checks. Load detailed review references only for the active axis.
5. Reconcile the PR description with final head scope, validation, limitations, and linkage; update it through broker action `update_pr_body` when needed. Existing protected media must survive the rewrite unless exact media identities were explicitly authorized for removal under `references/pr-description.md`.
6. Run the settle window, re-read current reviews/checks/rules/base/head, then run the authoritative final ship gate. Head changes invalidate head-bound evidence.
7. When ready, publish merge-ready PR and linked-issue notifications through brokered actions. **Do not merge.**

## H. Completion report

Before final reporting, apply `references/completion-claims.md` to current authoritative evidence; re-measure material counts and preserve unknown, blocked, not-run, and partial states.

## Done when

- Requested PR count only; canonical issue repository and intended base/head.
- Full issue thread and screenshot gate completed; bounded preflight reached an evidence-backed outcome.
- Non-empty implementation diff existed before the pre-open gate; pre-open bug/security requirements cleared before publication.
- Existing exact-head/base publication was reused instead of duplicated after a race/retry.
- Every network-visible write went through `github-mutate.mjs`; required trusted authority was obtained/redeemed by the mutation runtime.
- PR description matches final head/issue contract; linkage follows the default/non-default rule without futile retries and protected media was preserved during rewrites.
- Issue self-assigned when possible; one complete opened-PR comment; no duplicates.
- Own reviews, current feedback, required CI, freshness checks, and final ship gate are satisfied on final head.
- Final report satisfies `references/completion-claims.md`.
- Merge-ready was published and **the PR was not merged**.