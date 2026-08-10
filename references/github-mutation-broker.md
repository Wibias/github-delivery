# GitHub mutation broker

Natural language is the user-facing API. The model prepares exact mutation requests; the mutation runtime owns authority plumbing and broker execution.

## Public mutation path

All network-visible GitHub writes owned by this skill use:

```text
node scripts/github-mutate.mjs --request request.json --execute [--audit mutations.jsonl]
```

Without `--execute`, the same command is a dry-run and never prompts for Windows Hello or consumes a grant.

`request.json` may contain:

- one exact mutation request;
- an ordered JSON array of requests;
- `{ "operations": [...] }` for batch execution;
- `{ "requests": [...] }` produced by the manual authorizer.

A single input keeps the historical single-receipt output shape. Multi-request input executes in order and returns ordered results. Execution stops at the first failed operation; later operations are not attempted.

Direct `gh` writes are forbidden outside broker implementation and narrowly scoped read-only helpers. Remote code publication uses broker action `push_code`; local Git operations remain under Git safety policy.

## Routine authority behavior

Routine callers do **not** manually discover trust-store paths, named-pipe names, batch envelopes, grant attachment, or redemption calls.

For execution, `github-mutate.mjs`:

1. identifies requests that require trusted authority and do not already carry a grant;
2. refreshes exact PR heads for those approval-bound requests;
3. asks the Windows authority host for one exact ordered batch approval;
4. attaches the resulting per-operation grants and required review markers;
5. verifies each grant through the normal mutation execution context;
6. performs broker preflight/idempotency reads;
7. redeems redemption-required grants immediately before the exact planned write;
8. executes and verifies each mutation through the existing broker.

Already-authorized requests keep their existing grants and are not silently re-authorized.

On Windows, explicit authority environment variables win. If a process predates authority-host installation, the runtime may recover the installer-defined defaults: the standard `%LOCALAPPDATA%\GitHubDeliveryAuthority\trust-store.json` when present and the canonical default authority pipe. It does not invent key material or weaken verification when those defaults are unavailable.

## Request contract

The canonical action set and cross-cutting semantics live in `scripts/lib/mutation-action-registry.mjs`. The router and lifecycle/legacy brokers validate action-specific fields.

Common fields include:

- `schemaVersion: 1`;
- exact `action`;
- bounded `mutationMode`;
- `explicitInstruction` where required;
- canonical `repo`;
- exact PR/issue/thread/comment/branch targets;
- `expectedHead` or remote-generation binding for stale-sensitive writes;
- stable `idempotencyKey` for remote create/social effects;
- exact visible text fields where the action publishes text.

Human replies still require exact-text confirmation and SHA-256 binding. Do not infer action fields by reading one backend broker; use the action registry and selected workflow contract.

## Authority provenance and exact scope

Caller fields such as `mutationMode` and `explicitInstruction` are policy assertions, not authenticated provenance. High-assurance execution requires a verified `gd1` host-issued grant when mandated by the action/policy.

Trusted grants bind a deterministic `scopeSha256` to the exact effect. Depending on action, this includes repository, action, mode, PR head, merge method, target IDs, reviewer set, idempotency key, and hashes of human-visible text. Changing a bound value after approval invalidates the grant.

Batch approval is ordered and finite. Every operation receives a distinct nonce and exact scope. There is no wildcard or timed session authority.

Legacy Ed25519 public-key verification remains supported through `GITHUB_DELIVERY_AUTHORITY_PUBLIC_KEY`. Algorithm-agile issuers use the public trust store configured by `GITHUB_DELIVERY_AUTHORITY_TRUST_STORE`; the Windows host uses ES256 and a public-only trust store.

## Windows authority host

The optional Windows 11 host under `authority-host/windows/` provides a per-user approval boundary, repository allowlist, Windows Hello approval, non-exportable signing key, public trust store, approval/grant/nonce ledger, and the limited authority pipe methods required for batch authorization and one-time redemption.

The agent cannot use that pipe to export signing keys, change the allowlist/policy, or sign arbitrary bytes.

### Manual/debug authorization

`scripts/github-authorize.mjs` remains available when a human or debugger explicitly wants a pre-authorized document:

```text
node scripts/github-authorize.mjs --request batch.json --out authorized.json
```

Routine workflows should not use this extra step. The resulting `{ "requests": [...] }` document can be passed directly to `github-mutate.mjs` when manual authorization is intentionally used.

## One-time redemption

For grants declaring `redemption: required`, the broker path redeems only after fresh target/head/idempotency preflight and immediately before spawning the exact mutation. Dry-runs, read-only preflight, and verified `already_applied` outcomes do not consume the grant.

A consumed nonce is never automatically reopened. If a mutation fails after redemption, a new authorization is required unless the action has an explicit safe reconciliation path, such as merge outcome reconciliation.

## Strict deployments

`GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1` requires verified trusted authority even where compatibility behavior might otherwise permit caller assertions during planning. A supplied invalid grant never silently downgrades.

Private signing keys never belong in this repository or the model process.

## Safety behavior

The broker/runtime must continue to:

1. validate action and mutation policy before write execution;
2. verify exact trusted authority where required;
3. bind stale-sensitive PR writes to the expected head;
4. perform fresh target/head and remote idempotency reads;
5. redeem one-time grants immediately before the exact write;
6. pin merge operations to the reviewed head;
7. execute through bounded subprocess/retry policy;
8. reconcile only actions with an explicit safe ambiguous-outcome contract;
9. perform action-specific postcondition verification;
10. emit sanitized receipts and optional audit records without re-emitting grant tokens.

Denied, invalid-grant, failed-redemption, stale-head, unreadable-idempotency, or trusted-authority-required states fail closed before an unauthorized mutation.

## Natural-language example

For `merge PR #32`, the agent routes to the merge workflow, gathers current gate evidence, prepares the exact merge mutation document, and invokes `github-mutate.mjs --execute`. If trusted Windows authority is required, the same invocation obtains the exact approval and redeems it at the write boundary. The model does not inspect the pipe, trust store, grant envelope, or backend broker unless the public entrypoint itself fails and debugging is necessary.
