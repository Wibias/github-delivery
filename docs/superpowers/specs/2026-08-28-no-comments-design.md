# No-comments and automatic simplify before review

## Status

Draft for review. Product change, not an audit finding. Branch from `origin/main`. Do not bundle unrelated remediations or docs-package-only work.

## Problem

Agents use source comments as alibis for workarounds. The comment stays, the hack stays, and later changes stack more hacks on top. github-delivery already has a weaker comment lens inside simplify, but simplify is explicit-only, behavior-preserving, and does not hunt the workaround the comment is covering.

pstack's `/no-comments` skill is the right idea and the wrong shape to vendor as-is. It is Cursor-spawn-shaped, theatrical, and delete-on-doubt. github-delivery is host-agnostic, evidence-bound, and mutation-gated. `references/comment-depth.md` is about GitHub posts, not source comments.

## Goals

1. Run a **no-comments** pass automatically before full review, merge-ready/fix, and create-PR pre-open, unless this request opts out of it.
2. Run **simplify** automatically on those same paths, unless this request opts out of it. It is no longer explicit-only there.
3. Kill comments that narrate or justify workarounds, and fix those workarounds at the root when we can apply.
4. Keep comments that match the closed innocent list. This is not a zero-comments ban.
5. Require an independent **comment inspector** when the host can spawn a subagent. Fall back to the same checklist in the parent if it cannot. The agent that wrote the code does not hunt its own comments.
6. A failed no-comments pass blocks the review verdict, merge-ready claim, and PR publication. An opted-out pass does not run and cannot fail. A leftover workaround after a deleted alibi is a merge-ready blocker, not a successful leftover.

## Non-goals

- A Cursor plugin, a pstack dependency, or a required comment-inspector spawn on hosts that cannot spawn subagents.
- Shipping the pstack Comment Sicko persona. `comment sicko` remains a trigger alias only.
- Changing GitHub post style (`comment-depth.md`).
- Granting `push_code` to a bare read-only full review.
- Editing foreign PRs.
- A repository-wide comment sweep outside the current PR or caller scope.
- Making line count a success metric.
- Native GitHub stack merge.
- A durable repo or skill config flag. Opt-out is per request, in the same natural-language request that selected the workflow.

## Primary rule

A source comment is **guilty** when it is narration or an alibi for a workaround.

A source comment is **innocent** only when it matches this list:

- legal or license headers
- public API doc comments that define a contract
- issue or RFC links for a constraint the code cannot express
- non-obvious behavior forced by an external dependency, platform, vendor, or protocol we cannot reshape in this PR
- `prettier-ignore` and style-only lint suppressions when the rule is faulty, pedantic, or style-only

Our-code surprises are not innocent. Kill the comment and raise a **root-cause flag** on the exact symbol for rename, extract, type, or rearchitecture that makes the behavior obvious without prose.

Correctness or safety suppressions (`eslint-disable` for a real-bug rule, `@ts-ignore`, `@ts-expect-error`, and equivalents) are guilty. Kill the suppression and raise a root-cause flag on the guilty symbol.

`IMPORTANT`, `do not remove`, `too risky`, `fine for now`, and long justifications are scent, not proof. Hunt nearby code before judging. A keep survives only with scoped proof that it matches the innocent list. After the hunt, if it is still an alibi, delete it. Leaving an unproven alibi in place is a failed pass.

Do not polish an alibi into a shorter comment. Delete it. The comment inspector never writes application code. The parent lands the root-cause flag.

## Architecture

New workflow `references/no-comments.md`, composed into review and publication paths. Host-agnostic workflow prose plus an independent comment inspector. Existing ship-gate, mutation, ownership, and review policy still outrank this pass.

```text
route
  -> no-comments (default on composed paths; skip if this request opted out)
  -> existing bug / security / spec / feedback / CI work
  -> simplify (default on composed paths; skip if this request opted out)
  -> if the head changed, re-validate with skipped-or-already-run passes disabled
  -> verdict / pre-open / merge-ready
```

No-comments runs before correctness work because killing an alibi and its workaround is bug-adjacent. The inspector only deletes comments and raises flags. The parent lands in-scope flags during apply or the following correctness work. Simplify stays behavior-preserving, so it runs after intended behavior is the current tree. Otherwise simplify would freeze the bug in.

