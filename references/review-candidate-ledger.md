# Review candidate and evidence ledger

Use this contract to make bug/security discovery, validation, and arbitration durable machine state instead of a sequence of untracked prose conclusions.

## Purpose

Every reviewer, scanner, bot, runtime reproduction, and external model is a **candidate producer**. None is authoritative merely because it emitted a finding.

The ledger binds candidate evidence to one repository base/head pair and records provenance and state transitions. It is designed to support Finder → Challenger → Arbiter without allowing one role to discover and immediately certify its own new hypothesis.

## Candidate producers

Examples:

- built-in bug Finder;
- built-in security Finder;
- Bugbot;
- Semgrep / CodeQL / dependency tooling;
- Codex / Claude / other optional model lanes;
- runtime reproduction;
- property/fuzz/invariant tooling.

Normalize their useful leads into one candidate shape before confirmation.

## Candidate contract

A candidate requires:

- stable `findingId`;
- axis and category;
- exact claim;
- location when code-backed;
- runtime trigger when known;
- producer identity;
- at least one concrete evidence item;
- base/head binding inherited from the ledger.

Equivalent claims are deduplicated by a deterministic fingerprint while preserving all producer identities and evidence.

## Independence rules

1. A producer cannot validate its own candidate.
2. Validation verdicts are only `accept`, `reject`, or `request-more-evidence`.
3. A validator that discovers a different claim must enqueue it as a **new candidate**. It cannot self-confirm the new claim inside the validation record.
4. Arbitration occurs only after validation.
5. The arbiter must be independent of both the candidate's producers and the validator.
6. A moved PR head invalidates the ledger unless the caller explicitly proves individual evidence is head-independent and rebuilds/rebinds the run.

These constraints are mechanical in `scripts/lib/review-candidate-ledger.mjs`; they are not merely reviewer etiquette.

## States

- `candidate` — discovered but not independently validated;
- `needs-more-evidence` — validator could not settle the claim;
- `validated` — accepted/confirmed with independent evidence;
- `rejected` — disproved/dismissed;
- `manual-review` — arbitration cannot safely settle it automatically.

A clean review claim is invalid while required-scope candidates remain unresolved.

## History

The ledger records deterministic sequence-numbered events rather than inventing its own wall clock. The host/run envelope may add one captured timestamp if needed. This avoids multiple clocks being sampled for one logical review decision.

## Integration direction

Follow-up workflow integration should:

1. create one ledger for the exact review base/head;
2. persist blind-discovery candidates before context reconciliation;
3. import deterministic/static/external leads as candidates, not confirmed findings;
4. send each candidate to an independent Challenger;
5. enqueue any new Challenger discovery instead of self-certifying it;
6. arbitrate disputed and high-impact candidates with another independent identity;
7. derive final confirmed/dismissed/manual/unreviewed reporting from ledger state;
8. invalidate or rebuild when the PR head changes.

The ship gate remains authoritative. The ledger is evidence infrastructure and cannot waive Bug, Security, Spec, Standards, semantic-propagation, CI, mutation-authority, or ship-gate requirements.
