# Full review PR

**Trigger:** “full review on pr #N…”, “bug + security review + rabbit/codex + verdict”, “is this PR useful?”, a list of existing PRs to full-review, or an explicit “full review + simplify” request.

## Mandatory execution plan and completion lock

At the start of every full-review run, create or maintain an explicit execution
plan. Its final required item MUST be named exactly:

`Publish final verdict`

That item starts as `pending` and may be marked `completed` only after the final
verdict has actually been delivered for the currently reviewed PR head.

The required plan must include, at minimum:

1. Resolve repository, PR, base, and current head.
2. Review usefulness and claimed behavior.
3. Complete the semantic propagation audit.
4. Complete bug review.
5. Complete security review.
6. Complete Spec and Standards review.
7. Triage human and bot feedback.
8. Validate the current head and required CI.
9. Refresh the authoritative ship gate.
10. Publish final verdict.

The run **MUST NOT stop, return, hand off, emit a final response, or report
completion** while `Publish final verdict` or any required prerequisite is
`pending` or `in_progress`.

Before every attempted stop:

1. Inspect the current execution plan.
2. Continue with the next unfinished required item.
3. Refresh the PR head.
4. Invalidate stale evidence when the head changed.
5. Obtain the authoritative `ship-gate.mjs` result for that head.
6. Publish exactly one final verdict:
   - `approve-comment`;
   - `changes-requested`;
   - `not-useful`;
   - `gated`.
7. Mark `Publish final verdict` complete only after delivery.

A blocker is input to the final verdict, not permission to skip it.

The following are never terminal full-review states:

- `Planning next moves`;
- a progress update;
- pending CI;
- an unavailable optional reviewer;
- a failed Bugbot invocation;
- unavailable optional tooling;
- incomplete or unavailable API evidence;
- waiting for another continuation prompt;
- completion of review work without publication of the verdict.

If GitHub publication is unavailable, provide the complete verdict in chat,
including the reviewed head, findings, blockers, evidence limitations, and next
action. That chat verdict satisfies the required verdict item.

The only permitted exit without a verdict is explicit user cancellation.

### Mandatory semantic propagation audit

Every full-review run MUST read and execute
`references/semantic-propagation-review.md`.

This axis runs after usefulness review and before the ordinary bug, security,
and Spec/Standards conclusions are finalized.

For each changed domain concept:

1. Name the concept independently of its filenames.
2. Identify its authoritative source of truth.
3. Search the entire repository for producers, consumers, sibling
   implementations, derived forms, public output, serialization, persistence,
   fixtures, and tests.
4. Enumerate all affected members when shared code operates on a family,
   catalog, registry, provider set, model set, capability table, enum, feature
   flag, permission set, default table, schema, or platform matrix.
5. Partition those members by materially different behavior.
6. Prove equivalence before using one member as representative coverage.
7. Compare every derived representation against the canonical source.
8. Verify expected values are present and unexpected values are absent.
9. Require exact equality for observable lists, sets, enums, permissions,
   efforts, features, defaults, and capabilities unless an intentional
   difference is supported by explicit evidence.
10. Record the completed propagation matrix in the review evidence.

The changed files are only seeds for repository-wide tracing. They are never
the complete scope of this axis.

The following block completion of this plan item:

- no authoritative source identified;
- an affected producer, consumer, or public representation was not inspected;
- a family was not partitioned by behavior;
- one representative was tested without proving equivalence;
- canonical and derived representations disagree;
- tests prove only expected presence where accidental widening is possible;
- a materially distinct variant lacks positive or negative coverage;
- PR claims, probes, or validation evidence refer to an older head;
- required CI is incomplete.

When any blocker remains, keep `Complete the semantic propagation audit`
complete only as a performed axis, record its result as `blocked`, and carry
every blocker into the mandatory final verdict. Never silently downgrade these
items to optional follow-up suggestions.

The final verdict MUST contain a `Semantic propagation` section listing:

- concepts audited;
- authoritative sources;
- derived and public representations checked;
- material variant partitions checked;
- negative assertions checked;
- unmapped surfaces;
- unproven equivalence assumptions;
- representation mismatches;
- coverage gaps;
- axis verdict.

A full review cannot produce `approve-comment` while the semantic propagation
axis is blocked.

### Full-review run and publication identity

At the start of this explicit full-review invocation, create one unique
`full-review-run-id` and record it in the execution plan.

Use a stable form such as:

`fr-<PR-number>-<review-start-head-short-sha>-<UTC-start-time>`

The identifier remains unchanged throughout this same run, including:

- CI polling;
- tool or reviewer retries;
- Bugbot fallback;
- context compaction or resumed execution;
- head refreshes;
- correction of a partial verdict publication.

A later explicit full-review request MUST create a new `full-review-run-id`, even
when it targets the same PR and the same head.

### Final verdict publication

Every completed full-review run MUST publish a new top-level PR conversation
comment containing:

`<!-- github-delivery:full-review-verdict run:<full-review-run-id> head:<reviewed-head-sha> -->`

Before publishing:

1. Search for the exact current `full-review-run-id`.
2. If no exact current-run marker exists, use `post_comment`.
3. If the exact marker exists only because this run’s publication is incomplete,
   malformed, or truncated, use `edit_own_comment` to repair it.
4. Never edit a completed verdict from an earlier full-review run.
5. Never use another head’s verdict as the editable target.
6. Never select the newest generic `[GD] Verdict` comment without
   matching both run ID and reviewed head.

Once `Publish final verdict` is marked complete, that comment becomes immutable
historical review evidence.

The final chat report must use:

- `posted new verdict comment` when this run created its required verdict;
- `repaired current-run verdict comment` only when this run repaired its own
  incomplete publication.

