# Security review

**Trigger:** “security review”, “security review on pr #N”, “/review-security” in a PR/ship context.

## Goal

Run a focused security review on the PR (or current branch) via the `security-review` subagent / `review-security` helper. Fix what can and should be fixed in this PR. Skip 0.1% nits. Do **not** merge unless asked.

## Steps

1. Resolve target: PR `#N` if given, else the open PR for the current branch. Checkout the PR head when needed (same rules as `review-security`).
2. Follow `review-security`: launch exactly one `security-review` subagent (`Diff: branch changes` unless the user asked for uncommitted only).
3. Triage findings (shared rules): fix necessary/useful issues in this PR; decline the rest with rationale.
4. Push fixes if any; recheck CI as needed.
5. Summarize: critical / worth-fixing / skipped, and whether changes were requested on GitHub (only for real remaining blockers).

## Done when

- Security subagent ran
- Necessary fixes landed or declined with rationale
- Short summary posted to the user (PR comment optional unless they asked)
