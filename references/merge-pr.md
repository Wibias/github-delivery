# Merge PR

**Trigger:** “merge pr #N”, “merge it”, “ship pr #N”.

## Goal

Merge PR `#N` after readiness checks, comment why it’s useful, `@thanks` the PR author when they aren’t you, then close out linked issues with a short thanks on the issue.

## Preflight (abort merge if failing)

- Not draft / WIP / do-not-merge (shared gates)
- Not conflicted; not behind base; **compiles/tests against current tip** (update + verify first per shared rules)
- Required CI green on **current** SHA (shared **Required checks + review gate**; non-required: note; ask if unclear)
- `reviewDecision` / CODEOWNERS / required reviewers not blocking
- No unresolved necessary owner/maintainer (or other human) blockers you agree with
- **Not mid-stack for trunk:** if base is another open PR head, abort and hand off to `manage-stacked-prs` (merge bottom-up). Do not `gh pr merge` into a parent feature branch thinking it shipped to trunk.
- Fork head: only merge if fixes are already on the head (or you could push); do not merge knowing required fixes were skipped for lack of push access

If preflight fails, do **not** merge; report blockers.

## Self-merge (no self-thanks on the PR)

Compare PR author login to the authenticated GitHub user (`gh api user --jq .login`).

- **Author is someone else:** `@thanks` them in the PR merge comment.
- **Author is you:** no `@` / thanks on the PR — why-it-helps only, then merge.

## Steps

1. Load PR `#N`: author, title, body, labels, draft state, linked issues, diff summary, CI, reviews, stack/fork flags. Resolve self-merge. Apply security-offer / changelog nudge if not already handled this session.
2. Run preflight (behind-base update + compile-against-tip + required-checks/review gate + stack check). Enforce git safety (no force-push; stop if dirty unrelated / push rejected / fork-head unwritable when fixes needed).
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
5. **Linked issues — thank + auto-close:**
   - Prefer that the PR already uses `Fixes`/`Closes`/`Resolves #N` so GitHub auto-closes on merge.
   - For each linked/fixed issue:
     - Comment on the **issue**:

       ```markdown
       Thanks @{issue_author} — this is fixed by PR #{n} by <short what the fix did>.
       ```

     - If you are the issue author: omit thanks/`@`; use `Fixed by PR #{n} by <short what>.`
     - If the issue is **still open** after merge (missing closing keyword, partial fix, epic): close it pointing at the PR when the fix is complete; if it should stay open, say why and leave it open.
   - PR author was already thanked (or skipped if self) in step 3 — that is the PR-side thanks.
6. Confirm merge (+ issue state); report URLs.

## Done when

- Why-good PR comment posted; PR `@thanks` only when author ≠ you
- PR merged (or blockers reported with no merge)
- Linked issues thanked (no self-thanks) and **closed** when the fix is complete (auto-close via `Fixes`/`Closes` and/or explicit close)
