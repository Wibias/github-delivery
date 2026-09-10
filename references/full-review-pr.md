<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- evidence
- git
- ci
- reviews
- publication
- stacks (when stack topology is detected)
<!-- policy-modules:end -->

# Full review PR

**Trigger:** “full review on pr #N…”, “bug + security review + rabbit/codex + verdict”, “is this PR useful?”, a list of existing PRs to full-review, or an explicit “full review + simplify” request.

## Mandatory execution plan and completion lock

At the start of every full-review run, create or maintain an explicit execution
plan. Its final required item MUST be named exactly:

`Deliver final verdict`

That item starts as `pending` and may be marked `completed` only after the final
verdict has actually been delivered for the currently reviewed PR head. A bare
full review delivers that verdict in chat. GitHub publication is an additional
mutation and occurs only when the routed request explicitly grants the relevant
publication action.

The required plan must include, at minimum:

1. Resolve repository, PR, base, and current head.
2. Run `references/no-comments.md` unless this request opts out (`skip no-comments`, `without no-comments`, `keep source comments`, `don't strip comments`). A failed pass blocks the verdict.
3. Review usefulness and claimed behavior.
4. Complete the semantic propagation audit.
5. Complete bug review.
6. Complete security review.
7. Complete Spec and Standards review.
8. Triage human and bot feedback. **After pushing fixes for a human (owner/maintainer) comment, post the `[GD] Addressed feedback` resolution record only when the routed request authorizes that publication mutation.** The wake gate credits a human comment as addressed via such a record; when publication is not authorized, record the owner action in the verdict instead of escalating authority. Use `addressedFeedbackPlan` from `watch-wake-gate.mjs` (or `scripts/lib/addressed-feedback-dedup.mjs`) for an authorized edit-vs-post decision, and `--resolve-bot` only when the routed mode permits that mutation.
9. Run `references/simplify-pr.md` unless this request opts out (`without simplify`, `skip simplify`, `don't simplify`). Nothing worth simplifying is valid. Auto-apply eligible contract-card candidates only on our PR when `push_code` is already allowed; foreign and read-only stay report-only.
10. Validate the current head and required CI.
11. Refresh the authoritative ship gate.
12. Deliver the final verdict. Publish it to GitHub only when the routed request explicitly authorizes verdict publication.

If no-comments or simplify changed the head, re-run the remaining review on that head with both passes disabled. There is no recursive hygiene pass.

The run **MUST NOT stop, return, hand off, emit a final response, or report
completion** while `Deliver final verdict` or any required prerequisite is
`pending` or `in_progress`.

## Token-efficient review flow (start here)

Run the **review brief** first — it digests the scope plan, required lenses and
surfaces, required probes, dependency changes, and the diff hunks into one
compact read. This replaces re-reading the PR files and re-deriving scope by
hand:

```bash
node "<github-delivery>/scripts/review-brief.mjs" OWNER/REPO N
```

The brief names every required bug lens, security surface, and probe the run
must cover, plus the exact changed-file hunks. It labels files as `core`,
`mechanical`, or `other`, and notes textually identical relocated blocks of
three or more lines as moved code. Surrounding context still requires review;
do not treat textual relocation as proof of unchanged behavior. Near
relocations and indentation-sensitive edits stay in review. Open a source file **only when a
lens actually needs more than the hunk** — do not read whole files preemptively.
The brief also appends the **required probe blocks** extracted from the review
references (`<!-- probe: <id> -->` sections), so the agent applies exactly the
probe instructions the diff triggers instead of reading the whole references.
When the diff changes test files, the brief carries the **`test-honesty`**
probe block: verify every new/modified assertion is non-vacuous (would fail if
the code changed), uses exact selectors, avoids fixed sleeps, and asserts order
where order is claimed — CodeRabbit catches these on most non-trivial PRs.

For a foreign PR (not ours), verify the head mechanically instead of narrating
each gate:

```bash
node "<github-delivery>/scripts/verify-pr-head.mjs" OWNER/REPO N \
  --test-filter "<changed-subsystem>" --worktree-root "D:\codex-worktrees" \
  --keep-worktree
```

