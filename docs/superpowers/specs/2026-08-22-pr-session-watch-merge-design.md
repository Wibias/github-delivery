# PR session grants for watch-and-merge

## Status

Approved 2026-08-22. Branch from `origin/main`. Do not implement native GitHub stack merge. Do not set autonomous as the default mutation mode. Do not turn Hello off.

## Problem

Unattended watch-and-merge needs one Hello at the start, then exact-scope `push_code` and `merge_pr` on that PR without another tap. Today Hello signs a 60-second batch. Branch leases last 1–10 minutes and cover `push_code` only. `watch PR #N autonomously` does not grant merge. `watch PR #N and merge it` is attended prepare-and-merge.

## Goals

1. Add a new host grant class `pr_session`, distinct from branch leases.
2. After an opt-in Hello, later `push_code` and `merge_pr` on that exact repo + PR + head branch skip Hello for 5–60 minutes.
3. Each later batch still receives a fresh exact-scope, one-time, redeemable grant. `approvalMethod` is `pr_session`.
4. Route `watch` + autonomous wording + explicit merge to `watch-pr.md` in `autonomous` mode with `merge_pr` in `explicitActions`.
5. When that merge action is granted, watch hands a ready PR to `merge-pr-driver.mjs`. GitHub `UNKNOWN` waits. Human replies, native stacks, and expired sessions stop.

## Non-goals

- Autonomous as default.
- `authorityMode: off`.
- Overnight / multi-hour sessions.
- Session coverage for comments, human replies, close, delete, reviewers, or draft state.
- Stretching branch leases to `merge_pr`.
- Native GitHub stack merge (`merge-async` / `gh stack merge`).
- Treating GitHub text as user merge intent.

## Host

### Eligibility

A batch is PR-session eligible when:

- every operation action is `push_code` or `merge_pr`;
- `BranchScope.Resolve` returns one branch (`push_code.branch` or PR-bound `authorityBranch`);
- every operation has the same positive integer `pr`.

`push_code` does not add `pr` to the signed scope. The host reads `pr` only to match the session. Watch must attach `pr` on `push_code` so the first auto-fix push can start a session.

A `push_code`-only batch without `pr` stays on today’s branch-lease path.

### Lifetime

- Create only after successful Windows Hello and an explicit approval-UI opt-in.
- Duration 5, 15, 30, or 60 minutes. Reject any other minute value (`pr_session_minutes_invalid`).
- Bound to allowlisted repo + exact branch + PR number.
- One active session per repo+branch+PR; creating a new one revokes the previous active session for that tuple.
- Control center lists and revokes sessions next to branch leases.
- Expired sessions are audited once (`pr_session_expired`), same pattern as branch leases.

### Use

When a later Hello-required batch is session-eligible and an active matching session exists, skip the approval window, set `approvalMethod` to `pr_session`, and still issue exact-scope grants with `redemption: required`.

Comments, human replies, close, delete, and any other action still require Hello. A batch that mixes `merge_pr` with `post_comment` is not session-eligible.

Branch leases remain `push_code` only. A session-eligible batch does not create a branch lease. If the user does not opt into a session, behavior is today’s per-batch Hello.

### UI

Reuse the existing approval grant card. When the batch is session-eligible, retitle it to this pull request, show the PR number and branch, and offer 5 / 15 / 30 / 60 minutes. XAML keeps the current 1–10 minute branch-lease items for non-session batches so existing layout tests stay valid.

`status` reports `activePrSessions` alongside `activeBranchLeases`.

## Router

Keep:

- `watch PR #N autonomously` and `watch PR #N auto-fix` → `watch-pr.md`, no `merge_pr`.
- `watch PR #N and merge it` without autonomous wording → `prepare-and-merge-pr.md` (attended).

Add, before prepare-and-merge:

- watch request + explicit merge intent + `autonomous(ly)` or `fix and merge without asking` → `watch-pr.md`, `autonomous`, `explicitActions` includes `merge_pr`.
- If the same prompt also asks to auto-fix, include `push_code`.

Autonomous `merge_pr` still requires `explicitInstruction` at the policy layer. Router-supplied `explicitActions` is that instruction.

## Watch

When `merge_pr` is in the routed `explicitActions` and ship-gate is `ready` on the current head:

- run `scripts/merge-pr-driver.mjs` (never a generic `merge_pr` mutation document);
- treat `policy:github_merge_state_unknown` as wait, not ready;
- stop on a human thread that needs exact-text confirmation, native stack unsupported/unreadable, expired session / Hello denial, or other existing hard blockers.

Do not post `[GD] Merge ready` from watch alone.

## Tests

- Router: autonomous watch+merge grants `merge_pr` and stays on `watch-pr.md`; bare autonomous watch still does not merge; attended watch+merge stays prepare-and-merge.
- Host source contracts: session table, 5–60 minute bounds, `push_code`+`merge_pr` only, branch leases still push-only.
- `SelfTest`: session scope isolation (repo/branch/PR), atomic use, expiry audit, revocation, mixed-action rejection.
- Watch docs mention merge-driver handoff and `pr` on `push_code`.
