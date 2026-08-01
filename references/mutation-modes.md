# Mutation modes

Every workflow has an explicit mutation mode. Default to `read-only` unless the user request or a higher-level authorized workflow selects another mode.

## Profiles

| Action | read-only | review | maintainer | autonomous |
|---|---:|---:|---:|---:|
| Read evidence and draft text | yes | yes | yes | yes |
| Publish reviews/comments and reply to bots | no | yes | yes | yes |
| Reply to a human thread | no | exact text required | exact text required | exact text required |
| Push scoped code | no | no | yes | yes |
| Post feedback-resolution records | no | no | yes | yes |
| Resolve threads | no | no | explicit instruction | yes, subject to social policy |
| Change draft state / request reviewers | no | no | explicit instruction | yes |
| Merge PR / close linked issue | no | no | explicit instruction | yes, only inside the governing workflow |
| Create a follow-up issue | no | no | explicit instruction | yes |

The profile is an upper bound, not a waiver. Draft/WIP gates, exact-text confirmation for human replies, linked-issue thanks, stack handling, thread ownership, and other social rules still apply.

## Commands

Inspect a complete profile:

```bash
node scripts/mutation-policy.mjs maintainer
```

Authorize one action:

```bash
node scripts/mutation-policy.mjs maintainer merge_pr --explicit
```

Run the authoritative gate with the active profile included in its output:

```bash
node scripts/ship-gate.mjs OWNER/REPO N --mutation-mode maintainer
```

Resolve a review thread only after both the profile and social policy permit it:

```bash
node scripts/review-threads.mjs OWNER/REPO N \
  --resolve PRRT_xxx \
  --mutation-mode maintainer \
  --explicit
```

## Denial reasons

- `mode_denied`: the selected profile never permits the action
- `explicit_instruction_required`: maintainer mode needs a direct instruction for the action
- `exact_text_confirmation_required`: a human-facing reply needs exact-text confirmation
- `unknown_action`: the requested mutation is not part of the policy schema