It checks out the exact PR head in a temp worktree, runs install/typecheck/
**GUI typecheck included** (auto-detected from `gui/tsconfig*.json` — the root
tsconfig often excludes `gui/`, which is how the PR #1108 union-type bug slipped
past a green local typecheck), focused tests/lint/privacy, prints one PASS/FAIL
table. `--keep-worktree` leaves the worktree in place and reports its path, so
you can push fixes into it and re-run — use it for any PR you will edit. Without
`--keep-worktree` it removes the worktree. If CI is already green on the head
and the changed subsystems pass, you do **not** need to re-run the full local
suite.

### CI forensics (don't re-derive failure origin by hand)

When required checks are red, run `scripts/ci-forensics.mjs` instead of
manually fetching logs, annotations, base SHAs, and comparing workflow files:

```bash
node "<github-delivery>/scripts/ci-forensics.mjs" OWNER/REPO N
```

For each failing required check it prints: the conclusion, whether the base SHA
also fails that check (`base_preexisting` vs `pr_only_or_unknown`), the
check-run annotations, and the log tail. `ship-gate.mjs`'s base-health component
also emits `perCheckOrigins` (per-check origin + the reason why) so you never
re-derive "is this mine?" by hand. The final infra-vs-PR call is still yours —
the script gives the evidence.

### Reference read-once rule

Load each review reference (`bug-review.md`, `security-review.md`,
`spec-standards-review.md`, `semantic-propagation-review.md`, `code-smells.md`,
the required security skill) **once per session**, not once per PR. After the
first read, reuse the in-session summary; only re-open the section a required
lens/probe actually names. Reading all six in full for every PR is the largest
token sink in this workflow.

### Narration discipline

Between tool calls, do **not** narrate intent (“Now let me check…”, “Let me
verify…”, “The plan is correct”). Work through the lenses silently and report
only findings, blockers, and evidence — the chat report is the verdict
summary, not a step log.

Before every attempted stop:

1. Inspect the current execution plan.
2. Continue with the next unfinished required item.
3. Refresh the PR head.
4. Invalidate stale evidence when the head changed.
5. Obtain the authoritative `ship-gate.mjs` result for that head.
6. Produce exactly one final verdict:
   - `approve-comment`;
   - `changes-requested`;
   - `not-useful`;
   - `gated`.
