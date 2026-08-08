# Windows trusted authority issuer design

Date: 2026-08-08

## Context

`github-delivery` can already verify a host-issued Ed25519 `gd1` authority grant, but it has no production issuer and deliberately does not claim durable nonce replay prevention. Caller-provided `mutationMode`, `explicitInstruction`, and `exactTextConfirmed` remain compatibility assertions rather than authenticated human provenance.

The first production issuer will run locally on Windows 11. It must preserve today's optional behavior while adding a stronger path for maintainer/destructive mutations.

## Goals

- Keep legacy Ed25519 grants working.
- Add Windows-native ES256 grants backed by a non-exportable TPM key.
- Require Windows Hello for maintainer/destructive authorization.
- Let one Hello approval cover one short, exact, precomputed batch.
- Produce one narrowly scoped grant per mutation in that batch.
- Bind every trusted grant to the exact GitHub effect, including visible text.
- Make trusted grants one-time through a durable local nonce ledger.
- Default-deny repositories and require explicit local allowlisting.
- Keep trusted authority optional unless strict mode is explicitly enabled.

## Non-goals

- No network listener or cloud issuer in v1.
- No wildcard repository, action, or time-window authority.
- No agent-accessible `sign(bytes)`, key export, key creation, allowlist mutation, or policy mutation API.
- No atomic rollback across multiple GitHub mutations in a batch.
- No automatic enablement of `GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1`.
- No claim that a per-user tray process is a complete sandbox against arbitrary malicious native code already executing as the same Windows identity. The v1 boundary protects the private key from export and removes signing/admin functions from the agent protocol; a future hardened deployment can move the signer to a separate service/AppContainer or a Windows-Hello-bound application key.

## Architecture

The local authority host is a per-user .NET 8 WinForms tray application on Windows 11 build 22000 or later.

```text
Agent / github-delivery
        |
        | current-user Named Pipe
        v
Windows Authority Host
  - repository allowlist (default deny)
  - exact batch canonicalizer
  - Windows Hello approval UI
  - TPM-backed ES256 key
  - SQLite approval/grant/nonce ledger
        |
        | one gd1 grant per exact operation
        v
github-delivery verifier
        |
        | redeem nonce immediately before write
        v
GitHub mutation
```

The agent-facing Named Pipe exposes only:

- `status`
- `authorizeBatch`
- `redeemGrant`

Administrative operations remain tray-UI-only and require Windows Hello.

## Authorization policy

Installing the issuer does not change existing compatibility mode.

- Read-only work never needs the issuer.
- Ordinary review writes may continue through the existing caller-asserted path.
- Maintainer/destructive operations require Windows Hello when the issuer is used.
- Strict deployments may set `GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1`; then a valid trusted grant is mandatory.

The maintainer/destructive set includes merge, close, supersede, ordinary human-thread resolution, draft-state changes, reviewer changes, linked-issue closure, branch deletion, and follow-up issue creation. A standalone `reply_human_thread` is not silently upgraded to trusted exact-text authority; if there is no Hello-approved batch, callers use the existing compatibility path.

## Batch model

One Hello approval can authorize a finite batch such as:

1. post an exact PR comment;
2. merge one exact PR head using one exact merge method;
3. post an exact linked-issue comment;
4. close that exact linked issue.

Every operation must be known before approval. The trusted UI derives its summary from canonical mutation requests, not an agent-supplied description.

The batch is not an atomic distributed transaction. A successful earlier GitHub mutation is not rolled back if a later approved mutation fails. Unused grants expire.

## Exact scope canonicalization

Node and the Windows host implement the same deterministic canonical scope. Object keys are ordinal/lexically sorted, arrays preserve order except where effect semantics are set-like (reviewer names are sorted and deduplicated), and visible text is represented by SHA-256.

Examples of bound fields include:

- `repo`, `action`, and `mutationMode` for every operation;
- `pr` and `expectedHead` for PR-scoped writes;
- `mergeMethod` for merges;
- exact visible body SHA-256 and `idempotencyKey` for social writes;
- exact title/body SHA-256 for follow-up issues;
- exact reviewer set;
- exact thread/comment IDs;
- explicit `targetRepo` and `headRefName` for branch deletion.

A grant includes `scopeSha256`. A batch includes the ordered `batchSha256`. Any semantic mutation after approval causes verification to fail.

Shared cross-language fixture:

```text
{"action":"merge_pr","expectedHead":"71ac000000000000000000000000000000000001","mergeMethod":"merge","mutationMode":"maintainer","pr":105,"repo":"Wibias/github-delivery"}
```

SHA-256:

```text
5792e06b57c2f0eece1cdc227d4ccb0b75012bb9ed65bbf183e3bd994aaeb8b8
```

CI self-tests must keep the Node and C# implementations aligned to this fixture.

## Algorithm-agile gd1 grants

The token envelope remains:

```text
gd1.<base64url-json-payload>.<base64url-signature>
```

Legacy tokens with no `alg` continue down the Ed25519 path using the existing public-key configuration.

New grants carry:

