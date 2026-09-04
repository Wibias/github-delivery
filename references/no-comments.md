<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- evidence
- git
- reviews
- stacks (when stack topology is detected)
<!-- policy-modules:end -->

# No-comments

**Trigger:** An explicit `no-comments`, `strip comments`, `comment inspector`, or `comment sicko` request on PR #N. Also composed into full review, re-review, merge-ready/fix, create-PR pre-open, and prepare-and-merge unless this request opts out (`skip no-comments`, `without no-comments`, `keep source comments`, `don't strip comments`). A bare `no comments` is not an opt-out.

Use `node "<github-delivery>/scripts/workflow-brief.mjs" no-comments` after routing. Decide run/skip with the same phrases as `scripts/lib/hygiene-passes.mjs`.

## Goal

Kill source comments that narrate or justify workarounds, and fix those workarounds at the root when apply is allowed. Keep only comments on the innocent list. This is not a zero-comments ban.

## Primary rule

A source comment is **guilty** when it is narration or an alibi for a workaround.

Examples that must die:

- `// Phase 1: add cards`
- `// fine for now, skip validation`
- long `IMPORTANT` / `do not remove` / `too risky` sermons without scoped proof

A source comment is **innocent** only when it matches this list:

- legal or license headers
- public API doc comments that define a contract
- issue or RFC links for a constraint the code cannot express
- non-obvious behavior forced by an external dependency, platform, vendor, or protocol we cannot reshape in this PR
- `prettier-ignore` and style-only lint suppressions when the rule is faulty, pedantic, or style-only

Our-code surprises are not innocent. Kill the comment and raise a **root-cause flag** on the exact symbol for rename, extract, type, or rearchitecture that makes the behavior obvious without prose.

Correctness or safety suppressions (`eslint-disable` for a real-bug rule, `@ts-ignore`, `@ts-expect-error`, and equivalents) are guilty. Kill the suppression and raise a root-cause flag on the guilty symbol.

Hunt nearby code before judging a claimed keep. A keep survives only with scoped proof that it matches the innocent list. After the hunt, if it is still an alibi, delete it. Leaving an unproven alibi in place is a failed pass.

Do not polish an alibi into a shorter comment. Delete it. The comment inspector never writes application code. The parent lands the accepted deletion and any root-cause flag.

## Independent reviewer

When the host can spawn a subagent, the parent **must spawn** the **comment inspector** with one immutable scope. The parent must not restate the inspector rules. Load `agents/comment-inspector.md` as that agent's prompt. Do not hunt comments in the same agent that wrote the code.

For `create-pr-from-local-work`, scope is executable rather than model-selected: run `scripts/create-pr-hygiene.mjs prepare` exactly as that workflow specifies. It derives `github-delivery/comment-review-scope` from the candidate's **new-side added diff lines**, writes the scope file, and captures the guarded byte snapshot. Give the inspector that generated scope file; do not substitute whole changed files, an independently grepped comment list, or a newly reconstructed diff. The inspector may read nearby context outside the generated ranges only to judge an in-scope comment.

For other workflows that compose no-comments, retain their declared exact parent file/diff scope and create the pre-spawn byte snapshot with `scripts/comment-review-guard.mjs capture --root <repo-root> --files <scope-json> --snapshot <temp-file>` unless their owning workflow supplies an equivalent deterministic wrapper.

The inspector is report-only. It must never edit files, delete comments, reformat code, or otherwise mutate the workspace. It must not classify comments or raise root-cause flags outside that scope. Its durable output is one final structured result, never progress narration or provisional classifications.

For the local create-PR path, the final result must be `schemaVersion: 1`, `kind: "github-delivery/comment-review-result"`, carry the exact generated `scopeDigest`, and contain unique `{ path, line, disposition, reason }` classifications plus any root-cause flags. `scripts/create-pr-hygiene.mjs finalize` validates this through the canonical `comment-review-result` boundary. A pre-existing line, duplicate/reversed classification, detached root-cause flag, wrong scope digest, or non-KEEP/DELETE disposition is rejected structurally.

Before trusting any reviewer result, the owning workflow must verify the byte boundary. For local create-PR, `create-pr-hygiene.mjs finalize` performs that verification. For other workflows, run `scripts/comment-review-guard.mjs verify --root <repo-root> --snapshot <temp-file>` directly.

If verification reports reviewer mutation, run `scripts/comment-review-guard.mjs restore --root <repo-root> --snapshot <temp-file>` to **restore the exact pre-spawn bytes**, reject that reviewer result, and use the parent fallback (or the one permitted rerun). This rollback is safe only because the scoped files have **no concurrent writer** during the reviewer window. Never use rollback to overwrite known parent/user edits made after capture; such concurrency is a workflow violation and must fail closed instead.

