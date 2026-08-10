# Mutation modes

Every workflow has an explicit mutation mode. Default to `read-only` unless the natural-language user request or a higher-level authorized workflow selects another mode.

The user never needs to choose CLI flags. The agent derives the narrowest appropriate mode from the request, loads the matching workflow, and passes the mode to internal scripts.

## Profiles

| Action | read-only | review | maintainer | autonomous |
|---|---:|---:|---:|---:|
| Read evidence and draft text | yes | yes | yes | yes |
| Publish ordinary PR/issue comments and reviews | no | yes | yes | yes |
| Publish a full-review verdict | no | yes, trusted authority required | yes, trusted authority required | yes, trusted authority required |
| Reply to a bot thread | no | yes | yes | yes |
| Reply to a human thread | no | exact text + trusted authority required | exact text + trusted authority required | exact text + trusted authority required |
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

Dry-run planning remains available with the normal mode rules so the agent can show the bounded operation before approval. At `--execute`, the mutation boundary additionally requires a scoped trusted authority grant when any condition is true:

- the request uses `autonomous` mode; or
- the action is marked `highAssurance` in `scripts/lib/mutation-action-registry.mjs`.

The canonical enabled high-assurance action set is listed below. CI verifies exact set equality against the executable registry. Do not maintain a second informal subset elsewhere.

<!-- high-assurance-actions:start -->
- `assign_issue`
- `change_draft_state`
- `close_linked_issue`
- `close_pr`
- `create_follow_up_issue`
- `create_issue`
- `create_pr`
- `delete_head_branch`
- `edit_own_comment`
- `merge_pr`
- `post_comment`
- `post_issue_comment`
- `post_resolution_record`
- `post_review`
- `push_code`
- `reply_bot_thread`
- `reply_human_thread`
- `request_reviewers`
- `resolve_bot_thread`
- `resolve_thread`
- `retarget_pr`
- `update_pr_body`
<!-- high-assurance-actions:end -->

The existing `GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1` switch remains a stronger global policy and requires trusted authority for every executed mutation. In every strict case, the trusted grant must contain `scopeSha256`; a legacy resource-only signature is not enough.

This keeps hostile repository text and model-selected mode inside the request layer. The actual high-impact write still needs an independently verified grant for the exact effect.

A review-mode human reply may be planned so the exact text can be shown for approval, but it cannot execute from caller-supplied `exactTextConfirmed` alone. Execution requires a trusted grant whose `exactTextSha256` matches the exact outgoing body.

### Durable full-review verdict provenance

A full-review verdict is not trusted merge evidence merely because its Markdown is valid and it was posted by the authenticated GitHub actor.

The full-review publication path must:

1. build the normal `post_comment` request for the exact reviewed head and verdict body;
2. obtain scoped trusted authority through `scripts/github-authorize.mjs`;
3. use the authorized request returned by that helper — it automatically adds a hidden `github-delivery:review-authority` marker that carries the exact scoped grant without changing the human-visible body hash;
4. execute that stamped request through `scripts/github-mutate.mjs`;
5. run `scripts/verify-verdict-published.mjs`, which now requires both valid verdict format and valid historical trusted-authority provenance.

The provenance check re-verifies the signed grant at the comment's GitHub creation time and requires `windows_hello`, `scopeSha256`, and the one-time redemption claim. A generic `post_comment` that merely copies the `[GD]` format never satisfies merge review evidence.

## Natural-language selection

Examples:

- `full review PR #32` → `review` (the full-review workflow publishes its verdict comment through trusted verdict authority)
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
profiles permit ordinary `post_comment`, while the final full-review verdict is
a high-assurance special case and requires trusted authority at execution.

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
- `review_authority_*`: a full-review verdict lacks valid durable trusted provenance
- request validation failures such as `idempotency_key_required`
