# Runtime evidence contract

Use runtime evidence when QA intake, issue triage/research, debugging, or review makes a claim about what the software actually does when executed.

The machine contract lives in `scripts/lib/runtime-evidence.mjs`.

## Evidence session

Bind runtime evidence to:

- exact repository;
- exact commit SHA;
- target symptom/behavior;
- relevant environment/fixture/runtime details.

Do not silently reuse runtime evidence after the relevant commit or environment changes.

## Attempt statuses

- `reproduced` — the observed actual behavior differs from the stated expected behavior in the reported way, with concrete evidence.
- `not-reproduced` — this controlled attempt did not exhibit the reported failure. This is **not** equivalent to fixed.
- `blocked` — the intended attempt could not be performed; record the exact blocker and evidence.
- `inconclusive` — the attempt ran but cannot distinguish the hypotheses; record why.

Every attempt requires a concrete evidence reference such as a test, trace, log, response body, measurement set, screenshot/artifact reference, or exact observable command result. `reproduced` and `not-reproduced` also require explicit expected and actual observations.

## Strong runtime workflow

1. Restate the observable symptom separately from the reporter's root-cause theory.
2. Capture the exact head/environment.
3. Use the smallest realistic trigger that can distinguish correct from incorrect behavior.
4. Capture expected vs actual output, not only status codes or exit codes when the body/state matters.
5. Repeat timing/race/performance claims enough times to distinguish signal from noise.
6. Preserve the evidence artifact/reference.
7. Summarize as reproduced, not-reproduced, partial/blocked, or no-attempts.
8. If a fix is later applied, rerun a regression/reproduction check on the fixed head. A prior `not-reproduced` result cannot by itself prove the issue was fixed.

## QA intake

Do not force runtime reproduction when the user already supplied enough concrete evidence to file a useful issue or the environment is unavailable. When reproduction is feasible, use it to reduce reporter interrogation and to distinguish symptoms from assumptions.

Issue text should state whether the problem was:

- reproduced on an exact head/environment;
- not reproduced in the attempted environment;
- not attempted;
- blocked/inconclusive and why.

## Issue research

For “is this still broken on latest development?” research, prefer runtime evidence on the latest development tip when feasible. A code search that looks fixed is weaker than an executable regression/reproduction check when one is practical.

Never turn “I could not reproduce it” into “Already fixed/shipped” without separate code/history/fix evidence. The research verdict must expose that gap.
