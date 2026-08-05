# Create PR for issue → merge-ready

**Trigger:** “Create a pr for issue #N … merge ready, don’t merge”.

## Goal

Open **one** PR on the **canonical** (issue’s) repository that fixes issue `#N`, with verified bidirectional linking, self-assignment, review/CI cleanup, merge-ready. Do **not** merge. Do **not** batch other issues’ PRs unless the user explicitly demanded a batch.

## Workflow (single sequence)

### A. Need-to-fix preflight (required — report before coding)

Run a **research preflight** (same checks as `research-issue`, can be lighter) and **tell the user**:

1. Still needed on **latest development branch** tip?
2. Already fixed on development (cite SHA/PR)?
3. Open PR already covering this issue?
4. Obvious duplicate of another issue?

| Outcome | Action |
|---|---|
| Already fixed / shipped / fixed on development | **Do not create a PR.** Report evidence; offer release backport only if they ask |
| Open PR already exists | **Do not create a duplicate.** Link the PR; offer to watch/fix that PR instead |
| Duplicate issue | **Do not create a PR** on the duplicate; point at the canonical issue |
| Still needs fix | Continue to **B** |

If preflight is unclear, say what’s missing; do not open a speculative PR.

### A2. Issue conversation intake (required — before scoping or coding)

Follow shared **Issue conversation intake** (`references/shared-rules.md`). The issue body alone is not enough.

1. Read the full issue thread: body, **every comment** (paginate), labels, linked PRs, and timeline scope changes.
2. Extract `## Agent Brief`, maintainer clarifications, `[GD]` research notes, repro updates, screenshots in follow-ups, acceptance criteria, and out-of-scope boundaries.
3. If comments exist, do **not** implement from title/body alone.
4. Carry the extracted contract into preflight, implementation, PR body, and Spec review.

### B. Screenshot gate

1. Check the issue body **and comment thread** (and linked discussion) for author screenshots/images.
2. **If there are screenshots:** review them (read the images). If you cannot review them, **stop — do not create a PR**.
3. **If there are no screenshots:** continue.

### C. Confirm scope

Confirm this request is **one** issue (or an explicit batch). Otherwise pick/ask — do not open extra PRs. If implementation scope explodes → hand off to `split-to-prs`. Explicit create batch of **>3** issues → **subagent fan-out** (shared rules).

### D. Implement + open canonical PR

1. Resolve `owner/repo` from the **issue** (not from a fork remote you happen to be in). Always use `--repo OWNER/REPO`.
2. Base branch = that repo’s development/default as appropriate.
3. Push the head branch (upstream if you can; else fork head is OK for the head ref).
4. Load **`references/pr-description.md`**. Build the body from the issue and acceptance criteria, the actual current diff, and completed validation — not from the planned work or commit narration.
   Include scope clarifications from the full comment thread when they change or narrow the ask.
5. Create with UTF-8 **`--body-file`** (Windows-safe; shared encoding rules). The body must follow the PR-description policy and include same-repo `Fixes #N` on its own line:

   ```bash
   gh pr create --repo OWNER/REPO --base <base> --head <head> \
     --title "…" --body-file body.md
   ```

6. Confirm the PR URL is `https://github.com/OWNER/REPO/pull/…`. If it is fork-only (`https://github.com/<your-fork>/…`): **wrong** — close it and recreate against `OWNER/REPO`.

### E. Link + assign + opened comment

1. **PR → issue:** body contains `Fixes #N` or `Closes #N`.
2. Verify:

   ```bash
   gh pr view <pr> --repo OWNER/REPO --json number,url,body,closingIssuesReferences
   ```

   `closingIssuesReferences` must include issue `#N`. If empty: edit the PR body (UTF-8 file / PATCH), re-check.
3. **Assign yourself on the issue** (PR assignee alone does not count):

   ```bash
   gh issue edit N --repo OWNER/REPO --add-assignee @me
   ```

   If assign fails (permissions), report once and continue.
4. **One issue comment** (idempotent — edit if a prior `[GD] Opened PR` exists):

   ```markdown
   [GD] Opened PR #<pr> to address this.
   ```

5. Spot-check Development sidebar / linked PRs still point at the **canonical** PR.

### F. Make merge-ready (same bar as `fix-pr-bots`)

1. Keep branch up to date with base; resolve conflicts; **compile against tip**.
2. Review wait-loop: owners/maintainers + humans + bots; push; keep going until stable or hard blocker.
3. Fix CLI / project / **required CI** failures on this head (including pre-existing / “unrelated” required failures — shared rules); required CI green (`scripts/required-checks.mjs` when helpful).
4. **Own reviews (required):** **bug** via **`references/bug-review.md`**; **security** via **`references/security-review.md`** (never Cursor harness `security-review` / `review-security`); **Spec + Standards** (`review` skill or short pass); **proactive contract verification** (shared rules: wiring trace, operator smoke, test-honesty, docs-vs-non-goals, input-shape/evidence semantics, hot-path scale/determinism, malformed-input robustness). Checkout preflight still applies.
5. CODEOWNERS path check (`scripts/codeowners-for-pr.mjs` when helpful).
6. Changelog nudge if user-facing → `git-workflow-and-versioning` for authoring.
7. Final evidence sweep: reconcile the PR body with the final head using **`references/pr-description.md`**. Update stale scope, behavior, validation, review notes, or limitations and confirm the closing issue reference still resolves.
8. **Thin settle** (~3–5 min quiet + recheck; shared rules); then post merge-ready PR + linked-issue notify (idempotent). Do **not** merge. For a docs/markdown-only head, use the shared-rules **~30–60s** fast-path settle; if a bot review lands during the settle with findings on this diff, fix + push and re-enter the settle on the new head instead of burning the old window.

## Done when

- Exactly the requested PR count (default **one**); no surprise batch
- PR on **issue’s** repo (not fork-only)
- PR body is evidence-grounded, follows `references/pr-description.md`, and matches the final head
- `closingIssuesReferences` includes the issue; **issue** self-assigned when possible
- Single complete opened-PR comment (no duplicates/cut-offs)
- Screenshot gate passed (or N/A)
- Full issue comment thread read when comments exist (shared **Issue conversation intake**)
- Own bug + security + Spec/Standards done; reviews + required CI green on tip; merge-ready posted; **not** merged
