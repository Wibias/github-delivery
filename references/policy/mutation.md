# Mutation Policy

Canonical rules for GitHub writes. `scripts/lib/mutation-policy.mjs` and `scripts/lib/github-mutation-broker.mjs` remain the executable authority.

### GD-AUTH-001 — Default to read-only

Default mutation mode is read-only. `read-only`, `review`, `maintainer`, and `autonomous` are upper-bound profiles, not waivers. A workflow may use only the mode selected by routing and allowed by its contract.

### GD-AUTH-002 — Authorize every external write

Creating or editing issues/PRs, labels, assignments, comments, reviews, thread state, draft state, reviewers, merges, closures, follow-ups, or remote branches is an external mutation and must be authorized before execution.

### GD-AUTH-003 — Maintainer lifecycle actions require direct instruction

Maintainer-grade state changes such as merge, close, supersede, reviewer changes, ordinary human-thread resolution, or branch deletion require the direct user instruction required by the selected mutation profile. Do not infer publication authority from adjacent work.

### GD-AUTH-004 — Human replies require exact-text confirmation

Human replies always require exact-text confirmation. The approved visible body must match its SHA-256 binding; autonomous mode does not waive this rule.

### GD-AUTH-005 — Caller assertions are not trusted provenance

`mutationMode`, `explicitInstruction`, and `exactTextConfirmed` supplied by the caller are policy assertions, not independently authenticated user consent. Only a verified host-issued authority grant may be reported as `trusted_grant`; fake caller fields such as `source: user` or `trusted: true` confer no authority.

### GD-AUTH-006 — Social writes are remotely idempotent

Social create operations require a stable idempotency key and remote read-before-write evidence. If idempotency lookup is unreadable, fail closed instead of risking a duplicate durable write.

### GD-AUTH-007 — Use the mutation broker

Network-visible GitHub writes owned by this skill go through `scripts/github-mutate.mjs` / `github-mutation-broker.mjs`, not ad-hoc bare `gh` mutation commands. Local Git writes remain subject to `GD-GIT-*`.

### GD-AUTH-008 — Bind PR mutations to the expected head

Every PR mutation that can become stale must carry the expected PR head and re-read it immediately before execution. Merge requests must retain expected-head pinning through GitHub's merge API/CLI boundary.

### GD-AUTH-009 — Trusted grants bind the exact mutation effect

Algorithm-agile trusted grants must bind a deterministic `scopeSha256` to every semantically relevant mutation input, including repository, action, mutation mode, PR head, merge method, concrete targets, stable idempotency keys, and SHA-256 hashes of human-visible text. Batch approvals are ordered and finite; they do not confer wildcard or session authority.

### GD-AUTH-010 — Redemption-required grants are one-time

When a trusted grant declares `redemption: required`, the mutation path must redeem its nonce with the trusted issuer after fresh-head/target/idempotency preflight and immediately before spawning the exact planned GitHub write. A consumed nonce is never automatically reopened after a crash or downstream failure.