7. If verdict publication is explicitly authorized, run the publication freshness gate, publish/reuse exactly one format-valid GitHub verdict, verify it, then mark `Deliver final verdict` complete. Otherwise deliver the same complete verdict in chat and mark `Deliver final verdict` complete without a GitHub mutation.
8. When publication is authorized, run `scripts/verify-verdict-published.mjs` with the run ID and reviewed head and require `published: true` **and `format.valid: true`**. A verdict that fails the format gate (missing strict label, `### TLDR`, or `<details>` dropdown) is an incomplete authorized publication: repair the current-run comment with `edit_own_comment` and re-run the verifier until both fields pass.
9. **Freshness gate before authorized publication** (PR #1108 lesson): re-check the review threads on the exact reviewed head immediately before posting. If any unresolved, non-outdated **bot-authored** thread is present (or landed after your evidence was gathered), do not publish yet — address or rebut those findings on the head first, then re-verify. Use `assessVerdictFreshness` from `scripts/lib/verdict-publication.mjs` (or run `scripts/review-threads.mjs --resolve-bot` when that mutation is authorized) to clear bot threads you already verified. A verdict published while a fresh bot review is actionable on the same head is stale.

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
- completion of review work without delivery of the final verdict.

For a read-only full review, chat delivery is the normal completion path. If
GitHub publication was explicitly requested but is unavailable for a genuine
auth, network, or API reason, record the exact failure as a hard publication
blocker and provide the complete verdict in chat, including the reviewed head,
findings, blockers, evidence limitations, and next action. Never elevate the
mutation mode merely to make publication possible.

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
- correction of an authorized partial verdict publication.

A later explicit full-review request creates a new `full-review-run-id` for
tracking, even when it targets the same PR and the same head. That does **not**
authorize any top-level PR comment. Publication authority comes only from the
routed user request.

### Final verdict delivery and optional publication

Every completed full-review run MUST end with a format-complete verdict for the
reviewed head. A bare full review is `read-only` and delivers the verdict in
chat. Only an explicit publication request such as `post the verdict` grants
GitHub verdict-comment authority. When publication is authorized, use:

`<!-- github-delivery:full-review-verdict run:<full-review-run-id> head:<reviewed-head-sha> -->`

Before an authorized publication, call `planVerdictPublication` from
`scripts/lib/verdict-publication.mjs` (or apply the same rules manually) against
the PR conversation comments and the draft verdict body:

1. Exact current `full-review-run-id` + head marker incomplete/malformed →
   `edit_own_comment` to repair it.
2. Exact current-run marker already complete → do not post again
   (`already_published`).
3. Completed same-head verdict exists and material delta is empty (same label +
   same required TLDR bullet values after normalization) → **reuse** that
   comment; do not `post_comment` again (`reuse_same_head`). Report
   `reused same-head verdict comment`.
4. Completed same-head verdict exists and material delta is non-empty →
   `post_comment` a **new** top-level verdict with the new run ID. Prior
   same-head verdicts stay immutable historical evidence.
5. No completed same-head verdict → `post_comment` a new verdict.
6. Never edit another run's completed marker to attach this run's ID.
7. Never select the newest generic `[GD] Verdict` comment without matching the
   current run marker when repairing.

Material delta = verdict label change **or** any required TLDR bullet value
change. Wording-only churn in the details dropdown, or a second agent finishing
the same tip with the same gate, is **not** material.

The mutation mode for this workflow is derived by the router: `read-only` for a
bare full review, `review` when verdict publication is explicitly requested,
and `maintainer` when `fix` or `simplify` is explicitly requested. Explicit
publication can add `post_comment` to an authorized maintainer route. Run the
authoritative gate with the routed mode plus
`--workflow references/full-review-pr.md`; all three declared modes are valid.
Never self-elevate from the routed mode to gain publication authority.

After an authorized post or reuse, verify publication before marking the plan
item complete. On `reuse_same_head`, verification is against the reused
comment's run marker / format:

```bash
node scripts/verify-verdict-published.mjs OWNER/REPO PR_NUMBER \
  --run-id <full-review-run-id> --head <reviewed-head-sha> \
  --mutation-mode <routed-mode>
```

`published: true` **and** `format.valid: true` are required for an authorized
GitHub publication. `format.valid: false` lists the exact missing structure
(`verdict_heading_missing` / `verdict_label_invalid`,
`tldr_heading_missing`, `tldr_bullets_missing:<keys>`,
`details_dropdown_missing`, `tldr_not_before_details`); repair the current-run
comment and re-verify before marking the authorized publication complete.

<!-- assertion-anchors -->
<!-- assertion: verdict-requires-tldr -->
<!-- assertion: details-dropdown-required -->
<!-- assertion: format-gate-blocks-completion -->
<!-- assertion: verdict-tldr-first -->
<!-- assertion: tldr-covers-all-axes -->
<!-- assertion: full-verdict-in-details -->
<!-- assertion: no-detail-dropped -->
<!-- assertion: verdict-publication-explicit-intent -->
<!-- assertion: verdict-publication-verified-when-authorized -->
<!-- assertion: bare-full-review-read-only -->
<!-- assertion: router-mode-authority -->
<!-- assertion: no-self-elevation-for-full-review -->
<!-- assertion: chat-delivery-read-only -->
<!-- /assertion-anchors -->

Once an authorized verdict comment is complete, that comment becomes immutable
historical review evidence.

When publication was authorized, the final chat report must use:

- `posted new verdict comment` when this run created a new top-level verdict;
- `repaired current-run verdict comment` only when this run repaired its own
  incomplete publication;
- `reused same-head verdict comment` when a completed same-head verdict was
  reused because the material delta was empty.

For a read-only run, report that the verdict was delivered in chat and that no
GitHub verdict publication was authorized.

## Goal

Same babysit bar as **make merge-ready**: clear useful human + bot comments as
authorized, own bug + security + **spec/standards**, verify **required CI
green**, then deliver a complete **verdict**. Publish that verdict to GitHub
only when explicitly requested. Do **not** merge unless asked.

**Keep going on each targeted PR** until that bar (or a **hard blocker**). Soft opinions are not stop conditions.

Skip 0.1% nits. No follow-up PR for in-scope fixes.

A normal full review runs **no-comments** then, after correctness work, **simplify**, unless this request opts out. Bare full review still does not gain `push_code`; those passes are report-only until the request already allows a code push. Line count is never a goal.

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

**Forbidden stop excuses** (report in chat if relevant, but **keep fixing CI + comments when those mutations are authorized**):

- “Needs maintainer security ack” / “should get human OK first”
- “Security relevance possible” without a concrete unfixed finding
- Treating shared/infra CI noise as done while **this PR’s** required checks are still red (classify + flake retries per shared rules; if budget exhausted → hard-blocker row, not a fake `gated`)
- Skipping a required CI failure as “unrelated / introduced elsewhere” instead of a minimal harden/fix when the request authorizes that fix (shared scope lock)

## Steps

1. Identify PR(s); checkout head (subagent preflight); note base, linked issues, draft/WIP gates, and the PR author vs authenticated viewer (shared **PR ownership boundary**). If draft and user wanted green/merge-ready: ask once about **Draft → ready**.
2. Usefulness pass: real bug / claimed value? If not → `not-useful` verdict and stop that PR only.
3. Parallel where useful: **Bug** via **`references/bug-review.md`** (scope → Bugbot when Cursor → static analysis leads + complementary). On Cursor, use that file's literal `review-bugbot` prompt contract; do not construct or paraphrase a replacement prompt in this workflow. **Security** via **`references/security-review.md`** (never Cursor harness `security-review` / `review-security`). Run **Spec + Standards** through the bundled **`references/spec-standards-review.md`** method. It owns the fixed comparison, source discovery, two independent axes, and advisory `references/code-smells.md` baseline; do not depend on an optional external review skill.
4. Triage open human + bot comments (shared rules — owners/maintainers first). Fix useful or decline nits with rationale only when the routed request grants the required mutation. Otherwise report the action in the verdict. Inline replies in-thread only. Resolve bot threads via `scripts/review-threads.mjs --resolve-bot` only when review-thread mutation is authorized. Human threads stay an owner action unless explicit resolution is authorized.
5. Update from base and push the base sync **only when the PR is ours and `push_code` is authorized** (shared **PR ownership boundary**); on a foreign or read-only PR, record the owner actions for the verdict and do not push the base sync.

<!-- assertion-anchors -->
<!-- assertion: foreign-pr-no-base-push -->
<!-- assertion: foreign-pr-no-simplify-edit -->
<!-- assertion: verdict-tells-owner -->
<!-- assertion: owner-updates-base -->
<!-- /assertion-anchors -->

Push scoped fixes only under the existing fork-head/push rules and when
`push_code` is authorized; verify compile/tests against tip; wait and recheck
until useful threads are understood and required CI is green on that tip SHA,
or a hard blocker. Use **rate-limit backoff** (Composio → gh) on dense polls.
**Doomed-run guard:** if a bot review is still in progress or an actionable
human thread is open, finish the permitted triage before settling into the CI
poll. In read-only mode, record actionable feedback rather than mutating it.
6. Changelog nudge if user-facing.
7. **Hygiene simplify:** unless this request opts out (`without simplify`, `skip simplify`, `don't simplify`), run `references/simplify-pr.md` after the concrete bug, security, spec, review, base, and CI work above is clean but before final verdict delivery. No-comments already ran at plan item 2 unless skipped.
   - **Foreign PRs (not ours) or read-only runs:** run the candidate pass, then **do not edit or push**; include the complete bounded candidate list in the verdict for the PR owner and skip the apply, validation, push, and re-review flow.
   - Keep simplification findings separate from required review findings.
   - If the simplify pass reports **nothing worth simplifying**, continue to the normal verdict without changing code.
   - If it reports eligible contract-card candidates on **our own PR** and `push_code` is already allowed, apply them without a second yes.
   - After a head-changing apply, run the remaining review on the exact **post-simplification head** with no-comments and simplify disabled. Re-run usefulness, bug, security, Spec/Standards, comments, base synchronization, compile/tests, required CI, thin settle, and `ship-gate.mjs`; do not merely review the cleanup diff.
   - Deliver the final verdict only from that post-hygiene head. Any regression is a blocker and must be fixed or the responsible candidate rolled back.
   - There is **no recursive simplification** pass during the mandatory re-review. There is **no second continuation prompt**.
8. If concrete necessary issues remain, use `changes-requested`; submit a GitHub Request changes review only when that mutation is explicitly authorized.
9. Before `approve-comment` (or an authorized merge-ready notify): **thin settle** (`references/policy/ci.md`) — ~3–5 min quiet + recheck; activity resets; two-window cap. Skip settle for `changes-requested` / `not-useful` / draft `gated`. **Docs-only fast path:** a docs/markdown-only head uses the **~30–60s** settle in `references/policy/ci.md`. **Doomed-run abort:** if a bot review lands during the settle with findings on this diff (or an actionable human thread appears), reassess and, when fixes are authorized, fix + push and re-enter the settle on the new head.
10. Deliver a **detailed** final verdict only after CI+comments are handled or a real hard blocker / `not-useful` / draft `gated` applies. Use the **Full-review / re-review verdict** template in `references/comment-depth.md` — lead with the **TLDR** (decision, every axis outcome, blockers, owner actions, bottom line) and keep the complete evidence in the required structured form. Fill Usefulness, Bugs, Security, Spec, Reviews, Base/CI, Gate, Bottom line with paths/SHAs/checks; the TLDR never drops a blocker, owner action, or required next step. When simplification ran, include the candidates, rollback status, validation evidence, and exact post-simplification head. When the PR is not ours or the run is read-only, include the owner actions instead of performing unauthorized mutations. If GitHub verdict publication is explicitly authorized, use the format-valid `[GD] Verdict` comment contract and verify it after posting/reuse.

When an authorized `[GD] Verdict` comment posts, run `planNativeReviewSidecar` and execute its broker operations through `github-mutate.mjs` only if the routed request also authorizes the required native-review mutation. Never submit GitHub Approve unless the user explicitly asked.

If the verdict is `approve-comment`, post merge-ready PR + linked-issue notifications only when those publication actions are authorized by the routed request. Otherwise report merge readiness in the chat verdict without mutating GitHub.

## Done when

For **every** targeted PR:

- Usefulness assessed
- Bug + security reviews done
- Bundled Spec + Standards method completed on the recorded base/head comparison, with sources and both axis results preserved
- Useful bots/humans handled or recorded as owner actions according to the routed mutation authority
- Required CI green **or** hard-blocker reported (flake budget exhausted / permissions / etc.) — **never** “done” with unexplained red CI
- When no-comments or simplify ran: findings were reported or applied per ownership/`push_code`, validation passed, and the remaining review reran on the post-hygiene head with both passes disabled and no recursive hygiene
- Foreign/read-only PRs: no unauthorized base-sync push, simplification edit, thread resolution, review submission, or comment publication
- Thin settle completed before `approve-comment` / authorized merge-ready publication (not for reject/gated labels)
- Final verdict delivered with a **valid** label (see table)
- If verdict publication was explicitly authorized: the verdict is published and verified via `scripts/verify-verdict-published.mjs` (`published: true` and `format.valid: true`), or a recorded publication-unavailable hard blocker exists
- If publication was not authorized: no GitHub verdict/comment mutation was attempted
- No invented maintainer-ack / soft-security stop
