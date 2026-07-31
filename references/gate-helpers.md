# Gate helpers (required checks, CODEOWNERS, threads, policy)

Load with the evidence sweep when claiming merge-ready, status “merge-ready”, or merge.

Resolve `<shipping-github>` to this skill’s install directory (repo root or `~/.agents/skills/shipping-github`).

## Required checks

```bash
node "<shipping-github>/scripts/required-checks.mjs" OWNER/REPO N
```

Unions classic protection **legacy** `contexts` + **modern** `checks[].context`, branch **rulesets**, and live rollup. Exit `1` if required jobs fail/pending/missing. See **Required checks + review gate** in `shared-rules.md`.

## CODEOWNERS paths

```bash
node "<shipping-github>/scripts/codeowners-for-pr.mjs" OWNER/REPO N
```

Maps PR files → owners on **base** CODEOWNERS + `codeowners/errors` + review requests.

## Unresolved review threads (GraphQL)

```bash
node "<shipping-github>/scripts/review-threads.mjs" OWNER/REPO N
# optional (only when social policy allows resolve):
node "<shipping-github>/scripts/review-threads.mjs" OWNER/REPO N --resolve PRRT_xxx
```

Paginates `reviewThreads`; exit `1` if any unresolved. Prefer this over guessing from the UI. See **Review threads (GraphQL)** in `shared-rules.md`.

## Watch wake gate (owner comments)

Before any watch “waiting for CI/CodeRabbit” heartbeat:

```bash
node "<shipping-github>/scripts/watch-wake-gate.mjs" OWNER/REPO N
```

Exit `1` = unacked OWNER/MEMBER/COLLABORATOR top-level comments (merge-from-base alone does **not** clear). Fix or post `[shipping-github] Addressed owner feedback — …`, then re-run. Exit `0` = wait allowed. See `watch-pr.md`.

## Merge queue + review policy

```bash
node "<shipping-github>/scripts/pr-policy-gate.mjs" OWNER/REPO N
```

Reports:

- `isMergeQueueEnabled` / `isInMergeQueue` / queue entry state
- Whether local workflows mention `merge_group` (stall risk if queue on + CI only on `pull_request`)
- `requiresCodeOwnerReviews` (enforced vs suggestion-only)
- `dismissesStaleReviews` / `requireLastPushApproval` and approvals vs **current head SHA**

See **Merge queue** and **Stale approvals / last-push** in `shared-rules.md`.
