# Audit Generation 10 Remediation Design

## Goal

Fix every substantive bug finding from the generation-10 adversarial audit without weakening the user's explicit `authorityMode=off` choice.

## Hard constraint: Off means no Windows Hello

When `authorityMode=off`, GitHub Delivery must never invoke the Windows Authority host merely to authorize a mutation. Off is an explicit opt-out of OS-backed approval. The implementation must not reintroduce Windows Hello for merge, human reply, close, delete, or any other action.

Off also must not claim that caller-provided `explicitInstruction` or `exactTextConfirmed` booleans are independently trusted user-consent provenance. In Off mode, authorization is derived from the routed mutation profile and workflow policy, while the receipt records that trusted authority was disabled by user configuration. `high-assurance` and `all` keep their existing OS-backed grant semantics.

## Findings covered

### GD-AUDIT-003 — caller-attested lifecycle intent in Off mode

Remove the misleading trust elevation of raw request booleans when no trusted grant exists. Add an explicit Off-mode authorization path that treats trusted authority as disabled by user configuration rather than synthesizing trusted user intent. Raw request booleans must not be reported as trusted provenance. High-assurance/all behavior remains unchanged.

Acceptance:
- Off-mode execution never calls the Authority host or Windows Hello.
- Raw `explicitInstruction:true` / `exactTextConfirmed:true` are not treated as independently verified provenance.
- Allowed actions remain bounded by the routed mutation mode/action policy and the normal broker invariants.
- High-assurance/all still require scoped trusted authority where configured.

### GD-AUDIT-018 — required probe clean evidence can omit trigger files

A required triggered probe may report `clean` only when its evidence proves coverage of every triggering file. Missing, empty, duplicate, or partial file evidence fails closed. Non-triggered/advisory probes retain their existing semantics.

### GD-AUDIT-006 — classic branch-pattern parity

Stop pretending the custom matcher is fully GitHub-compatible. Support only a deliberately proven subset of classic branch patterns with semantics matching GitHub's documented `File.fnmatch` behavior; fail closed when a pattern uses unsupported/ambiguous syntax. Add parity fixtures for escaped characters, bracket classes, dot-leading names, and unsupported constructs.

### GD-AUDIT-022 — issue-body/repository-text prompt injection

Destructive routing authority must come from trusted user text, not attributed repository content. Expand the attributed-untrusted-text stripper to cover issue bodies/descriptions and generic repository-text attribution, and add neutral/adversarial twins proving that an embedded `merge PR #...` instruction does not route to merge while a real user instruction still does.

### GD-AUDIT-023 — named GraphQL mutation detector bypass

The mutation-boundary scanner must detect both anonymous and named GraphQL mutation operations. Prefer a small operation-header parser over a mutation regex that only recognizes anonymous forms. Privileged files remain limited to the registered GraphQL mutation names; non-privileged production helpers must reject any GraphQL mutation.

### GD-AUDIT-015 — unresolved-review-thread merge TOCTOU

Keep GitHub-side conversation-resolution enforcement as the hard server-side backstop, and make merge execution require evidence that this enforcement is active and non-bypassable before the final merge mutation. Perform a final unresolved-thread recapture immediately before authority/broker execution and bind its capture to the same head/base snapshot. If conversation-resolution enforcement cannot be proven, fail closed instead of relying on the client-side snapshot alone.

### GD-AUDIT-021 — behavioral-eval self-attested transcripts

A plain JSON transcript plus matching canonical hash is internally consistent but not trusted execution provenance. Preserve unsigned/local behavioral scores for diagnosis, but they must be marked untrusted and must not be accepted as release/merge gating evidence. Add an attested provenance form whose signature binds the canonical transcript hash plus run identity; only attested runs may claim `trusted:true` for gating.

## Testing strategy

Use TDD for every finding:

1. Add focused failing regressions for the exact exploit/false-green case.
2. Run focused tests and preserve RED evidence.
3. Implement the narrowest production change.
4. Run focused GREEN tests.
5. Run canonical `npm run check` plus Windows authority build/self-test and repository-security checks through CI.
6. Re-review the exact final diff for security/spec/correctness before PR completion.

The Off-mode suite must contain a direct assertion that no Authority-host client/redeemer/Windows Hello path is invoked when `authorityMode=off`.

## Non-goals

- Do not remove or weaken `high-assurance` or `all` authority protection.
- Do not add a replacement interactive confirmation prompt in Off mode.
- Do not broaden mutation profiles or bypass expected-head, ownership, idempotency, stack, ship-gate, or publication checks.
- Do not turn behavioral-eval attestation into a network dependency for ordinary offline unit tests.
