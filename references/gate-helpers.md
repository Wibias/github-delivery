# Gate helpers

Load this reference before a merge-ready claim, status-ready verdict, merge, or watch transition into waiting.

Resolve `<github-delivery>` to this skill’s install directory (repo root or `~/.agents/skills/github-delivery`).

## Authoritative ship decision

Run exactly one authoritative decision first:

```bash
# status / watch (read-only):
node "<github-delivery>/scripts/ship-gate.mjs" OWNER/REPO N \
  --mutation-mode read-only

# full review (review, or maintainer with fix/simplify):
node "<github-delivery>/scripts/ship-gate.mjs" OWNER/REPO N \
  --mutation-mode review \
  --workflow references/full-review-pr.md
```

The command captures one evidence snapshot and evaluates required checks, base health, review policy, unresolved threads, trusted feedback, merge state, and advisory CODEOWNERS against that same head SHA. Its output also includes the active mutation profile.

Gate invocation contract: pass the router-derived mutation mode plus the
matched `--workflow`. The gate rejects an incompatible combination, for example
`--mutation-mode read-only --workflow references/full-review-pr.md`, because a
stricter self-selected mode is a workflow violation, not a publication excuse.

Decision contract:

- exit `0`, `decision: "ready"`: the automated gate permits a ready/wait transition; workflow-specific bug, security, spec, social, and adaptive-settle requirements still apply
- exit `1`, `decision: "blocked"`: act on the namespaced blockers before waiting, claiming ready, or merging
- exit `2`, `decision: "unknown"`: evidence is stale, incomplete, mismatched, or unreadable; restore evidence and rerun

Known blockers outrank unknown evidence. Unknown evidence outranks readiness. No individual helper may overrule the final decision.

## Verdict publication check

Full-review runs must verify the verdict landed before marking
`Publish final verdict` complete:

```bash
node "<github-delivery>/scripts/verify-verdict-published.mjs" OWNER/REPO N \
  --run-id fr-<PR>-<head-short-sha>-<UTC-start-time> \
  --head <40-char-reviewed-head-sha> \
  --mutation-mode review
```

Exit `0` / `published: true` is the only normal completion proof. Exit `1`
means the verdict is not published; exit `2` means the check itself failed.
Chat-only delivery never satisfies this check unless GitHub publication was
genuinely unavailable and that hard blocker is recorded.

## Adaptive readiness settle

Use this only after the authoritative decision is `ready`.

1. Record the PR head SHA, immediate base head SHA, completed workflow set, required-check state, reviews, unresolved threads, merge state, and last observable change.
2. Select **60 seconds by default** or **180 seconds** after a push, rebase, restack, force-with-lease, base movement, approval/thread change, draft/ready transition, or newly discovered workflow. A visible bot review-in-progress signal may extend one window to 300 seconds.
3. Announce that the gates are **currently green and stability verification is in progress**. Include the reason, duration, both heads, remaining time, and next verification. Never emit only `All green`.
4. Run a fresh authoritative `ship-gate.mjs` poll every **20 seconds**. Do not use snapshot replay for these polls. Never perform or expose one silent `sleep` / `Start-Sleep` longer than **30 seconds**.
5. Any material change resets the window. Exit `1` requires action; exit `2` requires evidence restoration.
6. At expiry, run one final authoritative gate and verify both recorded heads are unchanged. Only then may the governing workflow claim merge-ready, publish `approve-comment`, or begin a direct merge that lacked prior current-head settle evidence.

`status` does not initiate this wait; it reports whether valid settle evidence already exists. Watch mode uses its normal polling cadence and must not convert a green milestone into a merge-ready claim.

### Capture and replay

```bash
node "<github-delivery>/scripts/ship-gate-snapshot.mjs" OWNER/REPO N --output snapshot.json
node "<github-delivery>/scripts/ship-gate.mjs" OWNER/REPO N \
  --snapshot snapshot.json \
  --mutation-mode read-only
```

Snapshot replay validates schema, repository, PR number, head SHA when supplied with `--expected-head`, completeness, and age. Snapshot mode performs no GitHub API calls. When a replayed red head lacks base-health evidence, the failure origin remains `unknown` rather than being guessed.

## Mutation profile

Default to `read-only`. Select `review`, `maintainer`, or `autonomous` only when the user request or governing workflow authorizes that level.

```bash
node "<github-delivery>/scripts/mutation-policy.mjs" maintainer
node "<github-delivery>/scripts/mutation-policy.mjs" maintainer merge_pr --explicit
```

The profile is an upper bound. Human replies still require exact-text confirmation even in autonomous mode. See `references/mutation-modes.md`.

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
node "<github-delivery>/scripts/required-checks.mjs" OWNER/REPO N
```

Preserves classic and ruleset source identity and fails closed on incomplete check evidence.

### Advisory CODEOWNERS paths

```bash
node "<github-delivery>/scripts/codeowners-for-pr.mjs" OWNER/REPO N
```

Maps PR files to owners on the base branch. GitHub `reviewDecision` remains authoritative for enforced CODEOWNERS approval.

### Unresolved review threads

```bash
node "<github-delivery>/scripts/review-threads.mjs" OWNER/REPO N
# mutation only when the active mode and social policy permit it:
node "<github-delivery>/scripts/review-threads.mjs" OWNER/REPO N \
  --resolve PRRT_xxx \
  --mutation-mode maintainer \
  --explicit
```

### Watch and trusted feedback

```bash
node "<github-delivery>/scripts/watch-wake-gate.mjs" OWNER/REPO N
```

Use this to inspect the `wake` component. Clearing feedback requires a verified exact resolution record:

```text
[GD] Addressed feedback

feedbacks:
- issue_comment:12345
- review_comment:67890

commit: abc1234

<!-- gd:addressed-feedback head:<40-char-current-head-sha> -->
```

Aggregate all feedback resolved by the same current head into this single comment. Before creating it, search for the exact head marker and edit that comment when present. An unrelated later commit does not clear feedback.

### Merge queue and review policy

```bash
node "<github-delivery>/scripts/pr-policy-gate.mjs" OWNER/REPO N
```

Use this to inspect review policy, last-push approval, merge queue, and `merge_group` workflow coverage.

## Review-scope helpers

These classify review work; they are not substitutes for the authoritative ship decision.

```bash
node "<github-delivery>/scripts/security-scope.mjs" OWNER/REPO N
node "<github-delivery>/scripts/bug-scope.mjs" OWNER/REPO N
```