At most one no-comments pass and one simplify pass per reviewed head. No recursion. Opt-out is independent: skip one, skip the other, or skip both. The rest of the workflow still runs.

## Components

### 1. `references/no-comments.md`

Workflow. Declares policy modules: `policy-kernel`, `mutation`, `evidence`, `git`, `reviews`, and `stacks` when stack topology is detected. Same family as simplify.

Trigger: explicit `no-comments`, `strip comments`, `comment inspector`, or `comment sicko` on PR #N; also composed as below.

### 2. `agents/comment-inspector.md`

Independent hunter. Comments and root-cause flags only, never application code. Keep-list matches **Primary rule** above, not pstack delete-on-doubt, and not a pstack persona.

When the host can spawn a subagent, the parent **must** spawn the comment inspector with `agents/comment-inspector.md` as its prompt and must not restate its rules. If spawn is unavailable or rejected by the host, the parent runs the same checklist as a separate phase, as if it did not write the code. Missing spawn is not a failed hunt.

github-delivery ships the agent file. Detection is the live host spawn surface, not install-time guesses.

### 3. Parent inspector

Owns the result. Reject:

- application-code edits from the reviewer
- scope escapes
- exception-protected deletions (innocent-list comments removed without proof)
- misstated root-cause flag reasons
- flags that treat kept intentional code as guilty

Root-cause flags on our-code surprises stay actionable. Do not restore those comments.

One rejected report may be rerun with the failure named. A second rejected report fails the pass.

### 4. Simplify trigger change

On full review, merge-ready/fix, create-PR pre-open, and prepare-and-merge, simplify runs automatically after no-comments and after correctness work, unless this request opts out. Standalone `simplify PR #N` remains and is not an opt-out of no-comments on other paths.

Contract card, nothing-worth-simplifying, individual revert, and no recursive simplify stay. Line count is still never a goal.

The old rule "do not treat maintainer mode or permission to fix bugs as approval to simplify" is replaced on **own PRs when `push_code` is already allowed**. Eligible contract-card candidates apply without a second yes. Foreign PRs and read-only modes still report only.

### 5. Router and briefs

- Explicit no-comments → `references/no-comments.md`, mutation `maintainer` with `push_code` (same as standalone simplify).
- Full review remains the route for `full review` plus no-comments, simplify, or opt-out clauses.
- `SKILL.md`, README, workflow-brief, delivery-workflow-profiles, and `ROUTABLE_WORKFLOWS` gain the new workflow.
- `comment-depth.md` states in one line that it is GitHub posts, not source comments.

### 6. Tests

Router, contract-string, and fixture tests named in **Testing**. Rewrite `tests/unit/simplify-review-contract.test.mjs` so it no longer requires simplify to be explicit-only on composed paths.

## Apply vs report

| Situation | What happens |
|---|---|
| Own PR, current mode already has `push_code` | Auto-apply accepted in-scope kills, root-cause flag fixes, cheap encodings of proven innocent comments, and eligible simplify candidates |
| Own PR, read-only / no `push_code` (bare full review) | Run the passes this request did not opt out of, as report-only. Findings go in the verdict. Do not upgrade mutation mode |
| Foreign PR | Report-only. Deliver findings to the PR owner. Write nothing |
| Out-of-scope root cause | Delete the alibi. Leave the leftover workaround as a merge-ready blocker. Do not claim merge-ready or publication |

Cheap encodings are an in-scope type, test, lint, or CI rule that makes a proven innocent comment unnecessary. Apply those when the apply row above allows it, then delete the comment. Keep an innocent-list comment when no cheap encoding exists. Do not encode an alibi.

Root-cause flag fixes are the smallest in-scope root cause: delete a dead path, drop a parameter, use the real API, or reshape so the behavior is obvious. Do not add a symptom guard. Do not widen the PR fence.

## Failure (blocks verdict, merge-ready, and create-PR publication)

- Two rejected reviewer reports in a row.
- Reviewer still touches application code or escapes scope after one rerun.
- Own PR with `push_code` already allowed, and an accepted in-scope kill or root-cause flag was not landed.
- An unproven alibi comment was left in place.
- A leftover workaround after a deleted alibi remains (in-scope unlanded, or out-of-scope named as a merge-ready blocker).

Not a failure:

