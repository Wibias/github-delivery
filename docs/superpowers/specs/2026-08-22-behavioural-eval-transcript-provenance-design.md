# Behavioural eval transcript provenance

## Status

Approved 2026-08-22. Branch from current `origin/main`. Behavioural-eval scoring only.

## Problem

GD-AUDIT-021 made the scorer read `result.trace`, but that trace still lives in the same run pack as the claimed summary. A pack can invent a consistent trace. That checks internal consistency, not independent provenance.

This does not change authority grants, routing, or installer recovery.

## Approach

1. Reject any `trace` nested inside a run result.
2. Score only from a separately supplied transcripts object keyed by case id.
3. Bind `run.provenance.transcriptsSha256` to the hash of those transcripts. Mismatch fails closed.
4. `compare-behavioural-evals.mjs` loads `<run>.transcript.json` beside each run file.

Do not add a live GitHub mutation fixture.

## Tests

- An in-pack `result.trace` is rejected even when it matches the summary.
- Scoring uses sidecar transcripts whose hash matches `provenance.transcriptsSha256`.
- A hash mismatch fails closed.
