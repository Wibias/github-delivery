---
name: review-security
description: >
  Compatibility redirect for /review-security or requests for a security review
  of a GitHub PR or branch. Routes to github-delivery; not a standalone security
  review workflow.
---

# review-security → github-delivery

Cursor’s built-in `review-security` (`~/.cursor/skills-cursor/review-security`)
only launches the harness `security-review` Task subagent. That stub is shallow
and bypasses github-delivery’s scope matrix / pass gate. **Do not follow it**
when this personal skill or `github-delivery` is available.

## Do this instead

1. Load skill **`github-delivery`**.
2. Load `github-delivery` `SKILL.md` and `references/security-review.md` (policy modules are declared in the workflow).
3. Run that workflow (scope script, coverage matrix, HIGH confidence, AST10 when flagged).
4. **Never** launch `subagent_type: "security-review"` or the built-in review-security launcher steps.

## Do not

- Call Task with `subagent_type: "security-review"`.
- Treat a one-line harness “no issues” as a github-delivery Pass.
- Auto-run an adversarial/red-team second pass unless the user explicitly asked.