- nothing to delete
- first report rejected, rerun accepted
- parent fallback because spawn is absent
- foreign or read-only report-only completion
- simplify finds nothing worth changing
- this request opted out of the pass that would otherwise have run

Ship-gate, mutation, ownership, and foreign-PR rules still outrank this pass.

## Per-request opt-out

Default on composed paths is both passes on. The same request can skip either pass, or both. Opt-out does not change the selected workflow and does not grant `push_code`.

| Intent | Example phrasing |
|---|---|
| Skip simplify only | `without simplify`, `skip simplify`, `don't simplify` |
| Skip no-comments only | `skip no-comments`, `without no-comments`, `keep source comments`, `don't strip comments` |
| Skip both | any combination of the rows above |

Do not treat a bare `no comments` as opt-out. That phrase collides with the workflow name. Opt-out must use `skip` / `without` / `don't strip` / `keep source comments`.

An explicit standalone request still wins on that path: `no-comments PR #N` runs no-comments; `simplify PR #N` runs simplify. Those are not composed defaults, so they have nothing to opt out of unless the same request also names the other pass.

Name the skipped pass in the verdict or publication text (`skipped no-comments: without no-comments`, `skipped simplify: skip simplify`).

## Composition map

| Path | no-comments | simplify | apply |
|---|---|---|---|
| Explicit `no-comments PR #N` | yes | no, unless also requested | own + `push_code` |
| Explicit `simplify PR #N` | no, unless also requested | yes | own + `push_code` |
| Full review | yes, unless opted out | yes, unless opted out | report-only unless the request already has `push_code` |
| Re-review | yes, unless opted out | yes, unless opted out | report-only unless the request already has `push_code` |
| Full review + fix / merge-ready | yes, unless opted out | yes, unless opted out | own + `push_code` |
| `fix-pr-bots` / merge-ready | yes, unless opted out | yes, unless opted out | own + `push_code` |
| create-PR / local-work pre-open | yes, unless opted out | yes, unless opted out | own + `push_code` |
| prepare-and-merge | yes, unless opted out | yes, unless opted out | own + `push_code` |
| Status, watch, security-only, research | no | no | n/a |

After a head-changing apply, re-run the remaining review/pre-open/ship-gate work on the new head with both passes disabled.

Verdict / publication text names deletion count, restored comments, reruns, in-scope fixes, encodings, simplify outcome, and leftover merge-ready blockers.

## Testing

Behavioral, no new runtime service.

- Router: explicit no-comments selects `references/no-comments.md`. `comment sicko` and `comment inspector` are aliases. Full review plus no-comments, simplify, or opt-out still selects full review.
- Opt-out: `full review PR #42 without simplify` skips simplify only. `full review PR #42 skip no-comments` skips no-comments only. Combined skip skips both. Bare `no comments` is not an opt-out.
- Bare full review still does not gain `push_code` from these passes. Opt-out also does not grant `push_code`.
- Contract tests: simplify is automatic on composed paths unless opted out; line count still never a goal; nothing-worth-simplifying remains valid; foreign PRs still get no edits.
- Fixture A: `// Phase 1: add cards` is deleted; nearby real code is untouched.
- Fixture B: `// fine for now, skip validation` is deleted and the in-scope root cause is fixed; no replacement alibi is left.
- Fixture C: license header, public API doc comment, and proven external/protocol gotcha are kept.
- Fixture D: two rejected reviewer reports → pass fails → verdict / merge-ready / publication blocked.
- Fixture E: foreign PR or read-only mode reports the same findings and writes nothing.
- Fixture F: opted-out no-comments does not block the verdict even if alibi comments remain.
- Fixture G: out-of-scope leftover after a deleted alibi is a merge-ready blocker, not a successful leftover.
- Existing simplify contract-card and ship-gate tests stay authoritative.

## Docs

README capabilities and workflow map, `SKILL.md` route table, CHANGELOG. Changelog belongs in this product PR, not a later docs-package move.

## Success

A github-delivery review or merge-ready run on our own PR, with `push_code` already allowed, has an independent comment inspector delete alibi comments, the parent fix in-scope workarounds they were covering, keeps innocent-list comments, simplifies the resulting tree when the contract card allows it, and refuses to publish a verdict or claim merge-ready when an alibi or leftover workaround remains. A bare read-only review still reports those findings without rewriting the branch. The same request can skip no-comments, simplify, or both; the rest of the workflow still runs.
