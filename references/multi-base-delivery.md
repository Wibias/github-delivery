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
- stacks (when actual stack topology is detected)
<!-- policy-modules:end -->

# Multi-base delivery

**Trigger:** “backport PR #42 to release/1.x”, “port PR #42 to release/1.x and release/2.x”, or equivalent requests to carry one verified source change to one or more other base branches.

## Goal

Create and track one independent port per requested target base without confusing parallel ports with stacked PR topology.

A port is derived from one exact source PR head. Each target gets its own branch and pull request against that target base. A successful port to one base does not imply success on another base.

## Authority boundary

Porting authority permits only the requested implementation/publication work. It does not automatically grant merge authority for the source PR or any port PR.

If the user explicitly requests the port PRs to be merged, each merge still uses the normal `references/merge-pr.md` current-head gates. A release/backport label, source-PR merge, tracker state, or provenance marker never substitutes for merge authority.

## Planning

1. Resolve the canonical repository and source PR.
2. Re-read the source PR and pin its exact current `headRefOid` before planning. Do not plan from a remembered SHA.
3. Resolve the requested target bases exactly. Reject the source base as a target.
4. Run `planMultiBaseDelivery(...)` to create one independent `parallel-port` entry for each target.
5. Treat all requested targets as required unless the user or repository policy explicitly marks some as optional.
6. Preserve the generated provenance marker in each port PR body. The marker binds repository, source PR, source head SHA, and target base.

## Applying a port

For each target independently:

1. Create/reset only the dedicated generated port branch for that target.
2. Apply the source change onto the target base using the repository-appropriate port/backport mechanism. Resolve conflicts semantically; do not blindly choose source or target versions.
3. Run target-base-appropriate local verification.
4. Publish the branch through the normal `push_code` broker path.
5. Reuse the P0 exact duplicate/idempotency preflight before `create_pr`.
6. Create the PR against the exact target base and include the provenance marker in the body.
7. Run the normal review/status workflow for that port PR.

Ports are independent. Do not make the `release/2.x` port PR target the `release/1.x` port branch merely because both came from the same source. That would create a stack and change merge semantics.

## Verification and completion

Use `summarizeMultiBaseDelivery(...)` against live port PR evidence.

A port is recognized only when:

- its target base matches exactly; and
- its body contains the exact provenance marker for the pinned source head and target base.

Multiple matching PRs for one target are an ambiguity/error, not a reason to pick the newest one.

Overall delivery is `complete` only when every required target is verified merged. Otherwise report the exact required targets that remain `missing` or `open`.

If the source PR merges but required ports remain incomplete, do not mark the associated work item or delivery request fully done.

## Failure rules

Fail closed when:

- source repository/PR/head identity is incomplete;
- the source head changes before the port plan is applied;
- a target base is invalid or missing;
- duplicate port PRs exist for one provenance identity;
- a port PR targets the wrong base;
- provenance is missing/stale;
- target verification fails;
- required port state cannot be read authoritatively.

Report partial success per target. Do not hide a failed target behind successful sibling ports.

## Provenance

The multi-target delivery idea was informed by `OutThisLife/brooklyn-skills` delivery patterns (MIT, copyright Brooklyn Nicholson). GitHub Delivery implements ports as head-bound, independently gated PRs and deliberately keeps them distinct from stacked-PR topology.
