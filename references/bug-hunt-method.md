# Deep bug-hunt method

Companion to `references/bug-review.md`. The bug axis runs this method when the
scope script says `skipDeepBugReview: false`. It merges the strongest
techniques from community bug-hunting skills: complete input gathering,
attack-surface mapping, adversarial verification (Finder → Challenger → Arbiter),
systematic root-cause fixing, and honest coverage reporting.

## 1. Input gathering (never skip)

1. Get the **full diff** (`git diff <base>...<head>` for PRs, or the branch
   diff). If output is truncated, read each changed file individually until
   every changed line has been seen.
2. List all files modified **before** starting. Scan **full file contents**,
   not just the diff — the diff is the seed, the full file is the evidence.
3. Filter non-source material with explicit counts: docs, config, lockfiles,
   minified/maps, assets, vendor dirs, **generated code (`*.gen.*`,
   `generated/`, `mocks/`), test fixtures, snapshots, golden files, and HTTP
   cassettes** (they skew complexity and marker counts). Zero scannable files
   → state that and stop the deep pass.

## 2. Attack-surface map (per changed file)

For each changed file, record:

- user inputs (request params, headers, body, URL components)
- database queries
- authentication / authorization checks
- session / state operations
- external calls
- cryptographic operations
- trust boundaries crossed

This map feeds the security axis (`references/security-review.md`) and the bug
lenses below. Do not build a second map in the security pass — share it.

## 3. Adversarial verification trio

Run **one structured pass**: Finder → Challenger → Arbiter, in **isolated
contexts** (each role sees only structured findings, never the other role's
reasoning — this prevents anchoring bias).

Small diffs (≤10 files): single Finder + single Challenger. Larger diffs: chunk by
service boundary or risk tier (CRITICAL → HIGH → MEDIUM → LOW), persist chunk
state, and do not re-scan done chunks.

### 3.1 Finder (over-report bias)

- Scoring incentive: **+1 low, +5 medium, +10 critical**. A false positive
  costs nothing; a missed real bug loses points. Report anything that could be
  a problem — do not self-censor.
- Cover the three complementary lenses (`silent_failures`, `resource_leaks`,
  `edge_cases`) and the Must-probe block from `bug-review.md` (typed catch in
  detached work, `finally` not replacing the original error, lock contention →
  retryable API, deterministic lock/cleanup tests).
- Every finding is a **finding card** (see §4). No card → no finding.

### 3.2 Challenger (disprove by code, not theory)

- Read the actual code at the reported file/line for **every** card before
  judging. Never argue theoretically.
- Scoring: disproving a false positive earns the card's points; wrongly
  dismissing a real bug costs **2×** the card's points. Only disprove when
  confidence > 67% (expected-value rule: EV = confidence% × points − (100 −
  confidence%) × 2 × points).
- Unsure → **ACCEPT** and let the Arbiter decide.

### 3.3 Arbiter (independent verdict)

- Independently read the code for every disputed card and every
  Critical/High card. Do not rubber-stamp either side.
- Verdict per card: `REAL BUG` / `NOT A BUG`, confidence (High/Medium/Low),
  true severity (may upgrade/downgrade), and a fix direction for real bugs.
- Role failure or timeout (any role): mark affected findings **unreviewed** and
  disable fixing for them. Never silently confirm or silently drop.

## 4. Finding card schema

```
BUG-N | Severity: Critical/High/Medium/Low | Confidence: High/Medium/Low
- File: <exact path>
- Line(s): <line or range>
- Category: logic | security | error-handling | concurrency | edge-case |
  performance | data-integrity | type-safety | resource-leak | other
- Claim: <one sentence — what is wrong>
- Evidence: <exact code quote that demonstrates it>
- Runtime trigger: <what input/action/state reaches the bad path>
- Fix direction: <concrete, minimal suggestion>
- References: <OWASP/RFC/standards where applicable>
```

No card without evidence. A card without a runtime trigger stays
`manual-review` (MEDIUM confidence at best).

## 5. Coverage and result buckets

Classify every card into exactly one bucket:

| Bucket | Meaning |
| --- | --- |
| **confirmed** | Arbiter `REAL BUG`, High confidence |
| **dismissed** | Disproved by Challenger and/or Arbiter (keep for transparency) |
| **manual-review** | Real-looking but path/impact unclear or confidence < High |
| **unreviewed** | Role failed or timed out before a verdict |

