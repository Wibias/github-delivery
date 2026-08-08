# Windows Authority Issuer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Windows 11 trusted-authority issuer that produces TPM-backed ES256 `gd1` grants after Windows Hello approval, while preserving legacy Ed25519 compatibility and adding one-time redemption.

**Architecture:** Keep the existing Node mutation policy/verifier as the enforcement layer. Add exact canonical mutation scopes, algorithm-agile trust-store verification, a tiny length-prefixed Named Pipe client, and a consume-before-spawn execution wrapper. Add a separate per-user .NET 8 WinForms authority host with a default-deny repository allowlist, Windows Hello UI, Microsoft Platform Crypto Provider P-256 key, SQLite nonce ledger, and tray-only administration.

**Tech Stack:** Node 22/24 ESM; .NET 8 WinForms; CNG/TPM ES256; Windows Hello; Named Pipes; Microsoft.Data.Sqlite 8.0.29.

## Global Constraints

- Preserve `gd1` legacy Ed25519 behavior.
- Do not store or commit any private key.
- Do not expose arbitrary signing or administration over the agent pipe.
- Keep trusted authority optional unless the existing strict environment switch is enabled.
- Bind trusted grants to exact GitHub effects, including visible content hashes.
- Redeem only after broker preflight and immediately before the exact write process spawn.
- Keep existing CI check names; build/test the Windows host inside the existing Windows matrix jobs.

---

## Task 1: Canonical authority scopes

- [x] Add `scripts/lib/authority-scope.mjs` with deterministic canonical JSON, per-action exact scopes, visible-content hashing, and ordered batch hashing.
- [x] Add focused Node tests for merge method/head binding, social content/idempotency binding, reviewer canonicalization, branch target binding, and ordered batches.
- [x] Add a stable cross-language scope fixture for the Windows self-test.

## Task 2: Algorithm-agile grant verification

- [x] Extend `scripts/lib/authority-grant.mjs` to support `EdDSA` and `ES256`.
- [x] Add `kid`-selected public trust-store entries with active/retiring/retired lifecycle checks.
- [x] Require exact scope and redemption when the selected trust-store key says so.
- [x] Preserve legacy no-`alg` Ed25519 verification and existing caller-asserted behavior.
- [x] Add ES256, rotation-state, unknown-algorithm, unknown-key, scope-mismatch, and compatibility tests.

## Task 3: Authority host client and batch attachment

- [x] Add `scripts/lib/authority-host-client.mjs` with current-user Windows Named Pipe path, 4-byte length framing, 256 KiB maximum, and `authorizeBatch` / `redeemGrant` calls.
- [x] Add `scripts/lib/authority-batch.mjs` to attach returned grants by exact operation index.
- [x] Add protocol/framing/attachment tests.

## Task 4: One-time redemption at the mutation boundary

- [x] Add `scripts/lib/authority-redemption.mjs` to validate sanitized consume receipts.
- [x] Add `scripts/lib/authority-execution.mjs` to wrap the broker runner and redeem only when the exact planned mutation command is about to spawn.
- [x] Prove preflight reads do not consume, redemption happens before spawn, one execution consumes once, and failed redemption prevents spawning.
- [x] Update `scripts/github-mutate.mjs` to load a public trust store, configure the pipe redeemer, and include sanitized redemption data in receipts/audit output.
- [x] Add `scripts/github-authorize.mjs` to request a precomputed batch and emit grant-attached broker requests.

## Task 5: Windows authority host

- [x] Add a Windows 11 .NET 8 WinForms project.
- [x] Add exact C# scope canonicalization matching the Node fixture.
- [x] Add SQLite default-deny allowlist, signing-key metadata, approvals, grant ledger, and atomic one-time consumption.
- [x] Add Microsoft Platform Crypto Provider ECDSA P-256 persisted non-exportable keys and public trust-store generation.
- [x] Add ES256 `gd1` token creation/verification and short key-rotation overlap.
- [x] Add Windows Hello approval for protected batches and tray-only allowlist/key administration.
- [x] Add a `CurrentUserOnly` Named Pipe server with same-session rejection and only `status`, `authorizeBatch`, and `redeemGrant` methods.
- [x] Add an unattended self-test that does not invoke TPM or Hello.
- [x] Add a per-user PowerShell installer and host README.

## Task 6: Repository integration and policy documentation

- [ ] Add new Node tests/modules/scripts to `package.json` test and syntax-check commands.
- [ ] Build and self-test the Windows host in existing Windows CI matrix jobs without changing required-check names.
- [ ] Update mutation policy, broker documentation, and repository security documentation for ES256, exact scope, Windows Hello batches, trust-store rotation, and one-time redemption.

## Task 7: Verification and PR

- [ ] Run all focused Node tests and syntax checks locally.
- [ ] Publish the feature branch from exact `main` ancestry.
- [ ] Open a draft PR against `main`.
- [ ] Inspect exact-head CI, Dependency Review, and CodeQL.
- [ ] Fix any Windows compile/self-test or repository-suite failures on the same branch.
- [ ] Re-run exact-head checks and mark the PR ready only after all required evidence is green.
