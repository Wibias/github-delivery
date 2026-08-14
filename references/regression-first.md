# Regression-first bug fixes

Use this companion when an authorized `github-delivery` workflow fixes a confirmed bug.

The goal is not "tests at any cost". The goal is executable evidence that the broken behavior existed before the fix and no longer exists after it.

## Decision rule

Before editing production code, choose the narrowest useful regression check already available for the affected path and apply `references/verification-boundaries.md` to decide where that check should observe behavior.

Prefer the **narrowest stable boundary that directly demonstrates the defect**, not a fixed test-level hierarchy. Depending on the bug, that can be:

1. a focused unit/component test when that unit's own observable contract is what broke;
2. an existing use-case/integration/regression test that survives internal restructuring;
3. a small script or command that calls the real production path;
4. a deterministic runtime reproduction, operator smoke, snapshot, or log assertion when only that boundary can distinguish the failure.

If a focused test is cheap, natural, and observes the real protected contract, write it first and run it before the production change. It must fail for the bug being fixed, not because the test is malformed or the harness is broken.

Do not build a broad harness, add brittle mocks, churn unrelated fixtures, or create a slow end-to-end environment only to claim TDD compliance. A bad regression test is worse than an honest executable check. Likewise, do not prefer a trivial helper-level test merely because it is cheap when it could stay green while the real use case remains broken.

## Required flow

1. Record the intended behavior and the smallest observable failure.
2. Select the closest executable check and record the stable boundary/observable it protects.
3. Run the check before the fix.
   - For a new test, record the expected failing result.
   - For an existing repro or script, record the failing behavior it demonstrates.
4. Implement the smallest root-cause fix in the authorized scope.
5. Run the same check after the fix and record the passing result.
6. Run nearby validation required by the changed code and the governing workflow.

## When a failing-before test is impractical

Do not silently skip the regression step. State why a new failing test would be low-signal or disproportionate, then use the closest executable check that can distinguish broken from fixed behavior.

Valid reasons can include:

- the only test path requires large unrelated harness work;
- the bug depends on production-only or external state that cannot be reproduced locally;
- existing tests would need brittle timing or heavy mock behavior to express the failure;
- the smallest useful evidence is a real CLI, service, browser, or integration probe.

"No time" and "the fix looks obvious" are not evidence.

## High and critical fixes

Every fixed High or Critical finding needs regression evidence. Prefer a durable automated test when a practical stable boundary exists. If no durable test is practical, record the reason and the exact executable check used instead.

Do not invent arbitrary test-count targets from cyclomatic complexity. Coverage should follow the behavior partitions and failure paths that matter for the bug. One focused test can be enough for one invariant; a shared or multi-variant bug can require several tests.

## Guardrails

- Do not weaken an existing assertion to make the fix pass unless the expected behavior genuinely changed and the contract supports that change.
- Do not write a test that mirrors implementation details instead of observable behavior.
- Do not preserve private helper decomposition, internal call choreography, or incidental object shape unless it is independently part of the contract.
- Prefer real code through the selected stable boundary; when an external dependency must be substituted, keep the fake/mock at an actual integration seam and state what production path remains unexercised.
- Do not broaden the fix merely because nearby coverage is weak.
- Do not call a fix verified when the before state was never demonstrated and no equivalent regression check was run.
- If the bug is flaky, make the check deterministic where practical and name the signal that the check locks down.

## Evidence to report

For each fixed bug, record:

- failing-before test or executable check;
- the stable boundary and observable behavior it protects;
- the failure or wrong behavior it demonstrated;
- passing-after result on the fixed head;
- nearby validation that also ran;
- when no new automated test was added, the specific reason and substitute check.

## Provenance

This reference adapts the practical test-selection ideas from Cursor's `pstack` `tdd` skill. `pstack` is MIT licensed, copyright 2026 Lauren Tan. Stable-boundary selection is specified separately in `references/verification-boundaries.md`, which also adapts relevant use-case testing ideas from Hona's publicly shared engineering-design gist. The workflow here is rewritten to fit `github-delivery`'s root-cause, evidence, and publication contracts.
