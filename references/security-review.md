# Security review

**Trigger:** “security review”, “security review on pr #N”, “security review on these issues”, “/review-security”, or **yes** after a research security ask.

## Goal

Run a focused security review on the named **PR(s) and/or issue area(s)**. Fix what can/should be fixed when a PR branch is in scope. When reviewing **issues**, post a **redacted** review on each issue and give the **full** findings (including abuse paths) **only in chat**.

Do **not** merge unless asked.

## Targets

| User said | Target |
|---|---|
| PR #N / current branch | Checkout PR head; run `security-review` subagent / `review-security` (`Diff: branch changes` unless uncommitted-only) |
| Issue(s) #N… (from research ask) | Review the implicated code paths on latest development tip (and any open covering PR). Post on **each** issue when the user asked to post |

## Public vs chat (mandatory)

Follow **Public security disclosure** in `shared-rules.md`.

**Chat (to the user):** full findings — severity, affected code, impact, and how it could be abused / repro steps if needed for fixing.

**GitHub (issue or PR comment):** redacted. Include severity, high-level category, affected area/component, that a fix is needed / recommended next step. **Omit** exploit steps, payloads, exact bypass recipes, secret values, and anything that teaches abuse.

If a finding is vulnerability/policy-sensitive and hard to summarize safely, public comment may say only:

```markdown
## [shipping-github] Security review

**Severity:** <critical|high|medium|low>
**Area:** <component / authz / tokens / …>
**Summary:** Security-sensitive finding — details shared privately with maintainers.
**Next:** <patch / needs maintainer review / covered by PR #…>
```

…and put the rest in chat only.

## Steps

1. Resolve targets (PR and/or issues). Checkout the right branch when fixing or diff-reviewing a PR.
2. Run the security review (subagent / `review-security` when a PR/branch diff applies; for issue-only, review implicated paths on development tip).
3. Split output: **full → chat**, **redacted → GitHub** when posting was requested (default after research “yes”).
4. If a PR is in scope: triage findings; fix necessary/useful issues in that PR; push; recheck CI as needed. Do not paste exploit detail into PR review bodies — use redacted request-changes / comments; details in chat.
5. Summarize in chat: critical / worth-fixing / skipped, what was posted publicly, what was withheld.

## Done when

- Security review ran for the agreed targets
- User has full detail in chat
- Public posts (if any) are redacted per shared rules
- Necessary in-PR fixes landed or declined with rationale
