<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- evidence
- git
- issues
- publication
- stacks (when stack topology is detected)
<!-- policy-modules:end -->

# Supersede a pull request

**Trigger:** “supersede PR #N with #M”, “replace PR #N with #M”, “close #N in
favor of #M”, “PR #M supersedes #N”, “close the old PR and point everyone at
the new one”.

## Goal

Close an obsolete open PR (`#N`) because a replacement PR (`#M`) now carries
the work, and make the replacement relationship visible to everyone following
either PR. The obsolete PR is **closed**, never merged. Its linked issues are
**not** auto-closed by this workflow (the replacement PR owns them), so the
replacement relationship and any `Fixes #N` linkage are checked instead.

## Public interface

The user speaks naturally. `supersede PR #12 with #45` must load this workflow
through `SKILL.md`; the agent runs the required scripts internally. Never
require the user to construct a broker request or invoke Node manually.

## Mutation mode

A direct request such as `supersede PR #12 with #45` authorizes `maintainer`
mode with explicit instruction for exactly two primitive actions on the obsolete
PR: `close_pr`, then an idempotent `post_comment` naming the replacement. It
does **not** authorize merging, closing the replacement, or unrelated writes.
Human replies still require exact-text confirmation. Read
`references/mutation-modes.md` and `references/github-mutation-broker.md` before
the first write.

The old composite `supersede_pr` mutation is intentionally unsupported. A
multi-effect CLI call cannot give reliable lost-response recovery because the
caller cannot tell which effect GitHub committed. Keep the close and the social
write as separately observable, separately retryable broker operations.

## Preflight (read-only; stop on ambiguity)

1. Load both PRs’ metadata: number, title, author, state, base/head refs, draft
   state, linked issues, and stack membership.
2. Resolve bare `#N` per shared rules (`#N` with a supersede verb means PRs).
3. Run `scripts/ship-gate.mjs` for **both** PRs with the active mutation mode.
   The obsolete PR must be open and not merged; the replacement PR must exist
   and be open (or be about to be created by `create-pr-for-issue`).
4. **Ordering rule:** when the replacement PR does not exist yet, the workflow
   runs `references/create-pr-for-issue.md` first (pre-open gate + open +
   merge-ready loop) and only then returns here to close the obsolete PR.
5. **Scope rule:** the obsolete PR must actually be superseded — its intent is
   fully carried by the replacement. If the replacement covers only part of the
   obsolete PR’s scope, **stop and report** the leftover scope; do not close the
   obsolete PR until the user decides whether to close it or keep it open for
   the remainder.
6. **Stack rule:** if either PR is part of a stack, load
   `references/stacked-prs.md` first. Never close a stack parent while open
   children depend on it unless the children were retargeted first.
7. **Do not merge:** this workflow never merges. If the user asks to merge the
   replacement, run `references/merge-pr.md` for it first, then close the
   obsolete PR only if its scope is truly subsumed.

## Step 1 — close the obsolete PR (broker only)

All visible writes go through `scripts/github-mutate.mjs`; bare `gh pr close`
and bare mutating `gh api` are forbidden.

Use one `close_pr` request bound to the obsolete PR's current head:

```json
{
  "schemaVersion": 1,
  "action": "close_pr",
  "mutationMode": "maintainer",
  "explicitInstruction": true,
  "repo": "OWNER/REPO",
  "pr": 12,
  "expectedHead": "obsolete-pr-head-sha"
}
```

Plan it first, then execute it through the broker and keep the receipt.
Immediately re-read PR #12. The required postcondition is `state=CLOSED` and
`merged=false`.

## Step 2 — publish the supersede note idempotently

Only after the obsolete PR is observed closed, post the relationship as a
separate brokered social write:

```json
{
  "schemaVersion": 1,
  "action": "post_comment",
  "mutationMode": "maintainer",
  "explicitInstruction": true,
  "repo": "OWNER/REPO",
  "pr": 12,
  "expectedHead": "obsolete-pr-head-sha",
  "idempotencyKey": "supersede-pr-12-by-45",
  "body": "Superseded by PR #45. The replacement now carries this work."
}
```

The broker's remote idempotency marker makes this step safe to retry after an
unknown network outcome without producing a duplicate note.

## Partial-failure recovery

After a process crash, timeout, 429, connection reset, or any unknown mutation
outcome, **read remote state before deciding what to retry**. Use the deterministic
state model implemented by `scripts/lib/supersede-recovery.mjs`:

| Observed obsolete PR | Supersede note | Next action |
|---|---|---|
| open | either | retry/perform `close_pr` |
| closed | missing | perform idempotent `post_comment` |
| closed | present | complete; do nothing |
| merged | either | stop; supersede invariant was violated |
| unknown/unreadable | either | stop unknown; do not mutate |

This ordering also prevents a durable “superseded” success-looking comment from
being posted before the PR has actually closed.

## Link the replacement (broker only)

1. Verify the replacement PR body references the obsolete PR where useful
   (for example, “Supersedes #12”). If missing, post **one** idempotent
   `post_comment` on the replacement via the broker naming the obsolete PR and
   the reason.
2. Verify the obsolete PR’s linked issues are **not** closed by the supersede;
   the replacement PR must carry the `Fixes #N` linkage. If the replacement
   does not yet link the issues, follow the create-PR linkage step
   (`references/create-pr-for-issue.md` step E) and fix the replacement body.
3. Reply to any open “why closed?” human thread on the obsolete PR only after
   exact-text confirmation (shared social policy).

## After closing

1. Re-read both PRs. Confirm the obsolete PR is `closed` (not merged) with a
   supersede comment, and the replacement is open and linked.
2. Report both PR numbers, the close receipt, the comment receipt, the
   replacement linkage state, and any stack/retarget consequence.
3. If the obsolete PR was a stack parent, hand off to `manage-stacked-prs` for
   child retarget before the parent branch is deleted.

## Done when

- The obsolete PR is closed (not merged) with a visible supersede note
- The replacement PR is open, exists, and carries the superseded scope
- Linked issues remain open unless the replacement owns and fixes them
- The close and comments went through the broker with verified receipts
- A retry after any partial failure converges from remote state without a
  duplicate social write
