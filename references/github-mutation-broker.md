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

The legacy request fields `mutationMode`, `explicitInstruction`, and `exactTextConfirmed` are **caller assertions**. They remain useful policy inputs, but they are not independently authenticated proof that a human supplied the instruction. Receipts therefore report them as:

```json
{
  "authority": {
    "provenance": "caller_asserted",
    "verified": false,
    "reason": "grant_absent"
  }
}
```

A host that has a trust boundary the agent cannot forge may instead issue an Ed25519-signed grant and place it in `authorityGrant`. The token format is:

```text
gd1.<base64url-json-payload>.<base64url-ed25519-signature>
```

The signature covers the ASCII bytes of `gd1.<base64url-json-payload>`. The payload binds the audience, repository, action, concrete resource identifiers such as PR/comment/head SHA, maximum mutation mode, explicit-instruction authority, issue/expiry times, and a host-generated nonce. Exact-text human replies additionally bind `exactTextSha256`.

Configure the verifier with the **public** Ed25519 key only:

```text
GITHUB_DELIVERY_AUTHORITY_PUBLIC_KEY=<PEM public key>
```

To require a verified host grant for every broker request in a deployment, set:

```text
GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1
```

In trusted-only mode, an absent or invalid grant fails before a GitHub process is spawned. A supplied grant that cannot be verified also fails in compatibility mode; it never silently downgrades to caller assertions. A successful receipt reports `provenance: "trusted_grant"` with sanitized signed claims and never re-emits the token or signature.

The repository intentionally contains **no private signing key and no grant-minting API**. A key readable by the agent would not establish a trust boundary. Durable nonce consumption is also outside this repository: the grant verifier limits replay exposure with short expiry plus repository/action/resource/head binding, but it does not claim one-time replay prevention across processes or machines. A trusted host/service may add a nonce-consumption store outside the agent boundary.

## Safety behavior

The broker:

1. classifies authority before mutation policy evaluation or process spawning;
2. evaluates the mutation profile using either caller assertions or verified grant claims;
3. validates request schema and action-specific fields;
4. requires the expected PR head for PR mutations;
5. re-reads the current head immediately before execution;
6. pins merge operations with `--match-head-commit`;
7. defaults to dry-run unless `--execute` is supplied;
8. emits a versioned mutation receipt with explicit authority provenance;
9. appends receipts to `--audit FILE` when requested;
10. performs an action-specific verification read when available.

A denied, invalid-grant, trusted-authority-required, or stale-head request exits `2` and performs no mutation.

## Natural-language example

User:

```text
merge PR #32
```

Agent flow:

1. Load `github-delivery` from its frontmatter trigger.
2. Route to `references/merge-pr.md`.
3. Run runtime capability discovery and `ship-gate.mjs`.
4. Prepare the PR comment request and execute it through the broker.
5. Prepare the head-pinned merge request and execute it through the broker.
6. Post and close linked issues through broker requests.
7. Return the verified receipts and final repository state.

The scripts are implementation details. Natural language remains the product interface.