```json
{
  "version": 1,
  "alg": "ES256",
  "kid": "win-tpm-...",
  "aud": "github-delivery",
  "repo": "OWNER/REPO",
  "action": "merge_pr",
  "resource": {},
  "scopeSha256": "...",
  "batchId": "bch_...",
  "batchIndex": 0,
  "batchSha256": "...",
  "maxMutationMode": "maintainer",
  "explicitInstruction": true,
  "issuedAt": 0,
  "expiresAt": 0,
  "nonce": "gnt_...",
  "redemption": "required",
  "approvalMethod": "windows_hello"
}
```

`ES256` means ECDSA P-256 with SHA-256 and DER-encoded ECDSA signatures. Unknown algorithms fail closed.

## Trust store and rotation

The Windows host writes a public-only trust store containing `kid`, algorithm, public key PEM, lifecycle status, and verifier requirements. `github-delivery` accepts `active` and short-lived `retiring` keys and rejects `retired` keys.

Rotation is local-UI-only and Hello-gated:

1. create a new TPM-backed P-256 key;
2. move the previous active key to `retiring`;
3. issue new grants with the new `kid`;
4. keep both public keys valid for an overlap longer than the 60-second grant TTL;
5. retire and delete the old TPM private key after the overlap.

The repository never stores a private signing key.

## Windows key and approval boundary

The production key is persisted with `Microsoft Platform Crypto Provider`, P-256, signing-only usage, and no private-key export. Windows Hello is invoked against an owned WinForms HWND before a protected batch is signed.

The host starts with an empty repository allowlist. Allowlist additions/removals and key rotation require Windows Hello. The Named Pipe cannot perform those operations.

## Named Pipe protocol

Protocol identifier:

```text
github-delivery-authority/1
```

Frames are 4-byte little-endian length-prefixed UTF-8 JSON, capped at 256 KiB. The server uses `PipeOptions.CurrentUserOnly` and rejects clients from another Windows session.

Request envelope:

```json
{
  "protocol": "github-delivery-authority/1",
  "id": "...",
  "method": "authorizeBatch",
  "params": {}
}
```

The server allows only `status`, `authorizeBatch`, and `redeemGrant`.

## Replay prevention

The issuer stores approvals and grants in SQLite with WAL and full synchronous durability. Each grant nonce starts as `issued` and may transition exactly once to `consumed`.

Execution order is:

1. verify the signed grant and mutation policy;
2. perform fresh-head and target checks;
3. perform remote idempotency lookup;
4. call `redeemGrant`;
5. atomically mark the nonce consumed;
6. spawn the exact GitHub mutation command;
7. perform postcondition verification.

If the process crashes after redemption and before GitHub completes, the nonce stays consumed. The user must authorize a new grant. This deliberately favors safety over automatic retry.

## CLI integration

`scripts/github-authorize.mjs` submits an exact batch to the local host and returns the same broker requests with per-operation `authorityGrant` tokens attached.

`scripts/github-mutate.mjs` loads either the legacy public key or the public trust store. For a grant declaring `redemption: required`, the CLI wraps the broker runner so only the exact planned write command triggers redemption, after broker preflight and immediately before process spawn. Dry-runs and `already_applied` paths do not consume grants.

The mutation CLI remains the required network-write path for the skill.

## Data storage

Default local state:

```text
%LOCALAPPDATA%\GitHubDeliveryAuthority\authority.db
%LOCALAPPDATA%\GitHubDeliveryAuthority\trust-store.json
```

SQLite stores only public key metadata, allowlist policy, approval metadata, hashes, grant nonces, timestamps, and consumption state. It does not store private key material or Windows Hello secrets.

## Failure behavior

Fail closed for:

- repository not allowlisted;
- Hello denied/unavailable for a protected batch;
- malformed or oversized pipe request;
- unsupported pipe method;
- unknown/retired/mismatched key;
- bad signature;
- wrong audience/repo/action/resource/scope;
- stale/expired/overlong grant;
- mutation mode above the signed ceiling;
- required redemption without a host;
- missing, mismatched, expired, or previously consumed nonce.

No failed trusted-grant path silently downgrades to caller assertions.

## Testing

Node tests cover:

- legacy Ed25519 compatibility;
- ES256 trust-store verification and key lifecycle;
- exact scope and ordered batch hashing;
- exact social content binding;
- Named Pipe framing and grant attachment;
- redemption receipt validation;
- redemption ordering: reads do not consume, exact write consumes once before spawn.

Windows CI builds the WinForms project and runs an unattended self-test covering:

- the shared Node/C# scope fixture;
- ephemeral ES256 token sign/verify;
- SQLite default-deny/one-time consume behavior;
- maintainer vs review classification.

TPM and Windows Hello are intentionally not invoked by unattended CI.

## Success criteria

- Existing Ed25519 and no-grant compatibility behavior remains green.
- New ES256 grants select public keys by `kid` and fail closed on lifecycle/scope errors.
- Protected Windows batches require one explicit Hello approval.
- Every operation receives a 60-second exact-scope grant.
- A redemption-required grant cannot reach the product GitHub write path twice.
- The host has no agent-accessible generic signing or admin method.
- The repository allowlist is default-deny.
- Strict trusted-authority mode remains an explicit deployment choice.
