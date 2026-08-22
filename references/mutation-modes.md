# Mutation modes

Every workflow has an explicit mutation mode. Default to `read-only` unless the natural-language user request or a higher-level authorized workflow selects another mode.

The user never needs to choose CLI flags. The agent derives the narrowest appropriate mode from the request, loads the matching workflow, and passes the mode to internal scripts.

Mutation mode and trusted-authority protection are separate controls:

- mutation mode answers **what the workflow is allowed to request**;
- authority protection answers **when an executed mutation additionally needs an independently verified OS-backed grant**.

Turning trusted-authority protection off never broadens the mutation profile or waives workflow policy.

## Profiles

| Action | read-only | review | maintainer | autonomous |
|---|---:|---:|---:|---:|
| Read evidence and draft text | yes | yes | yes | yes |
| Publish ordinary PR/issue comments and reviews | no | yes | yes | yes |
| Publish a full-review verdict | no | yes, authority policy applies | yes, authority policy applies | yes, authority policy applies |
| Reply to a bot thread | no | yes | yes | yes |
| Reply to a human thread | no | exact text required; authority policy applies | exact text required; authority policy applies | exact text required; authority policy applies |
| Push scoped code | no | no | yes | yes |
| Post feedback-resolution records | no | no | yes | yes |
| Resolve bot-authored threads (`--resolve-bot`) | no | yes, after verification | yes | yes |
| Resolve human threads | no | no | explicit instruction | yes, subject to social policy |
| Change draft state / request reviewers | no | no | explicit instruction | yes |
| Close an obsolete PR (supersede / overtake-close) | no | no | explicit instruction | yes |
| Merge PR / close linked issue | no | no | explicit instruction | yes, only inside the governing workflow |
| Create a follow-up issue | no | no | explicit instruction | yes |

The profile is an upper bound, not a waiver. Draft/WIP gates, exact-text confirmation, linked-issue thanks, stack handling, thread ownership, expected-head checks, idempotency, and workflow-specific requirements still apply in every authority-protection mode.

## Trusted-authority protection

The global user setting `authorityMode` has exactly three values:

| authorityMode | Extra trusted-authority requirement at execution |
|---|---|
| `off` | independent intent (explicit lifecycle instruction and exact-text consent) still required; other high-assurance writes skip Hello |
| `high-assurance` | autonomous execution and registry actions marked `highAssurance` |
| `all` | every executed GitHub mutation |

The persistent user config defaults to `high-assurance`. It lives outside the installed skill directory so upgrading the skill cannot overwrite an explicit user choice. `GITHUB_DELIVERY_AUTHORITY_MODE=off|high-assurance|all` may override the persistent value for automation or diagnosis. The legacy `GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1` switch remains supported and maps to the stricter `all` mode.

`off` is an explicit opt-out that skips Windows Hello for high-assurance writes that do **not** require independently authenticated lifecycle intent or exact-text consent. It does not mean “the agent can do anything.” Direct merge instruction, exact-text confirmation for human replies, expected-head checks, ownership checks, idempotency, workflow routing, ship gates, and all other mutation-policy rules remain mandatory. Caller-supplied `explicitInstruction` and `exactTextConfirmed` are never themselves that independent intent.

Dry-run planning never requires trusted authority. When the selected mode requires authority at `--execute`, the trusted grant must contain `scopeSha256`; a legacy resource-only signature is not enough.

A **PR session** is an opt-in Hello grant, distinct from a branch lease. After Windows Hello, the approval UI may start a 5–60 minute session bound to one allowlisted repo, one PR, and one head branch. Later exact-scope `push_code` and `merge_pr` batches on that tuple skip Hello (`approvalMethod: pr_session`) but still receive one-time redeemable grants. Branch leases remain `push_code` only for 1–10 minutes. Comments, human replies, close, and delete still need Hello. Mixed-action batches are not session-eligible.

The canonical enabled high-assurance action set is listed below. CI verifies exact set equality against the executable registry. The list remains an intrinsic risk classification even when a user explicitly selects `off`.

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

This keeps hostile repository text and model-selected mode inside the request layer. In the default `high-assurance` mode and in `all`, a protected write additionally needs an independently verified grant for the exact effect. An explicit `off` configuration skips that additional trusted-authority requirement for writes that are not independent-intent actions. Independent intent still requires a verified host grant at `--execute`.

A human reply always needs exact-text confirmation. When authority protection requires a grant, the grant additionally binds `exactTextSha256` to the exact outgoing body. Caller-supplied `exactTextConfirmed` is never itself trusted provenance.

### Autonomous idempotency claims

Autonomous social creates use a repository-scoped idempotency claim before the visible effect. New claims are stored as scope-bound annotated Git tag objects behind `refs/github-delivery/idempotency/...`; the claim records its creation time and exact operation scope.

A competing fresh claim fails closed. A claim older than 30 minutes may be recovered automatically only when its stored scope exactly matches the retry. Recovery rereads the exact claim before deleting it. The broker then rechecks the visible marker and re-verifies ownership of the replacement claim immediately before the visible write. This keeps uncertain retries recoverable without turning ordinary claim conflicts into duplicate writes.

