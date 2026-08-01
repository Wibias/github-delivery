# Gate helpers

Load this reference before a merge-ready claim, status-ready verdict, merge, or watch transition into waiting.

Resolve `<shipping-github>` to this skill’s install directory (repo root or `~/.agents/skills/shipping-github`).

## Authoritative ship decision

Run exactly one authoritative decision first:

```bash
node "<shipping-github>/scripts/ship-gate.mjs" OWNER/REPO N
```

The command captures one evidence snapshot and evaluates required checks, base health, review policy, unresolved threads, trusted feedback, merge state, and advisory CODEOWNERS against that same head SHA.

Decision contract:

- exit `0`, `decision: "ready"`: the automated gate permits a ready/wait transition; workflow-specific bug, security, spec, social, and thin-settle requirements still apply
- exit `1`, `decision: "blocked"`: act on the namespaced blockers before waiting, claiming ready, or merging
- exit `2`, `decision: "unknown"`: evidence is stale, incomplete, mismatched, or unreadable; restore evidence and rerun

Known blockers outrank unknown evidence. Unknown evidence outranks readiness. No individual helper may overrule the final decision.

### Capture and replay

```bash
node "<shipping-github>/scripts/ship-gate-snapshot.mjs" OWNER/REPO N --output snapshot.json
node "<shipping-github>/scripts/ship-gate.mjs" OWNER/REPO N --snapshot snapshot.json
```

Snapshot replay validates schema, repository, PR number, head SHA when supplied with `--expected-head`, completeness, and age. Snapshot mode performs no GitHub API calls. When a replayed red head lacks base-health evidence, the failure origin remains `unknown` rather than being guessed.

## Base-health classification

When the PR head has failing checks, inspect `components.baseHealth` and the detailed base-health result.

- `prOnlyFailures` belong in the PR.
- `sharedFailures` may block merging but require a separate follow-up rather than silent scope expansion.
- `unknownFailures` forbid a readiness claim.
- `baseOnlyFailures` are advisory and tracked separately.

A green head does not require base evidence. See `references/base-health.md`.

## Focused diagnostics

Use these only to explain or repair a component reported by `ship-gate.mjs`.

### Required checks

```bash
node "<shipping-github>/scripts/required-checks.mjs" OWNER/REPO N
```

Preserves classic and ruleset source identity and fails closed on incomplete check evidence.

### Advisory CODEOWNERS paths

```bash
node "<shipping-github>/scripts/codeowners-for-pr.mjs" OWNER/REPO N
```

Maps PR files to owners on the base branch. GitHub `reviewDecision` remains authoritative for enforced CODEOWNERS approval.

### Unresolved review threads

```bash
node "<shipping-github>/scripts/review-threads.mjs" OWNER/REPO N
# mutation only when the active social policy permits it:
node "<shipping-github>/scripts/review-threads.mjs" OWNER/REPO N --resolve PRRT_xxx
```

### Watch and trusted feedback

```bash
node "<shipping-github>/scripts/watch-wake-gate.mjs" OWNER/REPO N
```

Use this to inspect the `wake` component. Clearing feedback requires a verified exact resolution record:

```text
[shipping-github] Addressed feedback
feedback: review_comment:67890
commit: abc1234
```

An unrelated later commit does not clear feedback.

### Merge queue and review policy

```bash
node "<shipping-github>/scripts/pr-policy-gate.mjs" OWNER/REPO N
```

Use this to inspect review policy, last-push approval, merge queue, and `merge_group` workflow coverage.

## Review-scope helpers

These classify review work; they are not substitutes for the authoritative ship decision.

```bash
node "<shipping-github>/scripts/security-scope.mjs" OWNER/REPO N
node "<shipping-github>/scripts/bug-scope.mjs" OWNER/REPO N
```
