# P1 Audit Remediation: Correctness and GitHub Semantics

Baseline audit: `d5137472eafb660c18306d28484f6850aeab6ac4` on 2026-08-09.

This branch owns correctness defects that should be fixed soon after the P0 autonomous-safety blockers.

## Scope

### 1. Match GitHub semantics for same-name Check Runs and Commit Statuses

Audit finding: `GD-AUDIT-003`.

Required outcome:

- Treat a required name that exists as both a Check Run and Commit Status according to GitHub's current required-check semantics.
- Preserve expected GitHub App/source validation.
- Do not let a successful expected-App Check Run hide a failing same-name Commit Status.
- Fail closed for unknown or contradictory combinations.

Acceptance criteria:

- Expected-App check success + same-name commit status failure => blocked.
- Expected-App check failure + same-name status success => blocked.
- All required same-name evidence passing => ready only when all other gate components are ready.
- Duplicate and unknown-source fixtures remain conservative.

### 2. Distinguish `merged`, `queued`, and `auto_merge_enabled`

Audit finding: `GD-AUDIT-004`.

Required outcome:

- Do not infer an actual merge from `gh pr merge` exit code 0.
- Verify postcondition using GitHub PR state and `mergedAt`/equivalent authoritative evidence.
- Model at least: `merged`, `queued`, `auto_merge_enabled`, `already_merged`, and `failed`.
- Only actual `merged` may trigger post-merge thanks, linked-issue close-out, or other merge-complete effects.
- Queue/auto-merge outcomes must transition into the watch/revalidation path.

Acceptance criteria:

- Exit 0 + `mergedAt = null` cannot report "merged successfully".
- Queued PR cannot trigger merge-complete social writes.
- Later queue eviction/failure does not leave a false merged receipt.
- Already-merged retry remains idempotent.

### 3. Fail Dependency Review closed for non-Node dependencies

Audit finding: `GD-AUDIT-005`.

Required outcome:

- Remove the assumption that absence of Node dependencies means the repository is dependency-free.
- At minimum recognise the repository's NuGet dependency surface (`*.csproj`, `packages.lock.json`, related supported manifests/lockfiles).
- Prefer a simple fail-closed rule over reimplementing GitHub's entire dependency graph ecosystem detector.
- If Dependency Review is unavailable and a supported dependency manifest/lockfile exists, the required check must fail rather than degraded-pass.

Acceptance criteria:

- NuGet-only fixture + Dependency Review unavailable => failure.
- Node dependency fixture + Dependency Review unavailable => failure.
- Truly dependency-free fixture may retain explicitly documented degraded behaviour if still desired.
- Existing successful Dependency Review path is unchanged.

### 4. Qualify stacked-PR refs by repository identity

Audit finding: `GD-AUDIT-006`.

Required outcome:

- Replace branch-name-only stack identity with repository-qualified refs.
- A stack edge exists only when child base repository/ref exactly matches parent head repository/ref.
- Preserve detection of cycles, duplicate true heads, branching shapes, stale parents, and incomplete pagination.

Acceptance criteria:

- `fork-A:feature` and `fork-B:feature` are distinct heads.
- A foreign fork branch named like an upstream branch is not mistaken for the parent.
- Same-repository stacks keep current behaviour.
- Stack mutation guidance always names the exact repository + branch identity.

## Non-goals

- P0 broker/ship-gate blocker fixes.
- P2 defence-in-depth test infrastructure.
- P3 context and policy simplification.

## Validation required before ready-for-review

- Run the authoritative validation suite.
- Add independent fixtures for all four GitHub semantic cases.
- Exercise Node 22 and Node 24 where practical.
- Verify changes remain fail-closed under unknown API enum/state values.
