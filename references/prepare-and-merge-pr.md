<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- evidence
- git
- ci
- reviews
- publication
- releases
- issues
- stacks (when stack topology is detected)
<!-- policy-modules:end -->

# Prepare and merge a PR

Use this workflow only when the user explicitly combines a merge request with work that must happen before the merge, such as review, full review, addressing review feedback, or safe simplification.

Load only the policy modules declared above. The explicit merge request authorizes the final merge step only after every requested preparation phase has completed successfully; it does not waive any gate or authorize unrelated code changes.

## 1. Lock the target

Resolve the repository and one PR number. If the prompt refers to multiple distinct PR numbers and does not clearly assign the preparation and merge steps to the same PR, stop and ask which PR should be merged. Never apply preparation evidence from one PR to another.

Capture the starting PR head and base. All preparation workflows and the final merge must operate on the same PR, while normal head updates from authorized fixes/simplification become the new head that must be fully revalidated.

## 2. Run every requested preparation phase

Interpret review/fix/merge actions explicitly present in the user request. **No-comments and simplify are default-on** for this composed path, but resolve their opt-outs independently. A no-comments opt-out (`skip no-comments`, `without no-comments`, `keep source comments`, `don't strip comments`) skips only no-comments. A simplify opt-out (`without simplify`, `skip simplify`, `don't simplify`) skips only simplify.

- **Review requested:** run `references/full-review-pr.md`. Generic review wording and focused review wording such as security review still enter the complete merge-preparation review bar, because the final merge requires current Bug + Security + Spec/Standards evidence on the same head. Do not silently drop a requested review phase merely because the request also asks to merge. Full review already composes `references/no-comments.md` and `references/simplify-pr.md` using the independent opt-outs above.
- **Fix/address review feedback requested:** run `references/fix-pr-bots.md` through its merge-ready completion bar. Pushes are allowed only because this preparation action was explicitly requested and only within that workflow's ownership/scope rules. That workflow also composes no-comments and simplify using the independent opt-outs above.
- **Simplification-only requested:** run `references/no-comments.md` unless no-comments is specifically opted out, then run `references/simplify-pr.md` unless simplify is specifically opted out. Include contract-card apply rules and mandatory complete post-simplification re-review. A no-op simplification is valid; a failed no-comments pass or failed re-review blocks merge.

If several phases were requested, run all of them. Do not treat one successful phase as a substitute for another. Do not double-run hygiene when a composed review or fix-pr-bots pass already ran it for this head.

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
