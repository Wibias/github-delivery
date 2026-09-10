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

## Delta-first execution

A re-review is not a fresh full review. Start from the last human review boundary and inspect only:

1. the concerns raised by owners/maintainers and useful bot findings at that boundary;
2. commits after that boundary and the files/symbols they touch;
3. new or changed review threads and bot summaries since that boundary;
4. current head/base/CI and any evidence invalidated by the new commits.

Do not repeat specialist-owned analysis or re-read unchanged full-review evidence unless the new delta can affect that axis. Reuse current-session evidence only when it is bound to the same repository and head. Historical conclusions may be used as comparison evidence, never as an independent reviewer result.

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
10. Else if clean enough for a re-review-only ask: prepare a **detailed** review verdict using the **Verdict** template in `references/comment-depth.md` (or a condensed version that still covers concerns vs new commits with paths/SHAs). Approve only if asked. Do **not** post `[GD] Merge ready` unless the full merge-ready bar was completed.
11. If verdict publication is authorized, run `planVerdictPublication` first. After a new or reused format-valid `[GD] Verdict`, run `planNativeReviewSidecar` with the exact verdict label, current reviews, authenticated viewer, author, repository, PR, expected head, and routed mutation mode. Execute every authorized broker operation through `github-mutate.mjs`.
12. For `approve-comment` and `changes-requested`, execute all planned `dismiss_review` operations before considering the re-review complete. Re-fetch the PR reviews after the broker operations and prove the owned superseded `CHANGES_REQUESTED` reviews are `DISMISSED` or absent from the pending set.
13. Refresh the authoritative ship gate after those review-state mutations. For `approve-comment`, re-run `ship-gate.mjs` on the exact reviewed head. An `approve-comment` **must not complete** while that refreshed gate is `blocked` or `unknown`. If a blocker remains, change the verdict to `gated` or `changes-requested` as supported by the evidence and publish/repair consistently. Never report `Gate: none` while the authoritative gate is blocked.

### Native review postcondition

The native review sidecar is part of the authorized verdict transaction, not optional cleanup. A successful verdict comment alone is insufficient evidence of completion.

For an authorized `approve-comment`:

- plan and execute owned `dismiss_review` operations;
- refresh reviews and verify the stale Request changes are gone;
- refresh the exact-head ship gate;
- only then accept `approve-comment` as complete.

If any of these postconditions fail, the run remains incomplete and must report the concrete blocker. Never claim that a later GitHub Approve is required merely to clear this workflow's own superseded Request changes when the routed request already authorizes the native-review dismissal.

## Done when

- Human + bot concerns re-checked against latest commits
- Fixable issues landed in this PR (or explicitly declined)
- Changes requested only for real remaining blockers
- No drive-by follow-up PR created for in-scope fixes
- Authorized verdict publication has completed its native-review sidecar and exact-head postconditions
- `approve-comment` has a refreshed authoritative ship gate that is not blocked or unknown
- If merge-ready was requested: `fix-pr-bots` done-when also satisfied
