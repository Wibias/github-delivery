# Bug review

**Trigger:** own-bug axis on merge-ready / full-review / create-PR; or explicit “bug review on pr #N”.

## Goal

Find **real** correctness bugs, silent failures, resource leaks, and edge cases on the PR (or branch) diff. Prefer high-confidence findings over checklist theater. Fix Confirmed High/Critical in-PR on merge-ready paths.

Do **not** merge unless asked.

**Bar:** run **`scripts/bug-scope.mjs`** (PR) then this method. Skip deep review only when scope says `skipDeepBugReview: true` (and say why).

## Deep multi-agent / adversarial bug kits (explicit ask only)

**Default: skip. Hardcoded never-on-own.**

Do **not** auto-launch Claude pr-review-toolkit / ultrareview fleets, Codex `adversarial-review`, or similar multi-agent audit kits. Ordinary full-review / merge-ready is **not** permission.

When (and only when) the user asks (“deep bug review”, “run pr-review-toolkit”, “adversarial review”, etc.): run that kit, keep the same confidence gate, fold into chat.

The in-session complementary pass (§2) already runs an adversarial
Finder → Challenger → Arbiter structure from `references/bug-hunt-method.md`.
That is the built-in method (parent or one helper subagent, sequential), not an
external kit and not permission to launch one.

## Mandatory method (do not skip)

### 0. Scope script (required for PRs)

```bash
node "<github-delivery>/scripts/bug-scope.mjs" OWNER/REPO N
```

- If `skipDeepBugReview: true` → record **n/a** in chat (and comment templates); stop the bug axis for this PR. Do **not** invent Bugbot.
- Else cover every `requiredLenses[]` in **one** complementary pass (below).
- `requireBugbot: "when_available"` → Cursor only (see adapter).
- `deepMultiAgentDefault` is always `false`.
- Follow `instructions[]` from the JSON.

Issue-only / no PR: if reviewing local branch for create-PR, treat logic file changes like deep; docs-only like skip.

### 1. Platform adapter

Checkout PR head first (shared **Subagent preflight**).

#### Cursor

1. Launch **exactly one** `bugbot` via `review-bugbot`. The **entire prompt must contain exactly two lines, and both lines must be non-empty**:

   ```text
   Full Repository Path: <absolute path to the checked-out repository>
   Diff: branch changes
   ```

   Replace the placeholder with the actual absolute local filesystem path after checkout. Do **not** use `OWNER/REPO`. Do not paraphrase, rename, bullet, quote, or otherwise alter either field label or value.

2. There must be **nothing after** the `Diff:` line: no blank-line payload, `Base Reference`, PR number or title, issue text, file list, review focus, explanation, or other prose. For a PR whose base is not the repository default, checkout the correct PR head and preserve the repository state locally; do not encode the base in the Bugbot prompt.
3. If the user explicitly asked for uncommitted-only review, use the same exact two-line prompt and change only the second line to `Diff: uncommitted changes`.
4. On a missing-field, unsupported-`Diff`, or wrong-invocation validator error, retry **once** with the appropriate exact two-line prompt and nothing else.
5. If Bugbot still cannot compute the requested diff after that retry, state that Bugbot is unavailable for this review and continue with the complementary pass. Do **not** invent another prompt shape or fake a Bugbot report.
6. Then run **§2 Complementary** (additive, even if Bugbot found nothing).

### Cursor Bugbot liveness rule

Bugbot supplies advisory evidence; it does not own full-review completion.

Do not leave the parent full-review run with a pending verdict solely because
Bugbot has not produced a usable result. When the host supports parallel
reviewer execution, launch Bugbot without making it the sole blocking parent
task and continue the complementary review axes.

At the Bugbot join point:

- accept a completed Bugbot result;
- allow the single documented exact-schema retry after a validator rejection;
- if Bugbot remains at `Planning next moves`, returns no usable result, or is
  otherwise unavailable, record `Bugbot unavailable` with the observed reason;
- complete the complementary in-session bug review;
- continue automatically through security review, Spec and Standards review,
  head refresh, authoritative ship gate, and the mandatory final verdict.

