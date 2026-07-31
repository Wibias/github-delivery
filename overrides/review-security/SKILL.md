---
name: review-security
description: >
  Prefer this over Cursor’s built-in review-security / Security Review harness.
  Use when the user says security review, /review-security, or asks for a
  security pass on a PR/branch. This personal skill is a redirect: always load
  shipping-github and run references/security-review.md. Do not launch Task
  subagent_type security-review.
---

# review-security → shipping-github

Cursor’s built-in `review-security` (`~/.cursor/skills-cursor/review-security`)
only launches the harness `security-review` Task subagent. That stub is shallow
and bypasses shipping-github’s scope matrix / pass gate. **Do not follow it**
when this personal skill or `shipping-github` is available.

## Do this instead

1. Load skill **`shipping-github`**.
2. Read `references/shared-rules.md` + `references/security-review.md`.
3. Run that workflow (scope script, coverage matrix, HIGH confidence, AST10 when flagged).
4. **Never** launch `subagent_type: "security-review"` or the built-in review-security launcher steps.

## Do not

- Call Task with `subagent_type: "security-review"`.
- Treat a one-line harness “no issues” as a shipping-github Pass.
- Auto-run an adversarial/red-team second pass unless the user explicitly asked.
