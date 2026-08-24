# Completion claim evidence

Use this companion before publishing a final verdict, merge-ready statement, migration-complete statement, review coverage statement, or other durable completion report authored by `github-delivery`.

## Goal

A completion report is a set of evidence-backed claims, not a recap written from memory. Reuse the workflow's existing authoritative evidence and freshness model. Do **not** create a second completion state machine or parallel gate ledger.

## Claim classes

Treat these claims as evidence-bearing:

- **state claims** such as green, ready, merged, fixed, clean, blocked, unknown, or not run;
- **counts** such as files reviewed, findings, unresolved threads, checks, migrated callers, residual matches, changed files, or issues handled;
- **coverage claims** such as every file read, every required probe resolved, all requested issues handled, or all callers migrated;
- **head-bound claims** about a PR, branch, diff, review, test result, or CI state tied to an exact SHA;
- **timing/rate claims** based on measured samples;
- **absence claims** such as no residual callers, no unresolved reviews, no findings, or no remaining compatibility path.

Ordinary explanatory prose that does not assert completion or a measurable state does not need its own claim record.

## Evidence rule

Before publishing a material claim, identify the authoritative source that proves it. Prefer existing structured evidence from the governing workflow: ship-gate output, review coverage, probe evidence, CI/check state, current PR metadata, issue/PR snapshots, migration residual searches, test output, or an exact command result.

A claim is not established by:

- a previous assistant summary;
- an unchecked plan item;
- a stale earlier snapshot after the head or relevant remote state changed;
- a remembered number;
- a command that could not distinguish success from failure;
- omitted output interpreted as success.

If authoritative evidence is unavailable, preserve the state as `unknown`, `not run`, `blocked`, or `partial` as appropriate.

## Numbers rule

Every numeric claim that matters enough to publish must come from a measured source at report time or from an unchanged authoritative snapshot whose count is itself part of the recorded result.

Do not recount from memory or infer a number from prose.

Examples:

- `12 files reviewed` must come from the current coverage inventory, not the reviewer's recollection.
- `0 unresolved threads` must come from the current review-thread snapshot.
- `8/8 checks passed` must come from the relevant check result.
- `0 residual callers` must come from the final residual search after the last migration edit.

When the exact number is not material, prefer a qualitative claim that the evidence actually supports instead of manufacturing precision.

## Freshness rule

Bind evidence to the state it proves.

- A new PR head invalidates head-bound review, test, and diff claims unless the governing workflow explicitly marks the evidence reusable.
- A new review/comment/check event invalidates an earlier "none pending" claim when that surface is volatile.
- A state-changing migration edit invalidates earlier residual-search counts.
- A new base tip can invalidate base-synchronization or compatibility claims.

Use the workflow's existing freshness and generation rules. This companion does not invent an independent timeout when the owning workflow already has one.

## Coverage and absence claims

Positive absence claims require complete enough coverage to observe the thing claimed absent. Before claiming `no residual X`, run a search that matches a known present hit; a query that never produced a positive control is not evidence of absence.

Do not say:

- `no bugs found` when source coverage is partial;
- `all callers migrated` when only one naming form was searched and aliases/serialization remain plausible;
- `no review blockers` when unresolved-thread or review-state evidence is missing;
- `CI green` when required checks are unknown or still pending.

State the bounded truth instead: `partial coverage`, `no findings in reviewed files`, `residual search clean for <forms>`, or the relevant unknown/blocker.

## Final report check

Immediately before publication:

1. enumerate the material completion claims the report will make;
2. map each to its authoritative evidence source;
3. refresh volatile/head-bound sources required by the governing workflow;
4. re-measure every material number not already carried by an unchanged authoritative result;
5. downgrade any unsupported claim to the honest evidence state;
6. publish the report without silently dropping blockers, abandoned scope, partial coverage, or unavailable checks.

The report does not need to expose an internal claim ledger unless another workflow/template requires it. It does need to remain auditable from the cited or recorded evidence.

## Relationship to other contracts

- `references/prose-quality.md` controls clarity and evidence-preserving wording. This file controls whether the completion claims themselves are established.
- `references/policy/publication.md` makes this check binding for durable GitHub completion prose.
- `references/agent-progress-watchdog.md` prevents premature workflow convergence; this file prevents a final report from overstating what convergence proved.
- `references/safety-invariant.md` remains the stronger proof path for material non-local safety claims.

## Provenance

This companion adapts the evidence-ledger and report-audit ideas from Leonxlnx's MIT-licensed `unlazy` v2, especially machine-checkable outcomes and re-measuring published numbers. GitHub Delivery reuses its existing workflow controller, evidence stores, freshness rules, and ship gates instead of importing a second `GATES.md` state machine or Depth Tree.
