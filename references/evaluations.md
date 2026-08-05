# Evaluations

The skill has two evaluation layers. They serve different purposes and must not be confused merely because both involve the fashionable word “eval.”

## PR-blocking offline contracts

Run on every `npm run check`:

```bash
npm run evals:offline
```

The validator:

- parses every `tests/evals/*.jsonl` file;
- validates required fields and unique case IDs;
- validates assertion ID syntax;
- verifies every expected resource exists;
- executes deterministic natural-language routing cases;
- confirms must-not-trigger cases remain outside the skill;
- verifies every retained regression line against `regression-lock.json`;
- binds every regression assertion to a `<!-- assertion: … -->` marker inside
  one of the case's expected resources (`assertion_not_bound` /
  `assertion_not_in_expected_resources` / `assertion_marker_orphan`);
- executes `tests/evals/scope-cases.jsonl` diff-shape fixtures through
  `planReviewScope` and asserts the exact `requiredProbes` set
  (`scope_case_probe_mismatch`);
- verifies every probe in `scripts/lib/probe-registry.mjs` carries a
  `<!-- probe: … -->` tag in a doc that also holds its assertion markers
  (`probe_not_tagged_in_docs` / `probe_assertion_wrong_doc` / `probe_registry_invalid`);
- emits one versioned JSON report;
- exits `1` for contract failures and `2` for validator failure.

These checks require no model provider, network, GitHub authentication, or agent host.

## Natural-language route contract

The deterministic router is a test oracle for skill behavior, not a replacement for host discovery. The actual user experience remains:

```text
merge PR #32
```

The host discovers `github-delivery` from `SKILL.md`. The skill then routes to `references/merge-pr.md`, selects `maintainer` mode for the explicit merge workflow, discovers capabilities, runs the authoritative gate, and uses the mutation broker internally.

The routing oracle catches accidental contract drift in that chain.

## Scope routing contract (diff shape → probe)

Separate from natural-language routing, the **scope engine** must map a diff
shape to the review probes that apply. Each probe is a named, deterministic
output of `planReviewScope` (`requiredProbes`), declared in
`scripts/lib/probe-registry.mjs` with trigger regexes on added/removed lines
and changed paths. The Must-probe blocks in `bug-review.md` /
`security-review.md` carry a matching `<!-- probe: … -->` tag, and the
regression assertions inside each block are pinned to that probe.

`tests/evals/scope-cases.jsonl` holds one fixture per CodeRabbit/Codex
diff-shape class: a concrete file/patch and the exact `requiredProbes` set the
engine must emit. CI runs each fixture through `planReviewScope`; a mismatch
means the trigger regex or the documented probe drifted.

This closes the gap between "the probe prose exists" (marker binding) and
"the diff reliably routes the agent to that probe" (scope-case execution) for
surface-detectable classes. Semantic classes that have no structural diff
signal remain covered by the marker binding as the floor.

## Probe-application evidence (review-time gate)

Routing a diff to a probe proves the probe *should* apply; only the review can
prove it *was applied*. So the bug and security axes are not complete until the
agent emits a machine-checkable evidence record for every `requiredProbes[]`
id and `scripts/verify-probe-coverage.mjs` exits `0`.

- Evidence shape: `{ probeId, status, files?, reason? }` per required probe.
- `status` is `clean` / `findings` / `n-a`; `n-a` requires a concrete `reason`;
  `findings` requires `files` that are the probe's trigger files; unknown or
  non-required probe ids are rejected.
- This is a model-behavior contract: the deterministic engine fires the probe,
  the review records application, and the verifier makes the claim
  machine-checkable before an axis can be marked done.

## Retained regressions

Each non-empty line in `regression-cases.jsonl` is hashed exactly as stored. `regression-lock.json` binds the case ID to that SHA-256 digest.

Changing or deleting a retained case therefore fails CI until the lock change is reviewed explicitly. New regressions must be appended with a new ID and lock entry; do not silently rewrite history because a test became inconvenient.

## Model-dependent evaluations

Model runs are manual or scheduled evidence, not ordinary PR-blocking checks. They should:

1. run the same ordered cases against at least two declared capability slots;
2. record the concrete model, host, skill version, and timestamp;
3. record loaded resources, tool calls, final answer, and assertion outcomes;
4. preserve evidence as workflow artifacts or external evaluation records;
5. compare failures against the retained regression set.

A model-provider outage, quota limit, or unavailable optional host must not make a normal code PR fail. The offline contracts continue to enforce routing, resources, safety boundaries, and regression integrity regardless.

## Adding a route case

Add one line to `tests/evals/routing-cases.jsonl` with:

- natural-language prompt;
- expected skill;
- expected workflow;
- expected mutation mode;
- expected and unnecessary resources;
- concrete assertion IDs;
- a short scenario.

Then run `npm run evals:offline` and the unit suite.
