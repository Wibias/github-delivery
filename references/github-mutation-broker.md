# GitHub mutation broker

The user-facing interface remains natural language. Requests such as `merge PR #32`, `resolve the fixed bot thread`, or `post the merge-ready comment` route through `SKILL.md` and the matching workflow. The agent prepares and runs the broker internally; users are not expected to invoke scripts manually.

## Required path

All network-visible GitHub writes owned by this skill must use:

```bash
node scripts/github-mutate.mjs --request request.json --execute --audit mutations.jsonl
```

Run without `--execute` first when the operation is destructive, socially visible, or otherwise benefits from inspecting the exact plan.

Direct `gh` writes are forbidden outside the broker implementation and narrowly scoped read-only helpers. Local Git operations such as committing and pushing remain governed by Git safety rules and the `push_code` mutation authorization.

## Request envelope

```json
{
  "schemaVersion": 1,
  "action": "merge_pr",
  "mutationMode": "maintainer",
  "explicitInstruction": true,
  "repo": "OWNER/REPO",
  "pr": 32,
  "expectedHead": "full-reviewed-head-sha",
  "mergeMethod": "merge"
}
```

Social writes also require a stable `idempotencyKey`. Human replies require:

- `exactTextConfirmed: true`
- `exactTextSha256`: SHA-256 of the exact approved body

## Authority provenance

The legacy request fields `mutationMode`, `explicitInstruction`, and `exactTextConfirmed` are **caller assertions**. They remain useful policy inputs, but they are not independently authenticated proof that a human supplied the instruction. Receipts therefore classify this path as `caller_asserted`.

A trusted host may instead place a signed `gd1` grant in `authorityGrant`:

```text
gd1.<base64url-json-payload>.<base64url-signature>
```

The signature always covers the ASCII bytes of `gd1.<base64url-json-payload>`.

### Legacy Ed25519

Existing grants with no `alg` claim remain supported through:

```text
GITHUB_DELIVERY_AUTHORITY_PUBLIC_KEY=<PEM Ed25519 public key>
```

This compatibility path preserves the original resource/head/time/mutation-mode and human-reply exact-text checks.

### Algorithm-agile trust store

New issuers may use `alg` + `kid`. The Windows issuer uses `ES256`: ECDSA P-256 with SHA-256 and DER-encoded ECDSA signatures.

Configure the verifier with a public-only trust store:

```text
GITHUB_DELIVERY_AUTHORITY_TRUST_STORE=C:\path\to\trust-store.json
```

Example:

```json
{
  "schemaVersion": 1,
  "keys": [
    {
      "kid": "win-tpm-2026-01",
      "alg": "ES256",
      "publicKey": "-----BEGIN PUBLIC KEY-----...",
      "status": "active",
      "requireScopeHash": true,
      "requireRedemption": true
    }
  ]
}
```

`active` and short-lived `retiring` keys may verify. `retired`, unknown, expired, wrong-algorithm, or wrong-repository keys fail closed. The trust store contains public material only.

## Exact trusted scope

New trusted grants carry `scopeSha256`. `scripts/lib/authority-scope.mjs` deterministically binds the exact GitHub effect, not merely the broad action name.

Depending on the action, scope includes:

- repository, action, and mutation mode;
- exact PR and `expectedHead`;
- merge method;
- exact comment/review/thread/issue/branch target;
- stable idempotency key;
- exact reviewer set;
- SHA-256 hashes of human-visible title/body text.

Changing any bound input after approval invalidates the grant.

Batch approvals are also ordered and finite. One approval may issue multiple grants, but every operation receives its own nonce and exact scope. There is no wildcard or reusable timed session authority.

## Local Windows authority host

The optional Windows 11 host lives under `authority-host/windows/`.

It provides:

- a per-user tray application;
- a default-deny repository allowlist;
- Windows Hello approval for maintainer/destructive batches;
- a non-exportable P-256 signing key through Microsoft Platform Crypto Provider;
- a public `kid` trust store with key rotation;
- a SQLite approval/grant/nonce ledger;
- a current-user Named Pipe exposing only `status`, `authorizeBatch`, and `redeemGrant`.

The agent cannot ask the pipe to create/export keys, modify the allowlist, change approval policy, or sign arbitrary bytes.

A precomputed batch can be authorized with:

```bash
node scripts/github-authorize.mjs --request batch.json --out authorized.json
```

The output contains the same broker requests with one `authorityGrant` attached per operation.

The host is optional. Installing it does not enable strict mode automatically.

## One-time redemption

Windows issuer grants declare:

```json
{
  "redemption": "required"
}
```

For those grants, `github-mutate.mjs` wraps the broker process runner. The sequence is:

1. verify the signed grant and mutation policy;
2. perform fresh-head and target checks;
3. perform remote idempotency lookup where required;
4. redeem the exact nonce with the local authority host;
5. atomically mark the nonce consumed;
6. spawn the exact planned GitHub mutation command;
7. perform postcondition verification.

Dry-runs, preflight reads, and `already_applied` results do not consume the grant. If execution fails after redemption, the nonce remains spent and a new authorization is required.

## Strict deployments

To require a verified host grant for broker requests, opt in explicitly:

```text
GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1
```

In trusted-only mode, an absent or invalid grant fails before a GitHub mutation is spawned. A supplied invalid grant also fails in compatibility mode; it never silently downgrades to caller assertions. Successful receipts report `provenance: "trusted_grant"` with sanitized signed claims and never re-emit the token or signature.

The repository intentionally contains no production private signing key. Private keys belong to the trusted issuer boundary.

## Safety behavior

The broker:

1. classifies authority before mutation policy evaluation or process spawning;
2. evaluates the mutation profile using either caller assertions or verified grant claims;
3. validates request schema and action-specific fields;
4. requires the expected PR head for PR mutations;
5. re-reads the current head immediately before execution;
6. pins merge operations with `--match-head-commit`;
7. performs remote idempotency checks before social creates;
8. redeems one-time trusted grants immediately before the exact write;
9. defaults to dry-run unless `--execute` is supplied;
10. emits a versioned mutation receipt with explicit authority provenance and sanitized redemption metadata;
11. appends receipts to `--audit FILE` when requested;
12. performs an action-specific verification read when available.

A denied, invalid-grant, failed-redemption, trusted-authority-required, or stale-head request exits `2` and performs no mutation.

## Natural-language example

User:

```text
merge PR #32
```

Agent flow:

1. Load `github-delivery` from its frontmatter trigger.
2. Route to `references/merge-pr.md`.
3. Run runtime capability discovery and `ship-gate.mjs`.
4. Prepare the exact ship batch.
5. If trusted Windows authority is being used, authorize the complete batch once and attach individual grants.
6. Execute each request through `github-mutate.mjs`; redemption-required grants are consumed immediately before their exact write.
7. Return verified receipts and final repository state.

The scripts are implementation details. Natural language remains the product interface.
