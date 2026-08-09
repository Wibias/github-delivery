# P2 Audit Remediation: Defence in Depth

Baseline audit: `d5137472eafb660c18306d28484f6850aeab6ac4` on 2026-08-09.

This branch owns hardening that should make future regressions harder to introduce or hide. It must not weaken P0/P1 safety guarantees.

## Scope

### 1. Add a repository-wide mutation-boundary scanner

Required outcome:

- Detect write-capable GitHub and remote-Git operations outside explicitly approved mutation-broker and isolated fixture files.
- Cover direct `gh` writes, `gh api` GraphQL/REST mutations, GitHub REST/GraphQL mutation helpers, `git push`, branch deletion, release mutation, review-thread mutation, issue/PR mutation, and equivalent wrappers.
- Prefer structured/AST-aware detection where practical; use narrow allowlists rather than broad path exclusions.
- Run in the authoritative validation suite and CI.

Acceptance criteria:

- A temporary direct `resolveReviewThread` helper outside the broker makes validation fail.
- A direct production `git push` makes validation fail.
- Read-only `gh`/API operations do not produce false positives.
- Test fixture exceptions are explicit and documented.

### 2. Add crash/retry transactional tests

Required outcome:

Exercise partial-failure recovery around multi-step operations, including:

- actual merge succeeds, process dies before thanks;
- social write succeeds, local receipt write fails;
- branch mutation succeeds, verification read fails;
- retry after an unknown network outcome;
- cleanup interrupted halfway through.

Acceptance criteria:

- Retry never duplicates an already-applied remote effect where idempotency is promised.
- State reports uncertainty rather than inventing success.
- Post-merge effects run only after independently verifying the merge postcondition.

### 3. Add concurrent idempotency tests

Required outcome:

- Simulate at least two agents/processes racing on the same idempotency key or remote marker.
- Test comments, issue/PR creation where applicable, and other brokered social writes with remote deduplication.
- Use deterministic barriers/fault injection rather than timing sleeps.

Acceptance criteria:

- At most one visible remote effect is created when the invariant promises idempotency.
- The losing execution reports `already_applied` or another explicit safe state.

### 4. Isolate live fixtures more strongly

Required outcome:

- Document and support a dedicated fixture repository as the recommended execution target.
- Require/verify exact configured fixture repository identity before mutation.
- Document a fine-grained token or GitHub App installation scoped to only the fixture repository and minimum required permissions.
- Preserve unique run namespaces, cleanup guards, and canonical-repository mutation refusal.

Acceptance criteria:

- A misconfigured canonical/production repository target is rejected before mutation.
- Fixture cleanup cannot select resources outside the run namespace.
- Parallel fixture runs do not collide.

### 5. Add explicit unknown-GitHub-state fail-closed tests

Required outcome:

- Property/fuzz/fixture tests for previously unseen enum values and malformed optional fields in merge state, check conclusions, review state, ruleset evidence, and other gate-critical API fields.
- Unknown evidence must not silently map to success.

Acceptance criteria:

- New enum values produce blocked/unknown decisions unless explicitly supported.
- Error output names the unknown value and evidence surface.

### 6. Add merge-queue `merge_group` support when applicable

Required outcome:

- Detect or document the target-repository requirement for merge queue CI.
- Required GitHub Actions workflows intended to satisfy merge-queue checks must support `merge_group` when the target repository uses a merge queue.
- Do not add unnecessary write permissions or run untrusted code with elevated credentials.

Acceptance criteria:

- Merge-queue fixture/configuration cannot enter a liveness loop because required checks never run on the merge-group commit.
- Non-merge-queue repositories retain current trigger behaviour unless a generic safe trigger is intentionally adopted.

## Non-goals

- Do not duplicate the P0/P1 code fixes in this branch.
- Do not weaken authority requirements to make fault-injection tests easier.
- Do not add scanners or security products without a concrete invariant they enforce.

## Validation required before ready-for-review

- Authoritative validation suite passes.
- New security tests fail when their protected invariant is deliberately broken.
- No new workflow receives broader GitHub permissions than required.
- Live fixture changes remain opt-in and isolated.