Legacy pre-metadata claims cannot be assigned a trustworthy creation time after the fact. They fail closed with a one-time manual-cleanup diagnostic rather than being guessed stale.

### Durable full-review verdict provenance

A full-review verdict is never merge evidence merely because arbitrary repository text copied the `[GD]` format. Publisher ownership, exact reviewed head, required verdict structure, workflow routing, and publication checks always apply.

When `authorityMode` is `high-assurance` or `all`, the full-review publication path additionally must:

1. build the normal `post_comment` request for the exact reviewed head and verdict body;
2. obtain scoped trusted authority through the normal mutation execution path;
3. publish the authorized request with the hidden `github-delivery:review-authority` marker that binds the exact scope without changing the human-visible body hash;
4. run `scripts/verify-verdict-published.mjs`, which re-verifies the signed grant at the GitHub comment creation time and requires Windows Hello approval, `scopeSha256`, and the one-time redemption claim.

When `authorityMode` is explicitly `off`, `scripts/verify-verdict-published.mjs` still requires the authenticated publisher, exact head, and valid verdict format, but intentionally does not require OS-backed provenance. It reports `trusted:false` and `trusted_authority_disabled_by_user_config`; it must never manufacture a trusted claim.

Offline security fixtures that explicitly provide `--authority-public-key-file` remain strict regardless of local user config so verifier regression tests cannot be weakened by a developer machine setting.

A generic `post_comment` that does not satisfy the full-review publication contract never satisfies merge review evidence.

## Natural-language selection

Examples:

- `full review PR #32` → `review` (the full-review workflow publishes its verdict comment; trusted authority is required by the default protection mode)
- `what is left on PR #32?` → `read-only`
- `review PR #32 and post the findings` → `review`
- `fix PR #32 and make it merge ready` → `maintainer`
- `merge PR #32` → `maintainer` with explicit mutation authority for the merge workflow; the default protection mode also requires trusted authority
- `supersede PR #12 with #45` → `maintainer` with explicit authority for the close/comment actions
- `maintainer overtake PR #32` → `maintainer` with explicit authority for the push/close/comment actions the overtake workflow needs
- `watch and autonomously merge PR #32` → `watch-pr.md` in `autonomous` with `merge_pr`; trusted authority plus an optional PR session cover later push/merge without a second Hello
- `watch and autonomously fix/merge PR #32` → `autonomous` only when the wording truly grants that scope; normal workflow bounds still apply, and trusted authority is required unless the user explicitly selected `off`

Do not ask users to run scripts. These mappings are agent behavior.

## Router authority

The router output is authoritative. A full review resolves to `review` (bare) or `maintainer` (when `fix` or `simplify` is explicitly requested); both profiles permit ordinary `post_comment`. The full-review verdict remains intrinsically high assurance, while whether that classification triggers trusted authority at execution is controlled by `authorityMode`.

Gate invocations must pass the routed mutation mode plus `--workflow`, and the gate rejects incompatible combinations (for example `--mutation-mode read-only --workflow references/full-review-pr.md`). A stricter self-selected mode is a workflow violation, never a publication excuse: a full-review run may complete with a chat-only verdict only when GitHub publication is genuinely unavailable and that hard blocker is recorded.

## Machine-readable policy

Inspect a profile:

```bash
node scripts/mutation-policy.mjs maintainer
```

Authorize one action:

```bash
node scripts/mutation-policy.mjs maintainer merge_pr --explicit
```

This policy check does not itself perform a write.

## Broker request

Routine non-merge GitHub writes use:

```bash
node scripts/github-mutate.mjs --request request.json
node scripts/github-mutate.mjs --request request.json --execute --audit mutations.jsonl
```

The first form is a dry run. The second executes and records a versioned receipt. Additional trusted-authority enforcement follows `authorityMode` as described above.

`merge_pr` is deliberately rejected by this generic public mutation-document entrypoint. A merge must go through `scripts/merge-pr-driver.mjs`, which owns the ship gate, same-head review evidence, settle window, feedback/base/rules boundary, final recaptures, authority acquisition, expected-head merge, and post-merge reconciliation. The lower broker primitive exists only for that governing driver and focused tests.

## Denial reasons

- `mode_denied`: the selected profile never permits the action
- `explicit_instruction_required`: maintainer mode needs a direct instruction for the action
- `exact_text_confirmation_required`: a human-facing reply needs exact-text confirmation
- `unknown_action`: the requested mutation is not part of the policy schema
- `trusted_authority_required:*`: the selected protection mode requires independently verified scoped authority
- `expected_head_mismatch`: the PR changed after the decision was made
- `merge_pr_requires_merge_driver`: a generic mutation document attempted to bypass the governing merge workflow
- `autonomous_idempotency_claim_conflict:*`: another fresh autonomous operation owns the exact idempotency scope
- `review_authority_*`: a protected full-review verdict lacks valid durable trusted provenance
- request validation failures such as `idempotency_key_required`
