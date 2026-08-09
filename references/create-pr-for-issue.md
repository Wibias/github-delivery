<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- evidence
- git
- ci
- reviews
- issues
- publication
- stacks (when stack topology is detected)
<!-- policy-modules:end -->

# Create PR for issue → merge-ready

**Trigger:** “Create a pr for issue #N … merge ready, don’t merge”.

## Goal

Open **one** PR on the **canonical** (issue’s) repository that fixes issue `#N`, with verified bidirectional linking, self-assignment, review/CI cleanup, merge-ready. **Run the pre-open bug + security gate before opening** and only open when the gate permits. Do **not** merge. Do **not** batch other issues’ PRs unless the user explicitly demanded a batch.

Every network-visible write in this workflow is brokered. Do not use bare `git push`, `gh pr create`, mutating `gh pr edit`, or `gh issue edit`. Use `scripts/github-mutate.mjs` with an exact lifecycle action and trusted authority where required.

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

### C2. Pre-open bug + security gate (required — before coding or opening)

Run the **bug-finding** and **security review** passes on the code that will go into this PR **before opening it**. Do **not** open a PR while the gate is blocked or unknown.

1. Run the gate on the branch diff (base → head):
   ```bash
   node "<github-delivery>/scripts/pre-open-gate.mjs" OWNER/REPO <base> <head>
   ```
2. If `decision: "ready"` → no required bug/security scope (docs-only or clean); proceed to **D**.
3. If `decision: "blocked"` → the diff has required bug lenses and/or security surfaces. Run the **bug axis** via **`references/bug-review.md`** and the **security axis** via **`references/security-review.md`** on the **branch diff** (not a PR head). Fix Confirmed High/Critical findings (and useful Mediums) **before** opening. Only proceed when:
   - every required lens/surface is `done` or honestly `n/a (why)`, and
   - no Confirmed High/Critical remains open.
   Rerun the gate after fixes to confirm the diff shape is what you reviewed; the exit code stays `blocked` for any logic-bearing diff unless you pass `--evidence-file` recording the completed lens/surface statuses. Clearance is the recorded `done`/`n/a` evidence you produce in the passes above — carry that evidence (not the bare exit code) forward as proof the blockers were addressed.
4. If `decision: "unknown"` → **stop**. Restore complete branch evidence (fetch base, checkout head, resolve missing patches) and rerun. **Never open a PR from an incomplete diff.**
5. Record the gate result (decision + blockers cleared) in chat and carry it into the PR body validation notes.

### D. Implement + open canonical PR

1. Resolve `OWNER/REPO` from the **issue** (not from a fork remote you happen to be in).
2. Base branch = that repo’s development/default as appropriate.
3. Resolve the exact local commit to publish (`NEW_TIP`) and the remote branch generation. Use `expectedRemoteTip: "absent"` for a new branch; otherwise record the exact current remote SHA. Build a `push_code` request. For a new branch:

   ```json
   {
     "schemaVersion": 1,
     "action": "push_code",
     "mutationMode": "maintainer",
     "explicitInstruction": true,
     "repo": "OWNER/REPO",
     "remote": "origin",
     "branch": "feature/head",
     "expectedRemoteTip": "absent",
     "newTip": "NEW_TIP",
     "forceWithLease": false
   }
   ```

   Plan, authorize, then execute it through `scripts/github-mutate.mjs`. Existing-branch updates use the exact observed remote SHA. Rewrites set `forceWithLease: true` only when the selected workflow explicitly permits rewriting that branch.
4. Load **`references/pr-description.md`**. Build the body from the issue and acceptance criteria, the actual current diff, and completed validation — not from planned work or commit narration. Include scope clarifications from the full comment thread when they change or narrow the ask.
5. Create the canonical PR through broker action `create_pr`. The request must bind exact base/head/title/body plus a stable idempotency key; same-repo linkage must include `Fixes #N` on its own line:

   ```json
   {
     "schemaVersion": 1,
     "action": "create_pr",
     "mutationMode": "maintainer",
     "explicitInstruction": true,
     "repo": "OWNER/REPO",
     "base": "main",
     "head": "feature/head",
     "draft": false,
     "idempotencyKey": "create-pr-for-issue-N",
     "title": "…",
     "body": "…\n\nFixes #N"
   }
   ```

   The broker adds a hidden idempotency marker, does remote read-before-write, and verifies the created PR by that marker. Do not substitute bare `gh pr create`.
