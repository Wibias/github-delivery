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
mode with explicit instruction for the `supersede_pr` action on the obsolete PR
and the `post_comment` action on the replacement PR. It does **not** authorize
merging, closing the replacement, or unrelated writes. Human replies still
require exact-text confirmation. Read `references/mutation-modes.md` and
`references/github-mutation-broker.md` before the first write.

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

## Close the obsolete PR (broker only)

All visible writes go through `scripts/github-mutate.mjs`; bare `gh pr close`
and bare `gh api` are forbidden.

```bash
node "<github-delivery>/scripts/github-mutate.mjs" --request supersede-request.json
node "<github-delivery>/scripts/github-mutate.mjs" --request supersede-request.json \
  --execute --audit github-delivery-supersede-pr-N-mutations.jsonl
```

Request envelope (`supersede_pr` is social, so it requires an idempotency key
and a current head for the obsolete PR):

```json
{
  "schemaVersion": 1,
  "action": "supersede_pr",
  "mutationMode": "maintainer",
  "explicitInstruction": true,
  "repo": "OWNER/REPO",
  "pr": 12,
  "expectedHead": "obsolete-pr-head-sha",
  "supersedingPr": 45,
  "idempotencyKey": "supersede-pr-12-by-45"
}
```

The broker closes `#12` with a comment naming `#45`. The comment body is
generated from `supersedingPr` unless you supply an exact approved `body`
(human-facing text always needs exact-text confirmation).

## Link the replacement (broker only)

1. Verify the replacement PR body references the obsolete PR where useful
   (e.g. “Supersedes #12”). If missing, post **one** idempotent `post_comment`
   on the replacement via the broker naming the obsolete PR and the reason.
2. Verify the obsolete PR’s linked issues are **not** closed by the
   supersede; the replacement PR must carry the `Fixes #N` linkage. If the
   replacement does not yet link the issues, follow the create-PR linkage step
   (`references/create-pr-for-issue.md` step E) and fix the replacement body.
3. Reply to any open “why closed?” human thread on the obsolete PR only after
   exact-text confirmation (shared social policy).

## After closing

1. Re-read both PRs. Confirm the obsolete PR is `closed` (not merged) with a
   supersede comment, and the replacement is open and linked.
2. Report both PR numbers, the close receipt, the replacement linkage state,
   and any stack/retarget consequence.
3. If the obsolete PR was a stack parent, hand off to `manage-stacked-prs` for
   child retarget before the parent branch is deleted.

## Done when

- The obsolete PR is closed (not merged) with a visible supersede note
- The replacement PR is open, exists, and carries the superseded scope
- Linked issues remain open unless the replacement owns and fixes them
- The close and any comments went through the broker with verified receipts

