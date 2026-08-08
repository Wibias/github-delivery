<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- issues
- evidence
<!-- policy-modules:end -->

# Agent brief

Use this contract for every issue that is or becomes `ready-for-agent`.

## Required outcome

State the concrete user/developer outcome and the repository surface that must change. The brief is implementation guidance, not a substitute for the issue conversation; apply GD-ISSUE-002 before finalizing it.

## Scope

- In scope: enumerate the behaviors/contracts this issue owns.
- Out of scope: name adjacent work the agent must not silently absorb.
- Dependencies: list prerequisite issues/PRs, external systems, migrations, or decisions.
- AFK/HITL: mark whether the issue can be completed without user interaction. Use HITL only for a genuine product, credential, policy, or external decision.

## Acceptance criteria

Write testable criteria that distinguish completion from partial progress. Include negative/edge behavior when it is part of the contract. Avoid vague criteria such as “works correctly” or “clean up the code.”

## Verification

Name the repository's expected focused tests/checks and any operator smoke needed to prove the outcome. Unknown or unavailable verification must be surfaced under GD-EVID-001 rather than silently treated as pass.

## Implementation notes

Carry forward authoritative maintainer clarifications, repro details, and constraints from the complete issue thread. Keep suggestions non-binding unless the issue actually requires a specific architecture.

## Handoff format

A ready brief should be understandable without private chat context and should include:

- outcome
- in-scope / out-of-scope
- acceptance criteria
- dependencies
- AFK/HITL boundary
- verification
- material implementation constraints

After publishing/updating the brief, read the issue back and report its URL/state under GD-ISSUE-005.
