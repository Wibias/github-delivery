# Caller-attested lifecycle intent (GD-AUDIT-003 remaining)

## Status

Approved 2026-08-22 as gen40 leftover GD-AUDIT-003 (numbering-conflict lineage, not first-wave PR 96). Branch from current `origin/main`.

## Problem

`authorityMode=off` skips Windows Hello for high-assurance actions. The broker still copies caller-supplied `explicitInstruction` and `exactTextConfirmed` into effective authorization. A model can therefore self-attest:

- direct lifecycle intent (maintainer merge/close/create/retarget/reviewer/draft/follow-up, and autonomous merge/close/delete)
- human-reply exact-text consent

without a verified host grant. Those request booleans are not independently authenticated user consent.

This does not reopen first-wave 003 (snapshot integrity) or gen40 004/009/011.

## Approach

1. Treat profile `requiresExplicitInstruction` and `requiresExactTextConfirmation` as an independent-intent class, separate from the high-assurance registry bit.
2. At `--execute`, that class always requires a verified trusted grant, including when `authorityMode` is `off`.
3. Dry-run planning may still label `caller_asserted`. Execution must not.
4. Ordinary high-assurance writes that do not require independent intent (`post_comment`, `push_code`, bot replies) keep today's `off` behavior: no Hello prompt.

## Tests

- Off-mode `post_comment` execute still does not require trusted authority.
- Off-mode `merge_pr` and `reply_human_thread` execute do require trusted authority and do not spawn GitHub without a grant.
- Off-mode mutation documents still prompt the authority host for exact-text / explicit-instruction actions.
- Docs state that `off` does not waive independent intent.
