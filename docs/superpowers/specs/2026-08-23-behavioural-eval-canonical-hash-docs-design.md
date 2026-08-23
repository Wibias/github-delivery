# Behavioural eval canonical transcript hash in docs

## Status

Approved 2026-08-23. Branch from current `origin/main`. Docs leftover after PR #356 only. Do not reuse GD-AUDIT-051.

## Problem

PR #356 removed the in-pack `trace` example and documented the sidecar. The pack example still said `transcriptsSha256` was the SHA-256 of `candidate.transcript.json` file bytes. Runtime hashes `canonicalJson(parsedSidecar)` via `hashBehaviouralTranscripts`. Those hashes differ, so following the docs literally fails closed with `behavioural_transcript_hash_mismatch`.

## Approach

1. Document `transcriptsSha256` as the SHA-256 of `canonicalJson` of the parsed sidecar object.
2. Point writers at `hashBehaviouralTranscripts` / `attachTranscriptProvenance`.
3. Put the runtime hash of the documented sidecar object into the example.
4. Score that example through `scoreBehaviouralRun` in tests.

Do not add a new CLI. Do not change the hasher.
