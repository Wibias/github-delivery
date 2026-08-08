# Trusted authority provenance readiness

Date: 2026-08-08

## Context

`github-delivery` currently enforces mutation policy using request fields such as `mutationMode`, `explicitInstruction`, and `exactTextConfirmed`. Those fields are useful policy assertions, but the same caller that requests a mutation can set them, so they are not independently authenticated proof of user authorization.

The repository cannot create a complete trusted boundary by itself because only the host that receives the user's instruction can mint evidence the agent cannot forge. A fake `source: "user"` field or a signing secret readable by the agent would not improve security.

## Goal

Make the broker capable of consuming and verifying a real host-issued authority grant when a host can provide one, while preserving current compatibility and making the existing caller-asserted trust level explicit rather than overstating it.

## Non-goals

- Do not claim caller-provided booleans are cryptographically trusted consent.
- Do not store a private signing key in this repository, environment, or agent-readable filesystem.
- Do not require a trusted grant by default until a supported host integration exists.
- Do not claim durable nonce replay prevention without a trusted external store.

## Considered approaches

### 1. Add another caller-controlled provenance field

Rejected. `source: "user"`, `verified: true`, or similar metadata can be forged by the same caller and does not establish a stronger boundary.

### 2. Require signed grants immediately

Cryptographically clean, but unusable today because no current host integration mints those grants. This would break legitimate maintainer workflows without adding an end-to-end authorization path.

### 3. Add a real verification path plus explicit fallback classification

Selected. The broker gains a verifier for host-signed grants and an opt-in enforcement switch. Without a verified grant, existing workflows continue under a receipt explicitly classified as `caller_asserted`. With enforcement enabled, sensitive writes fail closed unless a valid grant is present.

## Grant format

Use a compact versioned token:

```text
gd1.<base64url-json-payload>.<base64url-ed25519-signature>
```

The signature covers the exact ASCII bytes of:

```text
gd1.<base64url-json-payload>
```

Verification uses an Ed25519 public key. The public key is not secret and may be supplied through an environment variable or file readable by the broker. The private key remains exclusively with the trusted host.

Required payload claims:

```json
{
  "version": 1,
  "aud": "github-delivery",
  "repo": "OWNER/REPO",
  "action": "merge_pr",
  "resource": {
    "pr": 123,
    "expectedHead": "..."
  },
  "maxMutationMode": "maintainer",
  "explicitInstruction": true,
  "issuedAt": 1786150000,
  "expiresAt": 1786150600,
  "nonce": "host-generated"
}
```

Optional claims:

- `exactTextSha256` for exact-text human replies.
- resource identifiers appropriate to the action, such as `issue`, `commentId`, `threadId`, or `headRefName`.

## Verification rules

A grant is trusted only when all of the following hold:

1. Token version and payload schema are valid.
2. Ed25519 signature verifies against the configured public key.
3. `aud` is exactly `github-delivery`.
4. Current time is within `issuedAt` / `expiresAt`, allowing only a small fixed clock skew.
5. Grant lifetime is bounded to a short maximum TTL.
6. Repository and action exactly match the mutation request.
7. Every resource identifier present on the mutation request that defines authority scope matches the grant.
8. `expectedHead` matches for PR-scoped writes.
9. Requested mutation mode does not exceed `maxMutationMode`.
10. An exact-text action requires the request body hash to match `exactTextSha256` from the grant.

A valid signature is not enough if any scope claim differs.

## Broker behavior

Add `scripts/lib/authority-grant.mjs` as the isolated verifier.

`planMutationRequest()` will produce an `authority` receipt with one of two provenance classes:

- `trusted_grant`: verified host grant; effective authorization inputs are bounded by grant claims.
- `caller_asserted`: no trusted grant; current request assertions remain available for compatibility, but the receipt explicitly records that they are not independently authenticated.

When trusted-authority enforcement is enabled, `caller_asserted` is denied before any GitHub command is planned or executed.

The enforcement switch is opt-in until a host integration exists. It must be impossible for an unverified request field such as `trusted: true` to activate trusted status.

## Public-key configuration

Support one explicit verification configuration path, preferably:

```text
GITHUB_DELIVERY_AUTHORITY_PUBLIC_KEY
```

containing an Ed25519 PEM public key. Because it is public material, exposing it to the agent is acceptable. No private key support is added anywhere in the repository.

A grant included without a configured public key fails verification rather than silently degrading to caller assertions.

## Replay model

This PR will not claim durable nonce replay protection because a local file controlled by the same agent is not a trusted replay store. The short expiry, exact resource binding, expected-head binding, and existing idempotency/verification logic limit practical replay scope. Durable one-time-grant consumption remains a host/service responsibility.

## Documentation

Update the mutation-broker documentation to state clearly:

- caller assertions are policy inputs, not authenticated user provenance;
- trusted grants require a host-owned private key;
- the repository contains verification only;
- enabling trusted-only enforcement without a grant-minting host will intentionally block protected mutations.

## Tests

Add focused tests proving:

- a caller cannot self-declare trusted provenance;
- malformed, expired, wrong-audience, wrong-repo, wrong-action, wrong-resource, wrong-head, overpowered-mode, and bad-signature grants fail closed;
- exact-text grants bind the approved body hash;
- a valid Ed25519 grant produces `trusted_grant` provenance;
- absence of a grant remains `caller_asserted` in compatibility mode;
- trusted-only mode rejects the compatibility path;
- broker receipts expose provenance without leaking private material.

Use generated ephemeral Ed25519 keypairs inside unit tests only; no fixture private key is committed.

## Success criteria

- Existing workflows keep working when trusted-only enforcement is not enabled.
- The repository no longer describes caller assertions as independently authenticated consent.
- A real host can mint a grant using its private key and the broker can verify it using only a public key.
- No caller-controlled field can bypass signature verification.
- Trusted-only mode fails closed before any GitHub mutation when provenance is absent or invalid.
