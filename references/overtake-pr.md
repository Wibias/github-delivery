# Maintainer overtake of a pull request

**Trigger:** “overtake PR #N”, “maintainer overtake #N”, “take over PR #N”,
“the author is unresponsive, take it over”, “I’m a maintainer — I’ll take this
PR over”.

## Goal

When the PR author is unresponsive, unavailable, or unwilling to finish the
work, a maintainer takes over the PR: they assume ownership of the change,
push the fixes the PR still needs, and carry it to merge-ready — or to a
close-with-reference decision — without impersonating the original author.

This is **not** the same as “fix a foreign PR’s comments”: overtake is the
explicit maintainer-authorized handover of the PR itself, not just a set of
instructions to the owner.

## Public interface

The user speaks naturally. `maintainer overtake PR #12` must load this workflow
through `SKILL.md`; the agent runs the required scripts internally. Never
require the user to construct a broker request or invoke Node manually.

## Mutation mode

An explicit overtake request authorizes `maintainer` mode with explicit
instruction for the push/close/comment actions this workflow requires. It does
**not** authorize merging unless the user also asks to merge (then
`references/merge-pr.md` applies). Human replies still require exact-text
confirmation. Read `references/mutation-modes.md` and
`references/github-mutation-broker.md` before the first write.

## Preflight (read-only; stop on ambiguity)

1. Load PR metadata: number, title, author, state, base/head refs, draft state,
   linked issues, fork ownership, `maintainerCanModify`, and stack membership.
2. Confirm the author is genuinely unavailable: no response for a reasonable
   window, repo CONTRIBUTING/overtake policy exists, or the user explicitly
   says they are taking it over. If the author is active and responsive,
   **stop and report** — overtake is not for actively-maintained PRs.
3. Confirm the user is a maintainer with push rights to the target branch or a
   fork head they control (shared **PR ownership boundary** and **Fork head /
   push permission**). If the head is a fork the user cannot push to, the
   fork-head unwritable hard stop applies: ask the author to enable “Allow
   edits from maintainers” or recreate as a same-repo branch.
4. Run `scripts/ship-gate.mjs` with the active mutation mode. A blocked result
   names the blockers to fix; an unknown result forbids readiness claims.
5. **Stack rule:** if the PR is part of a stack, load
   `references/stacked-prs.md` first.

## Take over the branch (git safety)

1. Work in a clean worktree or a dedicated worktree under the repo’s worktree
   root (never a dirty unrelated tree). If the current worktree has unrelated
   uncommitted changes, **stop and ask** — do not stash/discard silently.
2. Fetch the PR head and create a local tracking branch. When the head is a
   fork and `maintainerCanModify` is false, the fork-head hard stop applies.
3. Push the takeover: after the first scoped fix commit, push to the PR head
   (same-repo branch when possible). Do not force-push, and never rewrite a
   shared/protected branch.
4. When the user’s overtake request includes “merge after fixing,” run
   `references/merge-pr.md` after the merge-ready bar.

## Fix + review (same bar as fix-pr-bots)

Run **`references/fix-pr-bots.md`** end-to-end once the branch is owned:

1. Update from base if needed (now allowed — the PR is effectively ours).
2. Compile/typecheck/test against current base tip.
3. Triage owners/maintainers first, then other humans, then bots. Patch + push
   actionable items; inline replies in-thread; human replies need exact-text
   confirmation.
4. Own bug + security + Spec/Standards reviews (shared rules). Fix necessary
   findings.
5. Required CI green on the current head; classify branch vs flake; fix or
   harden, rerun true infra only.
6. Adaptive settle, then merge-ready PR comment + linked-issue notify when
   ready. Do **not** merge unless the user asked.

## Close-with-reference alternative

When the overtaken PR cannot be finished (abandoned scope, superseded work,
author vanished and the change is no longer wanted), the maintainer may close
the PR with an explanatory comment instead. Use the broker `close_pr` /
`supersede_pr` action (never bare `gh pr close`) with a clear reason and a
reference to the replacement PR or issue when one exists. Linked issues stay
open unless the closing decision explicitly resolves them.

## Done when

- The PR is owned by the maintainer (pushed head, comments from the maintainer)
- The branch compiles/tests against current base tip
- Own bug + security + Spec/Standards reviews done; necessary findings fixed
- Required CI green on the current head (or a recorded hard blocker)
- Merge-ready posted (when the bar is met) or a close-with-reference completed
- Every visible write went through the broker with verified receipts

