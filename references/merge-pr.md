# Merge PR

**Trigger:** “merge pr #N”, “merge pr #A and #B”, “merge it”, “ship pr #N”.

## Goal

Merge PR `#N` after readiness checks, comment why it’s useful, `@thanks` the PR author when they aren’t you, then **always** thank the **issue creator(s)** on each linked/fixed issue (when they aren’t you) and close out those issues.

**Never** run `gh pr merge` alone. Ceremony (PR why-comment → merge → issue thank(+close)) is part of merge — skipping issue thanks is a failed merge workflow even if GitHub closed the issue via `Fixes`.

## Targets

- Default: one PR.
- Several PRs (“merge 775 and 778”): run **this whole file for each PR** (preflight → PR comment → merge → **linked-issue thanks** → cleanup). Report a per-PR table. ≤3 in-parent OK; **>3 → subagent fan-out** (shared rules), each subagent must still do issue thanks.

## Preflight (abort merge if failing)

- Not draft / WIP / do-not-merge (shared gates)
- Not conflicted; not behind base; **compiles/tests against current tip** (update + verify first per shared rules)
- Required CI green on **current** SHA (shared **Required checks + review gate**; non-required: note; ask if unclear)
- `reviewDecision` / CODEOWNERS (**when enforced**) / required reviewers / **required labels** not blocking
- Unresolved review threads cleared (`scripts/review-threads.mjs`) when conversation resolution or useful threads remain
- Approvals fresh on **head SHA** when dismiss-stale / last-push-approval is on (`scripts/pr-policy-gate.mjs`)
- No unresolved necessary owner/maintainer (or other human) blockers you agree with
- **Own reviews evidence:** a prior `[shipping-github] Merge ready` / full-review `approve-comment` this session, **or** run abbreviated bug+security+spec now, **or** warn and get explicit “merge anyway”
- **Not mid-stack for trunk:** if base is another open PR head, abort and hand off to `manage-stacked-prs` (merge bottom-up). Do not `gh pr merge` into a parent feature branch thinking it shipped to trunk.
- Fork head: only merge if fixes are already on the head (or you could push); do not merge knowing required fixes were skipped for lack of push access
- **PR body** still contains `Fixes #N` when squash-merging (trailers lost on squash)
- **Merge queue:** if enabled/in-queue, prefer queue merge and wait until **merged** (not merely enqueued); warn on missing `merge_group` workflow triggers

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

4. Merge with the repo’s normal strategy (`gh pr merge` — prefer repo default; squash only if that’s the norm or user asked). Prefer deleting the head branch when the repo/UI option allows and the branch is not long-lived.
5. **Linked issues — thank + auto-close (required):**
   - Resolve links via `closingIssuesReferences` **and** `Fixes`/`Closes`/`Resolves #N` in the PR body. If both empty: say so in chat; still do PR ceremony.
   - Prefer that the PR already uses closing keywords so GitHub auto-closes on merge.
   - **After merge, for each linked/fixed issue** (do this even when GitHub already closed the issue):
     - Load `gh issue view N --json author,state`.
     - Comment on the **issue** (UTF-8 `--body-file`):

       ```markdown
       Thanks @{issue_author} — this is fixed by PR #{n} by <short what the fix did>.
       ```

     - If you are the issue author: omit thanks/`@`; use `Fixed by PR #{n} by <short what>.`
     - If the issue is **still open** after merge (missing closing keyword, partial fix, epic): close it pointing at the PR when the fix is complete; if it should stay open, say why and leave it open.
   - **Do not** treat auto-close as “thanks done.” Auto-close ≠ issue thank comment.
   - PR author was already thanked (or skipped if self) in step 3 — that is the PR-side thanks only.
6. **Post-merge cleanup** (shared rules): confirm merged; confirm issues closed; confirm **issue thank comments posted**; delete same-repo head branch when safe; if this was a stack parent → `manage-stacked-prs` to retarget/restack children **before** deleting the parent branch.
7. If a release tag / semver / changelog authoring is needed next: hand off to `git-workflow-and-versioning` (ask once).
8. If the feature branch/worktree should be cleaned up: hand off to `finishing-a-development-branch`.
9. Confirm merge (+ issue state + branch deleted?); report URLs.

## Done when

- Why-good PR comment posted; PR `@thanks` only when author ≠ you
- PR merged (or blockers reported with no merge)
- **Every** linked/fixed issue has a thank (or self “Fixed by…”) comment — **even if** GitHub already auto-closed it. Missing issue thank = workflow incomplete; go post it before reporting done
- Linked issues **closed** when the fix is complete (auto-close via `Fixes`/`Closes` and/or explicit close)
- Post-merge cleanup done or explicitly skipped with reason (kept branch / stack handoff)
- Multi-PR asks: every PR in the list reached this bar (or a hard blocker row)
