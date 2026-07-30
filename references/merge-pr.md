# Merge PR

**Trigger:** “merge pr #N”, “merge it”, “ship pr #N”.

## Goal

Merge PR `#N` after readiness checks, comment why it’s useful, `@thanks` the PR author when they aren’t you, then close out linked issues with a short thanks on the issue.

## Preflight (abort merge if failing)

- Not draft / WIP / do-not-merge (shared gates)
- Not conflicted; not behind base (update first per shared rules)
- Required CI green (non-required: note; ask if unclear)
- No unresolved necessary owner/maintainer (or other human) blockers you agree with

If preflight fails, do **not** merge; report blockers.

## Self-merge (no self-thanks on the PR)

Compare PR author login to the authenticated GitHub user (`gh api user --jq .login`).

- **Author is someone else:** `@thanks` them in the PR merge comment.
- **Author is you:** no `@` / thanks on the PR — why-it-helps only, then merge.

## Steps

1. Load PR `#N`: author, title, body, labels, draft state, linked issues, diff summary, CI, reviews. Resolve self-merge. Apply security-offer / changelog nudge if not already handled this session.
2. Run preflight (including behind-base update if needed). Enforce git safety (no force-push; stop if dirty unrelated / push rejected).
3. Post a short PR comment **before** merge (user-facing thanks are from you — no `[shipping-github]` prefix on ceremonial merge thanks):

**Others’ PRs:**

```markdown
Thanks @{author} — merging this.

Why it helps: <1–2 sentences on the concrete bugfix/value>

Ship it.
```

**Your own PRs:**

```markdown
Merging this.

Why it helps: <1–2 sentences on the concrete bugfix/value>
```

4. Merge with the repo’s normal strategy (`gh pr merge` — prefer repo default; squash only if that’s the norm or user asked).
5. **Linked issues — thank + close:**
   - For each linked/fixed issue (`Fixes`/`Closes`/`Resolves`, or clearly linked):
     - Comment on the **issue** (not only the PR):

       ```markdown
       Thanks @{issue_author} — this is fixed by PR #{n} by <short what the fix did>.
       ```

     - If `@{issue_author}` is **you**, omit the thanks/`@` line; use:

       ```markdown
       Fixed by PR #{n} by <short what the fix did>.
       ```
     - If the issue is still open (PR didn’t auto-close), close it with a reason pointing at the PR — unless the issue should stay open (tracking epic, partial fix); then say so and leave it open.
6. Confirm merge (+ issue state); report URLs.

## Done when

- Why-good PR comment posted; PR `@thanks` only when author ≠ you
- PR merged (or blockers reported with no merge)
- Linked issues thanked (no self-thanks) and closed when appropriate
