# Full review PR

**Trigger:** “full review on pr #N…”, “bug + security review + rabbit/codex + verdict”, “is this PR useful?”, a list of existing PRs to full-review, or an explicit “full review + simplify” request.

## Goal

Same babysit bar as **make merge-ready**: clear useful human + bot comments, own bug + security + **spec/standards**, fix in-PR, **required CI green**, then a **verdict** comment (usefulness included). Do **not** merge unless asked.

**Keep going on each targeted PR** until that bar (or a **hard blocker**). Soft opinions are not stop conditions.

Skip 0.1% nits. No follow-up PR for in-scope fixes.

A normal full review does not simplify code merely because an opportunity is visible. Run the optional simplify phase only when the user **explicitly asks** for simplify, cleanup, deduplication, or equivalent behavior-preserving refactoring.

## Targets

- Default: one PR.
- If the user lists several existing PRs: full-review **each** to the same bar; report a per-PR table when done. Do not abandon the batch because one PR is opinion-gated.
- **>3 PRs:** fan out with **subagents** (shared **Multi-PR fan-out**) — one PR per subagent in parallel (chunk if rate-limited). Do not serialize 4+ in the parent.

## Verdict labels (strict)

| Label | When allowed |
|---|---|
| `approve-comment` | Useful; bots/humans clear; own reviews + spec/standards clean; up to date with base; **compiles against tip**; **required CI green**; protection/`reviewDecision`/CODEOWNERS clear; not mid-stack-for-trunk; no draft/WIP gate; **thin settle** done |
| `changes-requested` | Concrete necessary blockers remain that you cannot/should not silently fix |
| `not-useful` | Usefulness pass failed — stop expanding work on that PR |
| `gated` | **Only** GitHub draft / WIP / do-not-merge (shared draft gates). **Not** “wants maintainer ack”, “security feels sensitive”, or “Windows looks flaky” |

**Forbidden stop excuses** (report in chat if relevant, but **keep fixing CI + comments**):

- “Needs maintainer security ack” / “should get human OK first”
- “Security relevance possible” without a concrete unfixed finding
- Treating shared/infra CI noise as done while **this PR’s** required checks are still red (classify + flake retries per shared rules; if budget exhausted → hard-blocker row, not a fake `gated`)
- Skipping a required CI failure as “unrelated / introduced elsewhere” instead of a minimal harden/fix (shared scope lock)

## Steps

1. Identify PR(s); checkout head (subagent preflight); note base, linked issues, draft/WIP gates. If draft and user wanted green/merge-ready: ask once about **Draft → ready**.
2. Usefulness pass: real bug / claimed value? If not → `not-useful` verdict and stop that PR only.
3. Parallel where useful: **Bug** via **`references/bug-review.md`** (scope → Bugbot when Cursor → complementary). On Cursor, use that file's literal `review-bugbot` prompt contract; do not construct or paraphrase a replacement prompt in this workflow. **Security** via **`references/security-review.md`** (never Cursor harness `security-review` / `review-security`). Run **Spec + Standards** through the bundled **`references/spec-standards-review.md`** method. It owns the fixed comparison, source discovery, two independent axes, and advisory `references/code-smells.md` baseline; do not depend on an optional external review skill.
4. Triage open human + bot comments (shared rules — owners/maintainers first). Fix useful; decline nits with rationale. Inline replies in-thread only.
5. Push fixes; update from base if behind; **verify compile/tests against tip**; **wait and recheck** until useful threads quiet **and** required CI green on that tip SHA, or a hard blocker. Use **rate-limit backoff** (Composio → gh) on dense polls.
6. Changelog nudge if user-facing.
7. **Optional simplify phase:** only when the user explicitly asks, run `references/simplify-pr.md` after the concrete bug, security, spec, review, base, and CI work above is clean but before posting the verdict.
   - Keep simplification findings separate from required review findings.
   - If the simplify pass reports **nothing worth simplifying**, continue to the normal verdict without changing code.
   - If it reports candidates, present the complete bounded list and wait for **explicit approval** before changing code. Hold the verdict while approval is pending.
   - Approval automatically resumes application of only the approved candidates, focused validation, required repository gates, push, and the **complete full-review workflow** on the new head. There is **no second continuation prompt**.
   - Rerun this complete workflow on the exact **post-simplification head** with simplification disabled. Re-run usefulness, bug, security, Spec/Standards, comments, base synchronization, compile/tests, required CI, thin settle, and `ship-gate.mjs`; do not merely review the cleanup diff.
   - Publish the final verdict only from that post-simplification head. Any regression introduced by simplification is a blocker and must be fixed or the responsible candidate rolled back.
   - There is **no recursive simplification** pass during the mandatory re-review.
8. If concrete necessary issues remain: GitHub **changes requested** with those blockers only.
9. Before `approve-comment` (or merge-ready notify): **thin settle** (shared rules) — ~3–5 min quiet + recheck; activity resets; two-window cap. Skip settle for `changes-requested` / `not-useful` / draft `gated`.
10. Post a **detailed** verdict comment **only after** CI+comments are handled (and settle, when approving) or a real hard blocker / `not-useful` / draft `gated` applies. Use the **Full-review / re-review verdict** template in `references/comment-depth.md` — fill Usefulness, Bugs, Security, Spec, Reviews, Base/CI, Gate, Bottom line with paths/SHAs/checks. Do not post a bullet stub of “bots: addressed / CI: green.” When simplification ran, include the approved candidates, rollback status, validation evidence, and exact post-simplification head.

Approve via GitHub only if the user asked for approval; otherwise comment or request changes.

If the verdict is `approve-comment` (clean): also post merge-ready PR + linked-issue notify per `fix-pr-bots` (idempotent) unless the user asked for verdict-only.

## Done when

For **every** targeted PR:

- Usefulness assessed
- Bug + security reviews done
- Bundled Spec + Standards method completed on the recorded base/head comparison, with sources and both axis results preserved
- Useful bots/humans handled or declined with rationale
- Required CI green **or** hard-blocker reported (flake budget exhausted / permissions / etc.) — **never** “done” with unexplained red CI
- When simplification was explicitly requested: candidates were reported, explicit approval preceded every simplification mutation, approved changes passed focused and repository validation, and the complete full-review workflow reran on the post-simplification head with simplification disabled and no recursive simplification
- Thin settle completed before `approve-comment` / merge-ready (not for reject/gated labels)
- Verdict posted with a **valid** label (see table)
- No invented maintainer-ack / soft-security stop
