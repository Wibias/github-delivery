# Publication Policy

Canonical rules for where/how durable GitHub communication is published and verified.

### GD-PUB-001 — Publish to the correct surface

Issue conversation belongs on issue comments; PR conversation belongs on PR conversation comments; inline diff feedback must receive an inline-thread reply; approve/request-changes/comment-as-review uses a review. Do not substitute one surface for another.

### GD-PUB-002 — Repair the current publication identity first

For run-identified publications, the exact current run marker is checked first. If that publication exists but is incomplete/malformed, edit that owned current-run comment; if complete, reuse it rather than posting a duplicate.

### GD-PUB-003 — Enforce same-head anti-noise

For full-review verdicts on the exact same head, do not post a second top-level verdict when the strict verdict label and required TLDR values have no material delta. Reuse the completed same-head verdict; wording-only changes are not material.

### GD-PUB-004 — Verify verdict identity and format

`verify-verdict-published.mjs` is the normal completion proof for full review. `published: true` plus `format.valid: true` is required; a self-selected stricter mutation mode is not publication unavailability. A blocker changes the verdict; it does not authorize omitting the verdict. Only explicit user cancellation permits ending a required full-review run without its final verdict.

### GD-PUB-005 — Make social publication idempotent

Use stable publication/run/idempotency identities and remote read-before-write evidence. Editing another run's completed marker to impersonate a new run is forbidden.

### GD-PUB-006 — Merge before posting success thanks

Do not post a durable “merged/success” thank-you before the expected-head-pinned merge succeeds. A failed merge must not leave a misleading success comment.

### GD-PUB-007 — Preserve linked-issue thanks and close semantics

When a merge closes linked issues, thank relevant issue authors without self-thanks and verify the issue close state/linkage. Do not skip linked-issue close-out merely because the PR merge succeeded.

### GD-PUB-008 — Keep sensitive exploit detail out of public comments

Public security communication should be useful but redacted. Do not publish secrets or unnecessarily actionable exploit chains when the private user conversation is the safer surface.

### GD-PUB-009 - Keep durable GitHub prose concrete

Before publishing prose authored by `github-delivery`, apply `references/prose-quality.md`. Preserve exact evidence, required template structure, GitHub syntax, security redaction, and user-confirmed wording. Style cleanup must never turn `unknown`, `not run`, `blocked`, or another evidence state into a stronger claim.
