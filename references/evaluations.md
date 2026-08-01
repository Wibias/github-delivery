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
- emits one versioned JSON report;
- exits `1` for contract failures and `2` for validator failure.

These checks require no model provider, network, GitHub authentication, or agent host.

## Natural-language route contract

The deterministic router is a test oracle for skill behavior, not a replacement for host discovery. The actual user experience remains:

```text
merge PR #32
```

The host discovers `shipping-github` from `SKILL.md`. The skill then routes to `references/merge-pr.md`, selects `maintainer` mode for the explicit merge workflow, discovers capabilities, runs the authoritative gate, and uses the mutation broker internally.

The routing oracle catches accidental contract drift in that chain.

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
