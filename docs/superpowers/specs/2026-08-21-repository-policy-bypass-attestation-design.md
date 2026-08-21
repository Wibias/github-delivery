# Repository policy bypass attestation

## Status

Approved 2026-08-21. Fixes GD-AUDIT-050 only. Branch from current `origin/main`. Do not bundle 071, 072, 051, 058 follow-ups, or docs-package work.

## Problem

Checked-in policy already forbids ruleset bypass actors (`rulesets.allowBypassActors: false`). The live verifier already fails when it *sees* `current_user_can_bypass` other than `never`, including `pull_requests_only`.

Scheduled Repository Policy CI still greens while Protect main keeps Admin `pull_request` bypass. Two holes make that possible:

1. `scripts/verify-live-repository-policy.mjs` always sets `activeRulesetsComplete: true` after a successful GET. Empty `bypass_actors: []` plus a missing or filtered `current_user_can_bypass` is treated as “no bypass.”
2. The workflow uses `github.token` (`contents: read`). That identity is `github-actions[bot]`. GitHub then reports `current_user_can_bypass: "never"` and often an empty bypass-actor list even when an Admin bypass exists. Empty arrays are not proof the list is complete.

A local `gh` run as a repo admin would already see `pull_requests_only` and fail. The scheduled job never uses that principal, so it cannot attest the policy.

This is a scheduled-policy false green, not a ship-gate READY path.

## Goals

1. When policy forbids bypass actors, missing bypass fields are incomplete, not a pass.
2. `pull_requests_only` and `always` stay failures.
3. `github-actions[bot]` and any reader without repository admin cannot attest “no bypass.” Empty `bypass_actors` from that reader is incomplete.
4. An admin-capable reader with `current_user_can_bypass: "never"` and empty `bypass_actors` remains a real pass.

## Non-goals

- No ship-gate, merge-boundary, or native-stack changes (058/071/072).
- No Windows `npm run check` fix (051).
- This change does not itself remove Admin bypass from GitHub. After it lands, live policy CI stays red until a privileged token is configured **and** Admin `pull_request` bypass is gone (or proven absent by that token).

## Privileged reader

A live payload can attest bypass only when **both** are true:

- `viewer.login` is not `github-actions[bot]` (case-insensitive). Missing viewer is allowed if admin is proven below.
- `repository.permissions.admin === true` from the authenticated REST repository payload.

Otherwise the reader cannot attest. Reuse error code `ruleset_bypass_evidence_incomplete`.

## Completeness

When `allowBypassActors === false`, evidence is complete only when:

- `live.activeRulesetsComplete === true`
- `activeRulesets` is a non-empty array
- every ruleset has `bypass_actors` as an array (empty array allowed)
- every ruleset has `current_user_can_bypass` as one of `never`, `always`, `pull_requests_only` (case-insensitive)
- the reader can attest (previous section)

Missing key, non-array `bypass_actors`, missing/unknown `current_user_can_bypass`, or empty `activeRulesets` is incomplete.

## Fetcher

`scripts/verify-live-repository-policy.mjs`:

- Fetch `GET /user` as `viewer` (null if the call fails).
- Set `activeRulesetsComplete` from field completeness, never a hardcoded `true`.
- Pass `viewer` and the existing REST `repository` object (includes `permissions`) into the evaluator.

`.github/workflows/repository-policy.yml` uses `secrets.REPOSITORY_POLICY_TOKEN || github.token`. Default `github.token` remains insufficient and must fail closed. The secret is a repo-admin token that can read ruleset bypass actors.

## Tests

`tests/unit/workflow-security.test.mjs`:

- No admin permission + `never` + empty `bypass_actors` → incomplete (Actions-token false-green)
- `github-actions[bot]` even with `permissions.admin: true` → incomplete
- Admin reader + missing `current_user_can_bypass` → incomplete
- Admin reader + missing `bypass_actors` key → incomplete
- Admin reader + empty rulesets / `activeRulesetsComplete: false` → incomplete (existing case stays)
- Admin reader + `pull_requests_only` → `current_user_can_bypass_ruleset`
- Admin reader + `never` + empty `bypass_actors` → valid
- Existing actor-present case stays

Happy-path `matchingLive()` must include `repository.permissions.admin: true` so existing valid cases remain valid.

`tests/unit/actions-usage-contract.test.mjs`: workflow `GH_TOKEN` prefers `secrets.REPOSITORY_POLICY_TOKEN`.

## Docs

`docs/repository-security.md`: live verify requires a token with repository admin so bypass actors are visible. Default Actions `GITHUB_TOKEN` cannot attest that policy.
