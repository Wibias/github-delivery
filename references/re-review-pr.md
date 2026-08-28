<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- evidence
- ci
- reviews
- publication
- stacks (when stack topology is detected)
<!-- policy-modules:end -->

# Re-review PR

**Trigger:** “re-review pr #N based on my review comment + his commits + new rabbit & Codex…”

## Goal

Re-evaluate the PR from the user’s review comment(s), the author’s subsequent commits, and new CodeRabbit/Codex comments. Fix what can/should be fixed in this PR. Request changes on GitHub when real issues remain. No follow-up PRs for fixable items. Skip 0.1% nits.

If the user also wants **merge-ready**, continue into `fix-pr-bots` after re-review (own bug+security+spec, tip compile, merge-ready comments) — do not stop at a soft “looks good” without that bar.

## Hygiene passes

Resolve the two passes independently:

1. Run `references/no-comments.md` before bug/security/spec work unless no-comments is specifically opted out (`skip no-comments`, `without no-comments`, `keep source comments`, `don't strip comments`). A failed pass blocks completion.
2. After correctness work, run `references/simplify-pr.md` unless simplify is specifically opted out (`without simplify`, `skip simplify`, `don't simplify`). Nothing worth simplifying is valid.
3. A no-comments opt-out skips only no-comments. A simplify opt-out skips only simplify.
4. If either pass changed the head, re-validate with both passes disabled.
5. Name skipped passes in the verdict or publication text.

## Steps

1. Load PR `#N` (bare `#N` → shared resolve): description, user/owner/maintainer review comments, other human reviews, new commits since that review, unresolved bot comments. Note draft/WIP gates and behind-base/conflicts.
2. Diff the new commits against the concerns raised.
3. Triage **humans first (owners/maintainers priority), then bots** (shared rules): fix useful; skip nits with rationale. Inline replies in-thread.
4. If behind/conflicted: update from base before pushing further fixes — only when the PR is ours (shared **PR ownership boundary**); otherwise tell the owner to update from the latest base and do not push the base sync. Compile-against-tip.
5. If changes are needed and you can fix them here: implement, push, wait and recheck until stable or a hard blocker (shared rules — no early exit on round/time caps).
6. If real necessary issues remain that you cannot or should not silently rewrite: submit a GitHub **changes requested** review (`gh pr review`) with concrete blockers only.
7. Do not auto-reply on human threads without exact-text confirmation (shared social policy).
8. Security-offer + changelog nudge when applicable.
9. If the user asked merge-ready / “then make it ready”: continue with `fix-pr-bots` (full own reviews + evidence sweep).
10. Else if clean enough for a re-review-only ask: post a **detailed** review comment using the **Verdict** template in `references/comment-depth.md` (or a condensed version that still covers concerns vs new commits with paths/SHAs). Approve only if asked. Do **not** post `[GD] Merge ready` unless the full merge-ready bar was completed.

## Done when

- Human + bot concerns re-checked against latest commits
- Fixable issues landed in this PR (or explicitly declined)
- Changes requested only for real remaining blockers
- No drive-by follow-up PR created for in-scope fixes
- If merge-ready was requested: `fix-pr-bots` done-when also satisfied
