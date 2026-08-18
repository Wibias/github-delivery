<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- evidence
- reviews
- publication
<!-- policy-modules:end -->

# Consolidate competing PRs

**Trigger:** “triage competing PRs”, “find overlapping PR implementations”, “which PRs duplicate each other?”, “consolidate these PRs”, or equivalent requests to identify competing implementations.

## Goal

Identify PRs that may represent competing implementations without guessing a canonical winner or closing anything during analysis.

This workflow is read-only. If the user later selects a canonical PR and authorizes superseding the others, delegate each network-visible change to `references/supersede-pr.md` and its existing mutation gates.

## Evidence

Collect complete PR identity and changed-file evidence for the requested repository/scope. Use `scripts/lib/pr-consolidation.mjs` to form candidate clusters.

High-confidence competing-implementation evidence:

- the same durable work-item identity plus substantial overlap of non-noise changed files on PRs targeting the same repository and base.

Medium-confidence candidate evidence:

- the same durable work-item identity without substantial implementation overlap; or
- substantial overlap of non-noise changed files on PRs targeting the same repository and base.

A shared work-item key alone means the PRs are related. It does not prove one replaces the other. One ticket may intentionally ship through multiple complementary PRs.

Do not treat shared README/lockfile/changelog changes alone as competing implementation evidence. Do not cluster across different bases; those may be legitimate ports/backports.

Title similarity, author identity, branch-name similarity, and AI-generated semantic guesses are leads only. They are not sufficient to close or supersede a PR.

## Canonical selection

The analyser deliberately returns `canonicalPr: null` and `selectionRequired: true` for every candidate cluster.

A consolidation plan is valid only when:

1. the cluster was proven by the current analysis;
2. the canonical PR is explicitly selected and belongs to that cluster;
3. every PR proposed for supersede has direct substantial implementation-overlap evidence with the selected canonical PR;
4. current live PR identity still matches the analysed repository/base/head evidence.

A transitive A-B-C cluster is not enough to let A supersede C when A and C lack direct supersede-grade evidence.

The plan may then identify the other PRs as candidates for `delegate_supersede_pr`. It does not perform those mutations itself.

## Failure rules

Fail closed when PR enumeration is incomplete, repository/base identity is missing, the requested cluster is not present in the current analysis, canonical selection is absent/invalid, or direct supersede-grade evidence is missing for any proposed replacement.

Do not infer that a PR is obsolete merely because another PR is newer, greener, authored by a maintainer, shares a tracker item, or has more reviews.

## Output

Report candidate clusters with:

- PR numbers and links;
- confidence (`high` or `medium`);
- exact evidence that connected each pair;
- whether an edge is strong enough for supersede planning;
- `canonical: not selected` until the user or an already-authorized workflow provides one.

## Provenance

The clustering concept was informed by `OutThisLife/brooklyn-skills` `pr-triage` (MIT, copyright Brooklyn Nicholson). GitHub Delivery keeps analysis separate from its existing supersede mutation workflow and uses deterministic repository/base/work-item/file evidence rather than copying Brooklyn's workflow text.