**No "clean" claim while coverage is partial.** If any scannable source file in
scope was not read, the report must say `PARTIAL COVERAGE` and list the
unscanned files — never "audit complete" or "no bugs found".

## 6. Systematic fix protocol (fix paths only)

Applies when the workflow authorizes fixing (`fix-pr-bots`, full-review,
create-PR).

**Iron law: no fixes without root-cause investigation first.** Symptom fixes
are failure.

### Phase 1 — Root cause

1. Read error messages and stack traces completely; note file/line/code.
2. Reproduce consistently (exact steps; every time?). If not reproducible,
   gather more data — do not guess.
3. Check recent changes: diff, commits, dependencies, config, environment.
4. Multi-component systems: add diagnostic instrumentation at **each component
   boundary** (what enters, what exits, config propagation), run once, find the
   failing layer, then investigate that layer.
5. Trace data flow backward from the symptom to the original trigger
   (`root-cause-tracing` pattern). Fix at the source, never at the symptom.

### Phase 2 — Pattern

- Find similar **working** code in the same codebase and compare.
- If implementing a reference pattern, read the reference implementation
  completely — partial understanding guarantees bugs.
- List every difference between working and broken, however small.
- Map dependencies, settings, and assumptions.

### Phase 3 — Hypothesis

- Form **one** specific hypothesis ("X is the root cause because Y").
- Test with the **smallest possible change**, one variable at a time.
- Verify before continuing. Wrong → new hypothesis. Never stack fixes.

### Phase 4 — Implementation

1. Write a **failing test first** (state-based, asserts observable outcomes).
2. Implement the minimal single fix — no "while I'm here" changes.
3. Verify: targeted test passes, full suite passes, issue actually resolved.
4. **Defense-in-depth:** where the root cause was invalid/missing data, add
   validation at every layer the data passes through (entry, business logic,
   environment guards, debug instrumentation) so the bug becomes structurally
   impossible — not merely fixed at one point.
5. Regression test required for every fixed High/Critical; if none, state why.
   Size the regression coverage by cyclomatic complexity: 1–5 → 2–5 tests;
   6–10 → 6–15; 11–20 → 16–40; > 20 → refactor first (a complex function
   needs path coverage, not one happy-path test).
6. **Central-file coupling:** if the fix touches a file many other files depend
   on, classify the blast radius before editing:
   - **Direct** — explicit imports/calls; will break if the signature changes.
   - **Implicit** — files that change together with the target without
     importing it (temporal coupling); they share state or assumptions.
   - **Behavioral** — same owner/team; likely understands the change.
   - **Unknown** — no coupling, different owner; needs extra review.
   Enumerate dependents (transitive callers/callees) and include them in
   verification — changing a hub breaks many things, not just the tested path.

### After 3 failed fixes

**Stop and question the architecture.** Each fix revealing a new problem in a
different place, or fixes requiring massive refactoring, means the pattern
itself is wrong. Discuss with the human before attempting fix #4. This is not a
failed hypothesis — it is a wrong architecture.

### Red flags (stop and return to Phase 1)

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll verify manually"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "One more fix attempt" after 2+ already failed

### Git safety while fixing

- Record a test baseline before the first fix; run the targeted + full gates
  after each fix batch.
- **Canary-first:** fix the top critical/high subset, verify, then continue
  with the rest. Keep low-confidence cards out of the edit set.
- New failures after a fix → revert that fix (or fix forward once), never ship
  a red tree.
- Only edit files in the validated finding scope; never stage unrelated paths.

## 7. Pre-conclusion audit and report discipline

Before finalizing **any** verdict:

- List every file reviewed and confirm each was read completely.
- Walk every checklist item: `issue` or `clean` — no skipped rows.
- List areas that could **not** be fully verified and why.
- **Body-diff rule:** compare response bodies, not just status codes, when
  verifying behavior claims.
- **Statistical-sample rule:** timing/rate claims need repeated samples, not
  one observation.
- **Don't invent issues.** If nothing significant: say so clearly — a clean
  report is a good result. Do not pad with style/formatting nits.
- Do not make changes unless the workflow authorized fixing.

Chat gets full cards; PR comments get the condensed `comment-depth.md` shape.
Keep dismissed cards in a collapsed `<details>` block for transparency.
