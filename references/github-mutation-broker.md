# GitHub mutation broker

The user-facing interface remains natural language. Requests such as `merge PR #32`, `resolve the fixed bot thread`, or `post the merge-ready comment` route through `SKILL.md` and the matching workflow. The agent prepares and runs the broker internally; users are not expected to invoke scripts manually.

## Required path

All network-visible GitHub writes owned by this skill must use:

```bash
node scripts/github-mutate.mjs --request request.json --execute --audit mutations.jsonl
```

Run without `--execute` first when the operation is destructive, socially visible, or otherwise benefits from inspecting the exact plan.

Direct `gh` writes are forbidden outside the broker implementation and narrowly scoped read-only helpers. Local Git operations such as committing and pushing remain governed by Git safety rules and the `push_code` mutation authorization.

## Request envelope

```json
{
  "schemaVersion": 1,
  "action": "merge_pr",
  "mutationMode": "maintainer",
  "explicitInstruction": true,
  "repo": "OWNER/REPO",
  "pr": 32,
  "expectedHead": "full-reviewed-head-sha",
  "mergeMethod": "merge"
}
```

Social writes also require a stable `idempotencyKey`. Human replies require:

- `exactTextConfirmed: true`
- `exactTextSha256`: SHA-256 of the exact approved body

## Safety behavior

The broker:

1. evaluates the mutation profile before spawning a process;
2. validates request schema and action-specific fields;
3. requires the expected PR head for PR mutations;
4. re-reads the current head immediately before execution;
5. pins merge operations with `--match-head-commit`;
6. defaults to dry-run unless `--execute` is supplied;
7. emits a versioned mutation receipt;
8. appends receipts to `--audit FILE` when requested;
9. performs an action-specific verification read when available.

A denied or stale-head request exits `2` and performs no mutation.

## Natural-language example

User:

```text
merge PR #32
```

Agent flow:

1. Load `github-delivery` from its frontmatter trigger.
2. Route to `references/merge-pr.md`.
3. Run runtime capability discovery and `ship-gate.mjs`.
4. Prepare the PR comment request and execute it through the broker.
5. Prepare the head-pinned merge request and execute it through the broker.
6. Post and close linked issues through broker requests.
7. Return the verified receipts and final repository state.

The scripts are implementation details. Natural language remains the product interface.
