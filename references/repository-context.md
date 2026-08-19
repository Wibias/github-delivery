# Remote Repository Context

Use this companion when a GitHub Delivery workflow needs repository context but a useful local checkout is not already available. It is a read-only evidence-acquisition path, not a public lifecycle route and not mutation authority.

## Goal

Get enough repository context quickly without cloning by default, while preserving the evidence guarantees required by `references/policy/evidence.md`.

## Snapshot contract

1. Resolve repository identity from the provided `owner/repo` or GitHub URL.
2. Query repository metadata and resolve the repository's actual default branch.
3. Use the default branch unless the governing workflow selects another branch. Capture its exact commit SHA before substantive file reads.
4. Read README, `SKILL.md`, docs, or targeted source files against that exact SHA.
5. Record the repository, resolved branch, exact SHA, paths read, and any gaps that remain.

Do not guess `main`, `master`, or `HEAD`. A moving branch name may be used only to resolve the snapshot SHA; evidence used for a substantive decision must then stay bound to that SHA until the workflow intentionally refreshes it.

`scripts/repository-context.mjs` provides the deterministic `gh` path for repository identity, default-branch resolution, optional workflow-selected branch pinning, SHA capture, and exact-SHA file reads. A host-native GitHub connector may provide the same evidence when it exposes equivalent repository metadata and ref-pinned file reads.

## Acquisition ladder

Use the cheapest complete source first:

1. repository metadata and exact default-branch SHA;
2. README / `SKILL.md` / relevant docs at the captured SHA;
3. targeted repository code search and exact-SHA file reads;
4. local fetch or clone only when the task requires history, runtime execution, exhaustive repository search, modification, or another capability that lightweight remote reads cannot prove.

Semantic documentation search services such as gitmcp may be used as an optional adapter for discovery. They are never required and are never the sole authority for exhaustive or safety-sensitive claims.

## Evidence limits

Lightweight remote inspection does not prove an exhaustive codebase review. Search results are leads unless the selected workflow's required scope is demonstrably covered. Missing, truncated, stale, or unreadable evidence remains `unknown` under `GD-EVID-*`.

Escalate to a checkout when any of these is material:

- commit or blame history beyond the captured snapshot;
- runtime reproduction, tests, build, or generated output;
- exhaustive repository-wide analysis that remote search cannot prove complete;
- implementation, refactoring, conflict resolution, or any local modification;
- evidence whose completeness cannot be established through the available GitHub API or connector.

## Refresh rule

A snapshot stays reusable while its exact SHA and the relevant external inputs remain unchanged. Re-resolve only when the workflow intentionally asks for a newer repository state or new evidence shows the snapshot can no longer support the claim. Do not repeatedly refresh a stable snapshot merely because more files are discovered during the same analysis.

## Output

When this companion materially affects a workflow decision, preserve a compact record:

```text
Repository: owner/repo
Branch:     resolved-snapshot-branch
Snapshot:   exact-commit-sha
Read:       README.md, docs/..., src/...
Search:     targeted queries used, if any
Gaps:       none | exact unverified scope
Escalated:  no | why a checkout became necessary
```