6. Confirm the returned PR URL is `https://github.com/OWNER/REPO/pull/…`. If topology is wrong, stop and use the separately authorized close/recreate sequence; do not silently mutate a different repository.

### E. Link + assign + opened comment

1. **PR → issue:** body contains `Fixes #N` or `Closes #N`.
2. Verify read-only with `gh pr view <pr> --repo OWNER/REPO --json number,url,body,closingIssuesReferences`. `closingIssuesReferences` must include issue `#N`.
3. If linkage is missing, rebuild the correct exact body and use broker action `update_pr_body` bound to the PR's current `expectedHead`. Re-read `closingIssuesReferences` afterwards. Do not use a bare mutating PR edit/PATCH.
4. **Assign yourself on the issue** using broker action `assign_issue` with the exact issue and assignee login. If assignment is denied by GitHub permissions, report once and continue; never bypass the broker.
5. **One issue comment** through existing idempotent broker action `post_issue_comment`:

   ```markdown
   [GD] Opened PR #<pr> to address this.
   ```

6. Spot-check Development sidebar / linked PRs still point at the **canonical** PR.

### F. Make merge-ready (same bar as `fix-pr-bots`)

1. Keep branch up to date with base; resolve conflicts; **compile against tip**. Every remote branch update goes through `push_code`; local Git operations remain subject to `references/policy/git.md`.
2. Review wait-loop: owners/maintainers + humans + bots; push through the broker when fixes change the head; keep going until stable or hard blocker.
3. Fix CLI / project / **required CI** failures on this head (including pre-existing / “unrelated” required failures — shared rules); required CI green (`scripts/required-checks.mjs` when helpful).
4. **Own reviews (required):** **bug** via **`references/bug-review.md`**; **security** via **`references/security-review.md`** (never Cursor harness `security-review` / `review-security`); **Spec + Standards** (`review` skill or short pass); **proactive contract verification** (shared rules: wiring trace, operator smoke, test-honesty, docs-vs-non-goals, input-shape/evidence semantics, hot-path scale/determinism, malformed-input robustness). Checkout preflight still applies.
5. CODEOWNERS path check (`scripts/codeowners-for-pr.mjs` when helpful).
6. Changelog nudge if user-facing → `git-workflow-and-versioning` for authoring.
7. Final evidence sweep: reconcile the PR body with the final head using **`references/pr-description.md`**. Update stale scope, behavior, validation, review notes, or limitations through `update_pr_body` and confirm the closing issue reference still resolves.
8. **Thin settle** (~3–5 min quiet + recheck; shared rules); then post merge-ready PR + linked-issue notify through the broker. Do **not** merge. For a docs/markdown-only head, use the shared-rules **~30–60s** fast-path settle; if a bot review lands during the settle with findings on this diff, fix + broker the new head and re-enter the settle instead of burning the old window.

## Done when

- Exactly the requested PR count (default **one**); no surprise batch
- PR on **issue’s** repo (not fork-only)
- Every network-visible write used the broker and any high-assurance write redeemed trusted authority
- PR body is evidence-grounded, follows `references/pr-description.md`, and matches the final head
- `closingIssuesReferences` includes the issue; **issue** self-assigned when possible
- Single complete opened-PR comment (no duplicates/cut-offs)
- Screenshot gate passed (or N/A)
- Full issue comment thread read when comments exist (shared **Issue conversation intake**)
- **Pre-open bug + security gate** passed (decision `ready`, or `blocked` fully reviewed + Confirmed High/Critical fixed before opening)
- Own bug + security + Spec/Standards done; reviews + required CI green on tip; merge-ready posted; **not** merged
