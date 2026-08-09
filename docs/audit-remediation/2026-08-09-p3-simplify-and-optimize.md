# P3 Audit Remediation: Simplification and Context Efficiency

Baseline audit: `d5137472eafb660c18306d28484f6850aeab6ac4` on 2026-08-09.

This branch owns cleanup and optimisation only after safety/correctness guarantees are explicit. Token savings must never weaken authority, freshness, evidence, or GitHub semantic checks.

## Scope

### 1. Generate mutation-policy documentation from one declarative action registry

Required outcome:

- Define a single machine-readable registry for mutation action semantics where practical.
- Model fields such as:
  - network-visible write status;
  - minimum mutation mode;
  - trusted-grant requirement;
  - resource/head binding;
  - idempotency policy;
  - postcondition verification policy;
  - social visibility;
  - merge-eligibility effect.
- Generate or validate Node policy tables, authority-scope expectations, documentation tables, and contract tests from the same source where safe.
- Keep security-sensitive execution code explicit; do not replace reviewable checks with opaque generation.

Acceptance criteria:

- Adding a new mutation action without required policy metadata fails validation.
- Documentation cannot silently disagree with the action registry.
- Existing action semantics remain equivalent or stricter.

### 2. Reduce first-session full-review reference loading

Required outcome:

- Make generated review briefs/probe blocks the primary context for a normal review.
- Load full `bug-review.md`, `security-review.md`, `spec-standards-review.md`, and related large references only when a triggered lens requires additional detail.
- Preserve every mandatory lens/probe through deterministic coverage validation.

Acceptance criteria:

- Review-brief output proves which mandatory lenses/probes are included.
- A missing mandatory probe makes validation fail.
- Representative full-review context is materially smaller without changing final review requirements.
- Final head/review/check/rules freshness reads are never removed as a token optimisation.

### 3. Replace historical examples with tested invariants where possible

Required outcome:

- Identify PR/incident-specific prose whose general lesson is already encoded in deterministic code/tests.
- Keep concise rationale when it materially helps operators.
- Move archival detail out of always-read workflow bodies rather than deleting useful institutional memory.

Acceptance criteria:

- Each removed historical example maps to a named invariant/test or an archived reference.
- No required failure class loses executable coverage.
- Root/workflow routing remains understandable without incident archaeology.

### 4. Use compact generated probe/lens digests as primary model context

Required outcome:

- Produce compact, deterministic digests for the exact review surfaces triggered by a diff.
- Include stable identifiers, required actions, evidence expectations, and fail/NA rules.
- Keep the full reference as the source of truth and provide a deterministic way to verify digest completeness.

Acceptance criteria:

- Digest generation is deterministic for the same inputs.
- A malformed/incomplete digest cannot silently mark a mandatory lens as covered.
- Full reference loading remains available for escalation.
- Context reduction is measured on representative review fixtures and reported in tests/benchmarks or a reproducible script.

## Guardrails

Do not optimise away:

- final PR-head recapture;
- base/rules generation checks;
- required-check refresh;
- review-thread freshness;
- authority verification;
- mutation postcondition verification;
- fail-closed handling of unknown evidence.

## Validation required before ready-for-review

- Authoritative validation suite passes.
- Behavioural contract tests demonstrate no weakening of safety policy.
- Context-size measurements are reproducible.
- Documentation and generated policy artifacts are checked for drift in CI.
