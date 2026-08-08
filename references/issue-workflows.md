<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- issues
- evidence
<!-- policy-modules:end -->

# Issue workflows

## PRD Workflow

Use when the user wants a PRD from conversation, repository context, or an idea.

1. Research current repository behavior before publishing; do not over-interview when the conversation already resolves the important decisions.
2. Search for obvious duplicates and adjacent plans/issues.
3. Draft an implementation-oriented PRD with problem, goals/non-goals, user-visible outcome, constraints, acceptance criteria, dependencies, risks, and verification.
4. If the user asked to publish, use the active mutation profile and brokered GitHub write path. Read back the result and report the issue URL.

## Issue Breakdown

Use when breaking a PRD, plan, spec, or clear request into implementation issues.

1. Preserve dependency order and shared contracts from the source.
2. Split work into independently verifiable vertical slices rather than file-layer chores.
3. Mark each slice `AFK` or `HITL`; reserve HITL for genuine product/credential/external decisions.
4. Include acceptance criteria, dependencies, scope boundaries, and verification for every slice.
5. Present the breakdown before publication unless the user explicitly requested direct creation.
6. Search duplicates before publishing. After each write, read back the issue and report its URL.
7. When a slice is `ready-for-agent`, compose `references/agent-brief.md` and satisfy GD-ISSUE-004.

## Triage Workflow

Use when the user asks to triage issues, labels, state, readiness, or rejection.

1. Read the complete issue conversation under GD-ISSUE-002.
2. Classify current state, reproducibility/clarity, priority, dependencies, duplicates, and whether the issue is actionable.
3. Apply labels/state/assignment only within the authorized publication scope.
4. For `ready-for-agent`, compose `references/agent-brief.md`.
5. For a confirmed rejected enhancement, compose `references/out-of-scope.md`; rejection requires explicit maintainer confirmation under GD-ISSUE-006.
6. Read back every mutation and report the final URL/state.

## QA Intake

Use for conversational bug intake or filing a reproducible bug report.

1. Capture observed vs expected behavior, environment/version, minimal reproduction, frequency, impact, logs/screenshots, and known workarounds.
2. Distinguish confirmed facts from hypotheses. Do not invent reproduction details.
3. Search for duplicate reports.
4. Publish only when authorized, then read back the issue and report its URL.

## Refactor Plan

Use when the user wants a refactor request/RFC or a verified tiny-commit plan.

1. Research current architecture and tests before proposing a structural change.
2. State the concrete pain, invariant behavior, target boundary, non-goals, migration/rollback strategy, and verification.
3. Prefer small reviewable steps with explicit dependencies; do not smuggle feature changes into a refactor plan.
4. Publish through the normal issue mutation boundary only when requested; read back and report the URL.
