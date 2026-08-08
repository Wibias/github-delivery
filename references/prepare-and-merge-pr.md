# Prepare and merge a PR

Use this workflow only when the user explicitly combines a merge request with work that must happen before the merge, such as full review, addressing review feedback, or safe simplification.

Read `references/shared-rules.md` first. The explicit merge request authorizes the final merge step only after every requested preparation phase has completed successfully; it does not waive any gate or authorize unrelated code changes.

## 1. Lock the target

Resolve the repository and one PR number. If the prompt refers to multiple distinct PR numbers and does not clearly assign the preparation and merge steps to the same PR, stop and ask which PR should be merged. Never apply preparation evidence from one PR to another.

Capture the starting PR head and base. All preparation workflows and the final merge must operate on the same PR, while normal head updates from authorized fixes/simplification become the new head that must be fully revalidated.

## 2. Run every requested preparation phase

Interpret only preparation actions explicitly present in the user request:

- **Full review requested:** run `references/full-review-pr.md`. Do not merge if its final verdict is `changes-requested`, `not-useful`, `gated`, incomplete, or otherwise non-approving.
- **Fix/address review feedback requested:** run `references/fix-pr-bots.md` through its merge-ready completion bar. Pushes are allowed only because this preparation action was explicitly requested and only within that workflow's ownership/scope rules.
- **Simplification requested:** run `references/simplify-pr.md`, including its bounded-candidate approval rules and mandatory complete post-simplification re-review. A no-op simplification is valid; a failed or non-approved re-review blocks merge.

If several phases were requested, run all of them. Do not treat one successful phase as a substitute for another.

## 3. Rebind evidence after mutations

After any preparation phase changes the branch:

1. capture the new PR head;
2. discard readiness evidence from the old head;
3. wait for required CI/reviews on the new head;
4. run the normal final settle/gate on that exact head.

If the base or head moves during final evidence capture, restart the final gate. Never carry a prior-head approval, check result, or merge-ready claim forward implicitly.

## 4. Merge only through the normal merge workflow

Only after all requested preparation phases have passed, enter `references/merge-pr.md` for the same PR.

The merge workflow remains authoritative for:

- draft/WIP/do-not-merge gates;
- current-base and current-head validation;
- required checks/reviews/threads;
- expected-head binding;
- merge method;
- linked-issue handling;
- post-merge verification and cleanup.

Any blocker found by the final merge workflow stops the merge. The phrase "merge it if it passes" never turns a failing preparation result into permission to merge anyway.

## Done

Report the preparation phases that actually ran, the final reviewed head SHA, the final gate result, and the merge result. If the merge did not happen, state the blocker rather than reporting the preparation work as equivalent to a merge.