It must never describe a newly completed full review as `updated verdict
comment`.

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

| Label               | When allowed                                                                                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approve-comment`   | Useful; bots/humans clear; own reviews + spec/standards clean; up to date with base; **compiles against tip**; **required CI green**; protection/`reviewDecision`/CODEOWNERS clear; not mid-stack-for-trunk; no draft/WIP gate; **thin settle** done |
| `changes-requested` | Concrete necessary blockers remain that you cannot/should not silently fix                                                                                                                                                                           |
| `not-useful`        | Usefulness pass failed — stop expanding work on that PR                                                                                                                                                                                              |
| `gated`             | **Only** GitHub draft / WIP / do-not-merge (shared draft gates). **Not** “wants maintainer ack”, “security feels sensitive”, or “Windows looks flaky”                                                                                                |

`changes-requested` also covers owner actions on a foreign PR: update from the latest base and apply the listed simplification candidates.

**Forbidden stop excuses** (report in chat if relevant, but **keep fixing CI + comments**):

- “Needs maintainer security ack” / “should get human OK first”
- “Security relevance possible” without a concrete unfixed finding
- Treating shared/infra CI noise as done while **this PR’s** required checks are still red (classify + flake retries per shared rules; if budget exhausted → hard-blocker row, not a fake `gated`)
- Skipping a required CI failure as “unrelated / introduced elsewhere” instead of a minimal harden/fix (shared scope lock)

## Steps

1. Identify PR(s); checkout head (subagent preflight); note base, linked issues, draft/WIP gates, and the PR author vs authenticated viewer (shared **PR ownership boundary**). If draft and user wanted green/merge-ready: ask once about **Draft → ready**.
2. Usefulness pass: real bug / claimed value? If not → `not-useful` verdict and stop that PR only.
3. Parallel where useful: **Bug** via **`references/bug-review.md`** (scope → Bugbot when Cursor → complementary). On Cursor, use that file's literal `review-bugbot` prompt contract; do not construct or paraphrase a replacement prompt in this workflow. **Security** via **`references/security-review.md`** (never Cursor harness `security-review` / `review-security`). Run **Spec + Standards** through the bundled **`references/spec-standards-review.md`** method. It owns the fixed comparison, source discovery, two independent axes, and advisory `references/code-smells.md` baseline; do not depend on an optional external review skill.
4. Triage open human + bot comments (shared rules — owners/maintainers first). Fix useful; decline nits with rationale. Inline replies in-thread only.
5. Update from base and push the base sync **only when the PR is ours** (shared **PR ownership boundary**); on a foreign PR, record the owner actions (update from latest base / resolve conflicts) for the verdict and do not push the base sync. Push scoped fixes under the existing fork-head/push rules; **verify compile/tests against tip**; **wait and recheck** until useful threads quiet **and** required CI green on that tip SHA, or a hard blocker. Use **rate-limit backoff** (Composio → gh) on dense polls.
6. Changelog nudge if user-facing.
7. **Optional simplify phase:** only when the user explicitly asks, run `references/simplify-pr.md` after the concrete bug, security, spec, review, base, and CI work above is clean but before posting the verdict.
   - **Foreign PRs (not ours):** run the candidate pass, then **do not edit or push**; include the complete bounded candidate list in the verdict for the PR owner and skip the approval-to-apply, validation, push, and re-review flow.
   - Keep simplification findings separate from required review findings.
   - If the simplify pass reports **nothing worth simplifying**, continue to the normal verdict without changing code.
   - If it reports candidates on **our own PR**, present the complete bounded list and wait for **explicit approval** before changing code. Hold the verdict while approval is pending.
   - Approval automatically resumes application of only the approved candidates, focused validation, required repository gates, push, and the **complete full-review workflow** on the new head. There is **no second continuation prompt**.
   - Rerun this complete workflow on the exact **post-simplification head** with simplification disabled. Re-run usefulness, bug, security, Spec/Standards, comments, base synchronization, compile/tests, required CI, thin settle, and `ship-gate.mjs`; do not merely review the cleanup diff.
   - Publish the final verdict only from that post-simplification head. Any regression introduced by simplification is a blocker and must be fixed or the responsible candidate rolled back.
   - There is **no recursive simplification** pass during the mandatory re-review.
8. If concrete necessary issues remain: GitHub **changes requested** with those blockers only.
9. Before `approve-comment` (or merge-ready notify): **thin settle** (shared rules) — ~3–5 min quiet + recheck; activity resets; two-window cap. Skip settle for `changes-requested` / `not-useful` / draft `gated`.
10. Post a **detailed** verdict comment **only after** CI+comments are handled (and settle, when approving) or a real hard blocker / `not-useful` / draft `gated` applies. Use the **Full-review / re-review verdict** template in `references/comment-depth.md` — lead with the **TLDR** (decision, every axis outcome, blockers, owner actions, bottom line) and keep the complete verdict in a `<details>` dropdown. Fill Usefulness, Bugs, Security, Spec, Reviews, Base/CI, Gate, Bottom line with paths/SHAs/checks; the TLDR never drops a blocker, owner action, or required next step. Do not post a bullet stub of “bots: addressed / CI: green.” When simplification ran, include the approved candidates, rollback status, validation evidence, and exact post-simplification head. When the PR is not ours, also fill the **Base sync (for the PR owner)** line and **Simplification (for the PR owner)** section with the owner actions.

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
- Foreign PRs: no base-sync push and no simplification edits; the verdict delivered the owner actions (update from latest base / apply the listed simplification candidates)
- Thin settle completed before `approve-comment` / merge-ready (not for reject/gated labels)
- Verdict posted with a **valid** label (see table)
- No invented maintainer-ack / soft-security stop