A reviewer failure cannot leave workspace mutations because reviewer mutation is forbidden and the byte guard verifies the boundary. If the subagent returns an error, is interrupted, or fails before a valid final report, discard partial/provisional output, verify/restore the snapshot as needed, and run the **parent fallback**; do not infer whether the reviewer "probably" applied anything. If spawn is unavailable or rejected by the host before execution begins, run the same keep-list as a separate parent fallback phase, as if this agent did not write the code. Missing or failed spawn is not itself a failed hunt.

After an unchanged reviewer window is proven, discard the temporary byte copy before applying parent-owned changes. Local create-PR finalization discards the verified snapshot automatically; if it reports `comment_review_guard_changed_restore_required`, it deliberately leaves the snapshot available for the required restore. Do not retain source snapshots as workflow evidence.

## Parent inspector

Inspect only the final report after the byte guard verifies an unchanged reviewer window. Reject:

- any claimed or observed reviewer workspace mutation
- scope escapes, including any classification or flag outside the immutable scope
- provisional or contradictory classifications in the report
- exception-protected deletions (innocent-list comments marked DELETE without proof)
- misstated root-cause flag reasons
- root-cause flags not directly covered by the deleted alibi
- flags that treat kept intentional code as guilty

For local create-PR, the structured result validator handles scope escape, duplicate classification, digest, disposition, and detached-flag mechanics; the parent still owns the semantic innocent-list judgment and every resulting mutation.

The parent applies accepted comment deletions only after the report passes inspection. The parent also owns every in-scope root-cause fix or cheap encoding allowed by the current mutation mode. Reviewer output is evidence, never a workspace mutation boundary.

Root-cause flags on our-code surprises stay actionable. Do not retain those comments merely because the reviewer was report-only.

One rejected report may be rerun with the failure named. A **second rejected report fails** the pass.

## Apply vs report

| Situation | What happens |
|---|---|
| Own PR, current mode already has `push_code` | Parent auto-applies accepted in-scope kills, root-cause flag fixes, and cheap encodings of proven innocent comments |
| Own PR, read-only / no `push_code` | Report-only. Do not upgrade mutation mode |
| Foreign PR | Report-only. Deliver findings to the PR owner. Write nothing |
| Out-of-scope root cause | Parent deletes the alibi when mutation is already allowed. Leave the leftover workaround as a **merge-ready blocker**. Do not claim merge-ready or publication |

Cheap encodings are an in-scope type, test, lint, or CI rule that makes a **proven innocent** comment unnecessary. Apply those when the apply row allows it, then delete the comment. Keep an innocent-list comment when no cheap encoding exists. Do not encode an alibi.

Root-cause flag fixes are the smallest in-scope root cause: delete a dead path, drop a parameter, use the real API, or reshape so the behavior is obvious. Do not add a symptom guard. Do not widen the PR fence.

## Failure

A failed no-comments pass **blocks the review verdict**, merge-ready claim, and create-PR publication:

- two rejected reviewer reports in a row
- the reviewer claims workspace mutation, escapes scope, or still produces an invalid final report after one rerun
- the byte guard cannot verify or restore the exact scoped pre-spawn state
- a concurrent writer touched scoped files during the reviewer window
- own PR with `push_code` already allowed, and an accepted in-scope kill or root-cause flag was not landed by the parent
- an unproven alibi comment was left in place
- a leftover workaround after a deleted alibi remains (in-scope unlanded, or out-of-scope named as a merge-ready blocker)

Not a failure: nothing to delete; first report rejected and rerun accepted; parent fallback; foreign or read-only report-only completion; this request opted out. An **opted-out pass does not run** and cannot fail.

Ship-gate, mutation, ownership, and foreign-PR rules still outrank this pass.

## Order when composed

1. No-comments (unless opted out).
2. Existing bug / security / spec / feedback / CI work.
3. Simplify via `references/simplify-pr.md` (unless opted out).
4. If the head changed, re-validate with both passes disabled.

At most one no-comments pass per reviewed head. The comment inspector never reshapes the workspace. The parent lands accepted in-scope deletions and root-cause flags during apply / later correctness work before claiming merge-ready. For local create-PR, any accepted DELETE/root-cause result intentionally prevents `create-pr-hygiene finalize` from issuing clean evidence until the parent lands the change and reruns on the new head.

## Report

Name deletion count, restored comments, reruns, in-scope fixes, encodings, leftover merge-ready blockers, and any skip reason (`skipped no-comments: without no-comments`). The inspector emits only its final report; no progress narration or provisional keep/kill decisions belong in the durable result.