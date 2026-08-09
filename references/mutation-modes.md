# Mutation modes

Every workflow has an explicit mutation mode. Default to `read-only` unless the natural-language user request or a higher-level authorized workflow selects another mode.

The user never needs to choose CLI flags. The agent derives the narrowest appropriate mode from the request, loads the matching workflow, and passes the mode to internal scripts.

## Profiles

| Action | read-only | review | maintainer | autonomous |
|---|---:|---:|---:|---:|
| Read evidence and draft text | yes | yes | yes | yes |
| Publish PR/issue comments and reviews | no | yes | yes | yes |
| Reply to a bot thread | no | yes | yes | yes |
| Reply to a human thread | no | exact text required | exact text required | exact text required |
| Push scoped code | no | no | yes | yes |
| Post feedback-resolution records | no | no | yes | yes |
| Resolve bot-authored threads (`--resolve-bot`) | no | yes, after verification | yes | yes |
| Resolve human threads | no | no | explicit instruction | yes, subject to social policy |
| Change draft state / request reviewers | no | no | explicit instruction | yes |
| Close an obsolete PR (supersede / overtake-close) | no | no | explicit instruction | yes |
| Merge PR / close linked issue | no | no | explicit instruction | yes, only inside the governing workflow |
| Create a follow-up issue | no | no | explicit instruction | yes |

The profile is an upper bound, not a waiver. Draft/WIP gates, exact-text confirmation, linked-issue thanks, stack handling, thread ownership, expected-head checks, and workflow-specific requirements still apply.

## Trusted authority at execution

Mutation mode describes what a workflow may request. It is not, by itself, proof that a human granted the exact effect.

Dry-run planning remains available with the normal mode rules so the agent can show the bounded operation before approval. At `--execute`, the mutation boundary additionally requires a scoped trusted authority grant when either condition is true:

- the request uses `autonomous` mode; or
- the action is high-assurance/destructive: `push_code`, `resolve_thread`, `close_linked_issue`, `close_pr`, `merge_pr`, `retarget_pr`, or `delete_head_branch`.

The existing `GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1` switch remains a stronger global policy and requires trusted authority for every executed mutation. In every strict case, the trusted grant must contain `scopeSha256`; a legacy resource-only signature is not enough.

This keeps hostile repository text and model-selected mode inside the request layer. The actual high-impact write still needs an independently verified grant for the exact effect.

## Natural-language selection

Examples:

- `full review PR #32` → `review` (the full-review workflow publishes its verdict comment)
- `what is left on PR #32?` → `read-only`
- `review PR #32 and post the findings` → `review`
- `fix PR #32 and make it merge ready` → `maintainer`
- `merge PR #32` → `maintainer` with explicit authority for the merge workflow
- `supersede PR #12 with #45` → `maintainer` with explicit authority for the close/comment actions
- `maintainer overtake PR #32` → `maintainer` with explicit authority for the push/close/comment actions the overtake workflow needs
- `watch and autonomously fix/merge PR #32` → `autonomous` only when the wording truly grants that scope; execution still requires a scoped trusted grant

Do not ask users to run scripts. These mappings are agent behavior.

## Router authority

The router output is authoritative. A full review resolves to `review` (bare)
or `maintainer` (when `fix` or `simplify` is explicitly requested); both
profiles permit `post_comment`, so publishing the verdict is intrinsic to the
workflow.

Gate invocations must pass the routed mutation mode plus `--workflow`, and the
gate rejects incompatible combinations (for example
`--mutation-mode read-only --workflow references/full-review-pr.md`). A stricter
self-selected mode is a workflow violation, never a publication excuse: a
full-review run may complete with a chat-only verdict only when GitHub
publication is genuinely unavailable and that hard blocker is recorded.

## Machine-readable policy

Inspect a profile:

```bash
node scripts/mutation-policy.mjs maintainer
```

Authorize one action:

```bash
node scripts/mutation-policy.mjs maintainer merge_pr --explicit
```

This policy check does not itself perform a write. All GitHub network writes must go through `scripts/github-mutate.mjs`; see `references/github-mutation-broker.md`.

## Broker request

```bash
node scripts/github-mutate.mjs --request request.json
node scripts/github-mutate.mjs --request request.json --execute --audit mutations.jsonl
```

The first form is a dry run. The second executes and records a versioned receipt. High-assurance execution requires a scoped trusted grant as described above.

## Denial reasons

- `mode_denied`: the selected profile never permits the action
- `explicit_instruction_required`: maintainer mode needs a direct instruction for the action
- `exact_text_confirmation_required`: a human-facing reply needs exact-text confirmation
- `unknown_action`: the requested mutation is not part of the policy schema
- `trusted_authority_required:*`: execution requires independently verified scoped authority
- `expected_head_mismatch`: the PR changed after the decision was made
- request validation failures such as `idempotency_key_required`