Bugbot unavailability is evidence to include in the final verdict. It is not a
terminal workflow state.

Never keep `Publish final verdict` pending merely to wait indefinitely for
Bugbot.

#### Claude

1. **Never** launch Task `bugbot` / claim Bugbot ran.
2. Run **§2 Complementary** in-session **or** one `generalPurpose` subagent briefed: follow this file’s lenses on branch changes vs PR base; HIGH confidence only.

#### Codex

1. **Never** claim Cursor Bugbot ran.
2. If Codex CLI `/review` (or equivalent read-only review) is available this session: run **once**, then **§2 Complementary**.
3. Else: same as Claude (complementary only).

### 2. Complementary lenses (required when not skipDeep)

**One** structured pass (parent or one helper subagent) covering all of:

Run it as the adversarial **Finder → Challenger → Arbiter** trio per
`references/bug-hunt-method.md` §3, in isolated reasoning steps (each role sees
only structured finding cards, never the other role's narrative). Use the
finding-card schema (§4 there), result buckets `confirmed` / `dismissed` /
`manual-review` / `unreviewed` (§5 there), and the coverage rule: **no clean
claim while scannable files are unscanned**.

#### Static analysis leads (run before the lenses)

Run the repo's static gates on the changed paths when available —
typecheck/compile (`tsc --noEmit`, project lint script, etc.) and analyzers
(Semgrep, CodeQL) when the repo has them.

**Manual static-lead heuristics (no tool required):**

- Complexity bands: cyclomatic < 10 safe / 10–20 warning / > 20 danger;
  cognitive < 15 / 15–30 / > 30. Functions in the diff beyond the warning
  bands get focused review of error paths and boundary conditions.
- Hotspots: changed files ranking in roughly the top 20% of both historical
  churn **and** complexity are the highest-risk — prioritize them.
- Markers: BUG/FIXME/HACK/SECURITY/TODO comments in changed code are leads;
  defect markers (BUG/FIXME) first. **Newly added HACK/FIXME in the diff needs
  justification.**
- Change risk: large line additions, scattered changes (high entropy), many
  files, or files with diffuse ownership get extra scrutiny.
- Clones: duplicated code ≥ 6 lines at ≥ 80% similarity in the diff is a real
  duplication lead — find every copy before confirming or fixing
  (fix-one-forget-others).
- Orphaned code: newly dead/unreachable code in the diff is a lead — dead code
  hides bugs and misleads fixers.

- Results are **leads only**: a green gate is not "no bugs"; a failing gate on a
  changed path must be confirmed manually before it becomes a finding.
- Missing tool → `n/a (not installed)` — still do the manual lens pass below.
- Fold confirmed hits into the lens rows below with the §3 confidence gate
  (never auto-Confirm a tool hit).

| Lens                | What to prove                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **silent_failures** | Empty/swallowed `catch`; ignored promises; missing error paths; fail-open that hides breakage; **error propagation** (below)                              |
| **resource_leaks**  | Timers/listeners/handles/connections/streams not cleaned; missing `AbortSignal` / dispose on cancel                                                       |
| **edge_cases**      | Null/empty/partial collections; off-by-one bounds; races/TOCTOU on shared state; partial failure mid-batch; **recursive/re-entrant lookup must terminate** (self-recursion on a resolved target = stack overflow); **lock/contention → caller contract** (below) |
| **api_cli_wiring**  | New/changed CLI flags, request fields, DTO columns, route params: trace to business effect; unused public params; downstream consumers assert every field they rely on; adversarial config (empty lists, zero weights, namespace collisions) |
| **input_shape**     | Parsers/scanners/evidence-derivers validated against the **real request shapes** the runtime accepts (nested arrays, multiple adapters), not just the fixture shape used in tests; shallow depth-limited scans over nested content are bugs |
| **evidence_semantics** | Boolean/evidence classification must return **definitive negatives** (unknown ≠ false); no fact inferred from an adjacent field (e.g. `parallelToolCalls === true` is not proof of tool support); **absence of a positive flag is not proof of absence** (single tool calls work without `parallelToolCalls`); **evidence must aggregate all contributing source records** (nested attempts/retries), not only top-level rows |
| **hot_path_scale**  | Request-path and rebuild code must not load unbounded input into memory (full-file reads, full-ledger allocations), must not do per-candidate disk I/O or repeated expensive computation; incremental paths must not regress to full rebuilds (identity keys on volatile fields like size/mtime) |
| **determinism_metrics** | Aggregation/truncation must be deterministic (stable tie-break keys); grouping keys include every distinguishing dimension (e.g. profile revision); output metric names must not promise more than the value means |
| **malformed_input_robustness** | Parsers/validators must distinguish absent vs malformed, reject or skip invalid rows instead of 500 or fail-open; unguarded `JSON.parse` / `decodeURIComponent` on persisted or user input is a bug; fallback values must not defeat documented guards |

On Cursor this is **additive to Bugbot** (Bugbot leans precision and can under-index leaks / silent fails / API contracts).

#### Must probe — API/CLI wiring (CodeRabbit/Codex often catch these first)

When the diff adds or changes **user-facing surfaces** (CLI subcommands/flags, HTTP request/response fields, management DTOs, evaluator parameters, route-policy inputs), **explicitly** check:

1. **End-to-end trace** — each new/changed input must reach a business effect (not merely parsed, forwarded, or declared). A public parameter that is never read is a **Confirmed** bug unless documented as intentionally reserved.
2. **Downstream contract** — every field a downstream module reads from an API/DB row must be produced by the upstream layer **and** asserted in at least one test when the PR introduces that dependency.
3. **Operator smoke** — run at least one realistic command or API call per new surface (or document why impossible). Green unit tests alone do not prove flags work.
4. **Test honesty** — test names and PR claims must match assertions (e.g. a “tie-break” test must force a tie; an API list test must assert fields the CLI consumes).
5. **Adversarial config** — empty candidate lists, all-zero weights, alias namespace collisions, missing subcommands, and dry-run paths that omit required inputs.

Skip only when the diff clearly adds **no** new CLI/API/DTO/route surface (say so in chat).

#### Must probe — input shape and evidence semantics (CodeRabbit/Codex often catch these first)

When the diff adds or changes parsers, scanners, evidence derivations, capability classifiers, or eligibility logic, **explicitly** check:

1. **Real request shapes** — the scanner must handle the shapes the runtime actually accepts (e.g. image blocks nested under `input[].content[]` / `messages[].content[]`), not only the flat fixture used in tests. A depth-limited scan over nested content is a **Confirmed** bug when real requests nest it.
2. **Unknown is not false** — eligibility/classification must record definitive negatives. If a classifier can determine `localOnly`/`remoteAllowed`, `supported`/`unsupported`, etc., it must set **both** complementary fields once classified; leaving the opposite unknown lets `allow`/`penalize` unknown-evidence modes satisfy the wrong requirement.
3. **No inference from adjacent fields** — a boolean must not be derived from a field that documents something else (e.g. `parallelToolCalls === true` does not prove tool support). Confirm the field actually means what the classifier claims. Conversely, **absence of a positive flag is not proof of absence** — a provider that runs single tool calls without `parallelToolCalls` must not report tools as unknown and exclude valid candidates.
4. **Every accepted input affects eligibility** — if the CLI/API accepts dry-run evidence (context window, structured output, service tier, encrypted task, cost), each accepted field must be consumed by the evaluator or documented as intentionally ignored. Accepted-but-ignored inputs are no-op bugs.
5. **Aggregate all contributing source records** — evidence derived from persisted history must include nested contributing records (e.g. combo/failover `entry.attempts`), not only the top-level outcome row; otherwise hidden upstream failures poison health/eligibility.

Skip only when the diff has no parser/scanner/classifier changes (say so in chat).

#### Must probe — recursive and re-entrant lookups must terminate (CodeRabbit/Codex often catch these first)

When the diff adds or changes routing, alias, lookup, or resolver recursion, **explicitly** check:

1. **No self-recursion on a resolved target** — after a lookup resolves a concrete target (e.g. a policy alias → winning `provider/model`), the resolved value must not be routed back through the same resolver; that recurses until stack overflow when the alias equals its own output.
2. **Aliases must not shadow the resolver's own namespace** — if a profile alias is an explicit `provider/model` slug and aliases resolve before provider namespaces, the alias takes over the concrete route; reject aliases under configured provider namespaces or resolve concrete targets with policy lookup disabled.
3. **Termination guard** — any resolver that calls itself (directly or via a chain) needs an exit condition that cannot be re-entered by its own output; review the guard when the output shape equals the input shape.

Skip only when the diff adds no routing/alias/lookup recursion (say so in chat).

#### Must probe — CLI/API payload completeness (CodeRabbit/Codex often catch these first)

When the diff adds or changes a CLI command that calls a management API or evaluator, **explicitly** check:

1. **The CLI sends the same payload the API/evaluator consumes** — if the evaluator needs candidate evidence for a dry-run, the CLI must populate it from config, not post only request evidence so the route converts it to an empty list (unknown-everything → `exclude` rejects valid candidates).
2. **Empty-list semantics** — when a CLI/API converts missing input to an empty list, confirm what the evaluator does with that list; an empty candidate list combined with `unknownEvidence.capability: "exclude"` making every candidate ineligible is a wiring bug, not a dry-run success.

Skip only when the diff adds no CLI→API/evaluator call path (say so in chat).

#### Must probe — hot-path scale and determinism (CodeRabbit/Codex often catch these first)

When the diff adds or changes request-path, ingest, indexing, or analytics code, **explicitly** check:

1. **No unbounded memory** — full-file reads (`.readFileSync` of a large append-only ledger) or full-collection allocations before streaming/splitting are **Confirmed** on user-sized inputs. Read and ingest bounded chunks.
2. **No per-candidate / per-request I/O** — disk reads, catalog parses, or expensive re-computation inside a per-candidate/per-row loop are hot-path bugs; hoist or cache.
3. **Incremental paths stay incremental** — an identity/change check that includes volatile fields (`size`, `mtime`) turns every append into a full rebuild; stable identity (path/dev/ino/birthtime) for replacement detection, volatile fields only for tail decisions.
4. **Deterministic output** — truncation/aggregation needs a stable tie-break key (e.g. `timestamp DESC, request_id DESC`); identical calls must analyze the same rows. Grouping keys must include every distinguishing dimension (e.g. profile revision) or revisions are conflated.
5. **Metric names match semantics** — an output named `totalRequests` must not actually be a capped sample size; drop or rename counters that are always equal.

Skip only when the diff has no request-path/ingest/analytics changes (say so in chat).

#### Must probe — malformed-input robustness (CodeRabbit/Codex often catch these first)

When the diff adds or changes parsers, persistence, or route/query validation, **explicitly** check:

1. **Malformed rows must not 500 the surface** — unguarded `JSON.parse` / `decodeURIComponent` on a damaged persisted row or user query is a **Confirmed** bug; skip or reject the row, return 400 for malformed input.
2. **Absent vs malformed** — a missing query param and a malformed one are different states; `?limit=invalid` must 400, not silently disable validation/filtering.
3. **Partial/structurally-incomplete rows** — validate every NOT NULL/schema-required column before returning a row; a row that passes the parser but fails the insert is a bug (skip it per documented intent, or reject explicitly).
4. **Fallbacks must not defeat guards** — `?? raw` or similar fallbacks that resurrect an object the normalizer just rejected re-introduce the corruption the guard was documented to prevent.

Skip only when the diff has no parser/persistence/validation changes (say so in chat).

#### Must probe — Bugbot often misses these

When the diff touches locks, mutations, OAuth/refresh, detached/background tasks, `finally` cleanup, or HTTP/API error mapping, **explicitly** check:

1. **Typed catch in detached/async work** — background/OAuth/commit tasks must catch the lock/mutation error type they can hit, clear pending/in-flight state, and surface a **retryable** flow error (not hang, not silent drop).
2. **`finally` must not replace the original error** — `close()` / unlock / dispose in `finally` must not overwrite mutation/rollback failures (preserve or chain the primary error).
3. **Lock contention → retryable API** — callers/management routes map contention/busy to retryable **409/503** (or documented equivalent), not an opaque 500/unknown failure.
4. **Deterministic lock/cleanup regressions** — if the PR adds or changes write-count / lock-cleanup tests, they must be deterministic (no timing flakes); flag flaky new coverage as Needs verification or fix in-PR on merge-ready paths.

Skip this block only when the diff clearly has none of those surfaces (say so in chat).

#### Security → bug handoff

If this session’s **security** pass already touched lock/CAS/auth-refresh/error-mapping, the bug complementary pass **still** must run the Must-probe checks above on those paths. Security Pass ≠ error-propagation covered.

### 3. Validate findings (confidence)

Every card passes **Gate 0** before it can be Confirmed:

1. **What can the actor do right now?** Concrete, specific impact ("an
   unauthenticated user can place a $0 order"), not "could lead to...".
2. **What does the victim lose?** Financial loss, data exposure, privilege,
   or service abuse — attributable and concrete.
3. **Reproduce in 10 minutes from scratch?** Documented steps from a fresh
   state that hit the impact end-to-end.

Vague impact = reject or `manual-review`. Then apply the confidence table:

| Level      | Criteria                              | Action                                   |
| ---------- | ------------------------------------- | ---------------------------------------- |
| **HIGH**   | Concrete failure path + file evidence | **Confirmed** with severity              |
| **MEDIUM** | Suspicious pattern; path unclear      | **Needs verification** only              |
| **LOW**    | Style, rename, theoretical            | Residual only — Do-Not-Flag as Confirmed |

#### Do Not Flag

- Pure style / formatting / rename-only
- Test-fixture noise unless tests are the product under review
- Pre-existing issues outside the diff unless the PR clearly worsens them
- Duplicate of an already-triaged Bugbot finding (merge, don’t double-count)

Severity: Critical / High / Medium / Low / Info (same practical meaning as security-review for ship decisions).

#### Pre-conclusion audit (before any final verdict)

Before finalizing, state in chat:

- every file reviewed, confirming each was read completely;
- every checklist item walked with `issue` or `clean` — no skipped rows;
- every area that could **not** be fully verified and why.

Don't invent issues: if nothing significant is found, say so clearly — a clean
report is a good result. Report-only unless the workflow authorized fixing.

### 4. Fix / ship guidance

On **fix-pr-bots / full-review / create-PR**:

- Fix Confirmed **High/Critical** in this PR when feasible; skip 0.1% nits.
- Prefer a regression test for fixed High/Critical; if none, state why not.
- Follow the **systematic fix protocol** in `references/bug-hunt-method.md` §6:
  root cause investigation before any fix, failing test first, minimal single
  fix, defense-in-depth at every layer, and **stop + question the architecture
  after 3 failed fixes**. Record a test baseline before fixing; canary-first
  rollout for fix batches; revert fixes that introduce new failures.
- Coverage honesty: report `PARTIAL COVERAGE` + unscanned file list when
  scannable files were not read; never claim "no bugs" on a partial pass.

## Steps (summary)

1. Scope script → skip or deep.
2. Platform adapter (Bugbot when Cursor).
3. Static analysis leads (typecheck/lint/analyzers on changed paths; n/a if unavailable).
4. Deep method (`references/bug-hunt-method.md`): input gathering + attack-surface map; Finder → Challenger → Arbiter (if deep).
5. Complementary lenses (if deep).
6. Gate 0 + confidence gate → triage → fix on merge-ready paths (systematic fix protocol).
7. Chat: method used (Bugbot y/n/skip, static done/n-a, trio done/skip, complementary done/skip), confirmed, manual-review, unreviewed, residual.

## Done when

- `bug-scope.mjs` run for PRs (JSON summarized)
- If skipDeep: n/a recorded with why
- Else: static analysis leads run (or n/a with why); complementary lenses completed; on Cursor Bugbot attempted (or unavailability stated)
- Deep method run when not skipDeep: input gathered, attack-surface map built, trio verdicts in the four buckets, coverage stated honestly
- No fake Bugbot on Claude/Codex
- No deep multi-agent kit unless user asked
- Confidence discipline applied; necessary High/Critical fixed or explicit residual on merge-ready paths
