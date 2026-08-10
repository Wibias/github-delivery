# Adaptive CI Wait Design

## Problem

GitHub Delivery currently documents runner-specific CI timing assumptions in `references/watch-pr.md`, including a fixed expectation for `windows-latest`. Agents can copy that assumption into progress updates even when a different check is the slowest one. Agents can also hand-roll bounded polling loops with an arbitrary total wait such as 20 minutes.

## Goals

- Use 5 minutes as the default CI duration estimate when no history exists.
- Poll every 30 seconds while CI is the only actionable blocker.
- Treat 5 minutes as an estimate, never as an automatic timeout.
- Never claim that Windows, macOS, Linux, or another runner is slow unless the current GitHub check evidence names it.
- Learn typical durations per repository and check identity from successful completed checks observed over time.
- Keep the authoritative ship gate in control of whether waiting is allowed.
- Stop waiting immediately when the head moves or a non-CI blocker appears.

## Architecture

Add a small CI wait driver, `scripts/ci-wait.mjs`, backed by pure timing/history helpers in `scripts/lib/ci-wait-timing.mjs`.

Each poll does the following:

1. Run the authoritative `ship-gate.mjs` for the selected workflow and mutation mode.
2. If the gate is ready, exit successfully.
3. If the gate is unknown, or blocked for anything other than pending required CI, stop and return control to the workflow.
4. Read current check runs for the authoritative check SHA.
5. Record durations from successful completed check runs in local user-scoped history.
6. Report the actual pending check names and elapsed time. Use learned timing only when at least 3 samples exist for that repo/check identity; otherwise use the 5-minute default estimate.
7. Sleep 30 seconds, then repeat. There is no fixed iteration cap.

The driver pins the initial PR head. A moved head is a hard restart signal rather than a continuation of stale timing state.

## Timing model

History is stored under `${GITHUB_DELIVERY_STATE_DIR:-~/.github-delivery}/ci-wait-history.json`.

A timing key is repository + check context + GitHub App id when available. Each key retains at most the 20 most recent successful samples and deduplicates by check-run id.

For 3 or more samples:

- `typical` = median duration.
- `usually done by` = nearest-rank p90 duration.

For fewer than 3 samples:

- `typical` = 5-minute default estimate.
- The output states that timing history is not established yet.

The history contains only check identity, duration, completion timestamp, and check-run id. It contains no credentials or repository contents.

## Progress output

Progress text must describe evidence, not assumptions. Examples:

```text
2 required checks still pending.
Longest-running: test (macos-latest), 8m 12s elapsed.
Typical duration: 9m 05s from 11 recent runs.
Next check in 30s.
```

Unknown-history example:

```text
1 required check still pending.
Longest-running: integration-tests, 6m 40s elapsed.
Running longer than the 5m default estimate.
Next check in 30s.
```

The tool may repeat a runner label only when it is part of the current GitHub check context or other current check metadata. It must not infer a runner from historical prose.

## Policy changes

`references/policy/ci.md` becomes the canonical source for CI wait cadence and timing semantics. `references/watch-pr.md` must stop naming `windows-latest` as a generally slow runner and instead delegate timing to the adaptive wait rule/driver.

The merge workflow may use the same driver with `--workflow merge-pr --mutation-mode maintainer`; watch flows may use the same mechanism with their compatible workflow/mode.

## Error handling

- Gate unknown: stop waiting, preserve the gate reason, and let the parent workflow restore evidence.
- Non-CI blocker: stop waiting and surface the blocker.
- Head change: stop with a distinct restart result.
- GitHub/API failure: stop with an error instead of guessing.
- Corrupt history: ignore the corrupt cache for estimation, start from the default estimate, and replace it only after valid observations can be written.

## Testing

Unit tests cover:

- 5-minute default estimate before history is established.
- Median and p90 estimates after at least 3 samples.
- deduplication and the 20-sample cap.
- selection of the actual longest-running pending check without OS preference.
- the 30-second polling default and absence of an iteration timeout.
- documentation regression: no hard-coded `windows-latest` duration guidance remains in the watch workflow.
