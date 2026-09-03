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

Do not polish an alibi into a shorter comment. Delete it. The comment inspector never writes application code. The parent lands the root-cause flag.

## Independent reviewer

When the host can spawn a subagent, the parent **must spawn** the **comment inspector** with one immutable scope: the exact parent-scoped file set or exact diff. The parent must not restate the inspector rules. Load `agents/comment-inspector.md` as that agent's prompt. Do not hunt comments in the same agent that wrote the code.

The inspector may read nearby context outside that scope only to judge a scoped comment. It must not inspect or delete comments, edit code, or raise root-cause flags outside that scope.

If spawn is unavailable or rejected by the host, run the same keep-list as a separate **parent fallback** phase, as if this agent did not write the code. Missing spawn is not a failed hunt.

The comment inspector may only touch comments and raise root-cause flags. It must never write application code.

## Parent inspector

Inspect the final report and comment-only diff. Reject:

- application-code edits or incidental reformatting
- scope escapes, including any deletion, classification, or flag outside the immutable scope
- provisional or contradictory classifications in the report
- exception-protected deletions (innocent-list comments removed without proof)
- misstated root-cause flag reasons
- root-cause flags not directly covered by the deleted alibi
- flags that treat kept intentional code as guilty

Root-cause flags on our-code surprises stay actionable. Do not restore those comments.

One rejected report may be rerun with the failure named. A **second rejected report fails** the pass.

## Apply vs report

| Situation | What happens |
|---|---|
| Own PR, current mode already has `push_code` | Auto-apply accepted in-scope kills, root-cause flag fixes, and cheap encodings of proven innocent comments |
| Own PR, read-only / no `push_code` | Report-only. Do not upgrade mutation mode |
| Foreign PR | Report-only. Deliver findings to the PR owner. Write nothing |
| Out-of-scope root cause | Delete the alibi. Leave the leftover workaround as a **merge-ready blocker**. Do not claim merge-ready or publication |

Cheap encodings are an in-scope type, test, lint, or CI rule that makes a **proven innocent** comment unnecessary. Apply those when the apply row allows it, then delete the comment. Keep an innocent-list comment when no cheap encoding exists. Do not encode an alibi.

Root-cause flag fixes are the smallest in-scope root cause: delete a dead path, drop a parameter, use the real API, or reshape so the behavior is obvious. Do not add a symptom guard. Do not widen the PR fence.

## Failure

A failed no-comments pass **blocks the review verdict**, merge-ready claim, and create-PR publication:

- two rejected reviewer reports in a row
- the reviewer still touches application code or escapes scope after one rerun
- own PR with `push_code` already allowed, and an accepted in-scope kill or root-cause flag was not landed
- an unproven alibi comment was left in place
- a leftover workaround after a deleted alibi remains (in-scope unlanded, or out-of-scope named as a merge-ready blocker)

Not a failure: nothing to delete; first report rejected and rerun accepted; parent fallback; foreign or read-only report-only completion; this request opted out. An **opted-out pass does not run** and cannot fail.

Ship-gate, mutation, ownership, and foreign-PR rules still outrank this pass.

## Order when composed

1. No-comments (unless opted out).
2. Existing bug / security / spec / feedback / CI work.
3. Simplify via `references/simplify-pr.md` (unless opted out).
4. If the head changed, re-validate with both passes disabled.

At most one no-comments pass per reviewed head. The comment inspector does not reshape application code. The parent lands in-scope root-cause flags during apply / later correctness work before claiming merge-ready.

## Report

Name deletion count, restored comments, reruns, in-scope fixes, encodings, leftover merge-ready blockers, and any skip reason (`skipped no-comments: without no-comments`). The inspector emits only this final report; no progress narration or provisional keep/kill decisions belong in the durable result.
