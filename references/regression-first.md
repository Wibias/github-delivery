# Regression-first bug fixes

Use this companion when an authorized `github-delivery` workflow fixes a confirmed bug.

The goal is not "tests at any cost". The goal is executable evidence that the broken behavior existed before the fix and no longer exists after it.

## Decision rule

Before editing production code, choose the narrowest useful regression check already available for the affected path.

Prefer, in order:

1. a focused unit or component test;
2. an existing integration or regression test path;
3. a small script or command that calls the real code;
4. a deterministic runtime reproduction, operator smoke, snapshot, or log assertion.

If a focused test is cheap and natural, write it first and run it before the production change. It must fail for the bug being fixed, not because the test is malformed or the harness is broken.

Do not build a broad harness, add brittle mocks, churn unrelated fixtures, or create a slow end-to-end environment only to claim TDD compliance. A bad regression test is worse than an honest executable check.

## Required flow

1. Record the intended behavior and the smallest observable failure.
2. Select the closest executable check.
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

Every fixed High or Critical finding needs regression evidence. Prefer a durable automated test when a practical path exists. If no durable test is practical, record the reason and the exact executable check used instead.

Do not invent arbitrary test-count targets from cyclomatic complexity. Coverage should follow the behavior partitions and failure paths that matter for the bug. One focused test can be enough for one invariant; a shared or multi-variant bug can require several tests.

## Guardrails

- Do not weaken an existing assertion to make the fix pass unless the expected behavior genuinely changed and the contract supports that change.
- Do not write a test that mirrors implementation details instead of observable behavior.
- Do not broaden the fix merely because nearby coverage is weak.
- Do not call a fix verified when the before state was never demonstrated and no equivalent regression check was run.
- If the bug is flaky, make the check deterministic where practical and name the signal that the check locks down.

## Evidence to report

For each fixed bug, record:

- failing-before test or executable check;
- the failure or wrong behavior it demonstrated;
- passing-after result on the fixed head;
- nearby validation that also ran;
- when no new automated test was added, the specific reason and substitute check.

## Provenance

This reference adapts the practical test-selection ideas from Cursor's `pstack` `tdd` skill. `pstack` is MIT licensed, copyright 2026 Lauren Tan. The workflow here is rewritten to fit `github-delivery`'s root-cause, evidence, and publication contracts.
