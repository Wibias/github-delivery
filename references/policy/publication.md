# Publication Policy

Canonical rules for durable GitHub communication and its verification.

### GD-PUB-001 — Publish to the correct surface

Issue conversation belongs on issue comments; PR conversation belongs on PR conversation comments; inline diff feedback must receive an inline-thread reply; approve/request-changes/comment-as-review uses a review. Do not substitute one surface for another.

### GD-PUB-002 — Repair the current publication identity first

For run-identified publications, check the exact current run marker first. Repair an owned malformed/incomplete marker; reuse it when complete instead of posting a duplicate.

### GD-PUB-003 — Enforce same-head anti-noise

For full-review verdicts on the same head, do not post another top-level verdict when the strict label/TLDR has no material delta. Reuse the completed same-head verdict; wording-only changes are not material.

### GD-PUB-004 — Deliver every verdict; verify authorized publication

Every full review delivers its final verdict. A bare/read-only review delivers it in chat and publishes nothing. GitHub verdict publication requires explicit routed user intent; when authorized, `verify-verdict-published.mjs` must report `published: true` and `format.valid: true`. Never self-elevate the routed mode to gain publication authority. Blockers change the verdict, not the delivery requirement; only explicit user cancellation permits omitting it.

### GD-PUB-005 — Make social publication idempotent

Use stable publication/run/idempotency identities and remote read-before-write evidence. Editing another run's completed marker to impersonate a new run is forbidden.

### GD-PUB-006 — Merge before posting success thanks

Do not post a durable “merged/success” thank-you before the expected-head-pinned merge succeeds. A failed merge must not leave a misleading success comment.

### GD-PUB-007 — Preserve linked-issue thanks and close semantics

When a merge closes linked issues, thank relevant issue authors without self-thanks and verify the issue close state/linkage. Do not skip linked-issue close-out merely because the PR merge succeeded.

### GD-PUB-008 — Keep sensitive exploit detail out of public comments

Public security communication should be useful but redacted. Do not publish secrets or unnecessarily actionable exploit chains when the private user conversation is the safer surface.

### GD-PUB-009 — Keep durable GitHub prose concrete

Before publishing prose authored by `github-delivery`, apply `references/prose-quality.md`. Preserve exact evidence, required template structure, GitHub syntax, security redaction, and user-confirmed wording. Style cleanup must never turn `unknown`, `not run`, `blocked`, or another evidence state into a stronger claim.

### GD-PUB-010 — Audit completion claims against current evidence

Before publishing a final verdict, merge-ready statement, review-coverage statement, migration-complete statement, or another durable completion report, apply `references/completion-claims.md`. Reuse the governing workflow's authoritative evidence and freshness rules rather than a parallel ledger. Material numeric claims must be measured from the current result, head-bound claims must name or derive from the authoritative current SHA, and partial/unknown/blocked/not-run evidence must remain visible instead of being strengthened by summary prose.
