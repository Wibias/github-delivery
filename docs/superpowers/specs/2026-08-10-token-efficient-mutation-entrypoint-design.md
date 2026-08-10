# Token-Efficient Mutation Entrypoint Design

## Goal

Make routine GitHub writes a one-call agent operation while preserving the existing broker, exact-scope authority, redemption, idempotency, freshness, and verification guarantees.

The model-facing contract becomes:

```text
node scripts/github-mutate.mjs --request request.json --execute [--audit audit.jsonl]
```

The caller must not discover or orchestrate trust-store paths, authority pipe names, batch envelopes, grant attachment, redemption, or backend broker shape during routine work.

## Scope

This change covers three related problems:

1. `github-authorize.mjs` accepts a batch document, but `github-mutate.mjs` accepts only one request.
2. A process started before Windows authority installation may not inherit the installer-written trust-store and pipe environment variables, even though the standard install location and default pipe are deterministic.
3. `references/create-pr-for-issue.md` exposes too much broker plumbing and repeated policy text to the model during normal issue-to-PR work.

This change does not add a new authority model or remove any safety gate.

## Architecture

### 1. Mutation document execution layer

Add `scripts/lib/mutation-document-execution.mjs` as the model-facing orchestration layer above the existing mutation execution context.

It accepts these input shapes:

- one mutation request object;
- an array of mutation request objects;
- `{ "operations": [...] }` for authorisation-batch compatibility;
- `{ "requests": [...] }` for compatibility with output produced by `github-authorize.mjs`.

For `--execute`:

1. Normalise the document to an ordered request list.
2. Refresh `expectedHead` for exact-head-bound PR mutations before approval, using the existing `refreshExpectedHeads()` path.
3. Determine which requests require trusted authority at execution and do not already carry a grant.
4. Request one Windows authority batch for exactly those requests.
5. Attach the issued grants to the matching requests and stamp full-review authority markers with the existing helper.
6. Execute requests in order through `executeMutationWithAuthority()`.
7. Preserve exact broker receipts. A single input returns the existing single receipt shape. A multi-request input returns an ordered batch receipt.

Dry-run mode never triggers Windows Hello and continues to use caller-asserted planning semantics.

### 2. Runtime authority defaults

The execution context resolves authority configuration as follows:

- explicit environment variables remain authoritative;
- on Windows, if `GITHUB_DELIVERY_AUTHORITY_PIPE` is absent, use the existing `DEFAULT_AUTHORITY_PIPE`;
- on Windows, if `GITHUB_DELIVERY_AUTHORITY_TRUST_STORE` is absent and `%LOCALAPPDATA%/GitHubDeliveryAuthority/trust-store.json` exists, use it;
- otherwise fail closed exactly as today when trusted authority is required.

No key material is guessed. The runtime only discovers the installer-defined standard trust-store file and existing default pipe name.

### 3. Compact create-PR workflow contract

Shrink `references/create-pr-for-issue.md` into a state-machine contract. Keep the same safety and completion requirements, but remove:

- inline broker JSON examples;
- repeated explanations of authority internals;
- repeated policy rules already supplied by declared policy modules;
- API-semantic debugging instructions that deterministic code should own.

The workflow tells the agent what evidence or outcome is required, not how the authority host is implemented.

## Error handling

- Missing/unreadable trust store remains a hard stop for high-assurance execution.
- Authority-host unavailability remains a hard stop.
- Partial batch execution returns/throws at the first failed operation; later operations are not attempted.
- Existing idempotency and read-before-write behavior remains inside the broker.
- Existing redemption remains immediately before the exact planned mutation process.
- No automatic retry is added for a consumed grant or an ambiguous write outcome.

## Compatibility

- `scripts/github-authorize.mjs` remains available for explicit/manual authorisation workflows and debugging.
- Existing single-request `github-mutate.mjs` callers keep their input and output shape.
- Already-authorised requests keep their grants and do not cause a second approval prompt.
- Existing policy modules and action registry remain authoritative.

## Testing

Add tests that prove:

1. single, array, `operations`, and `requests` document shapes normalise correctly;
2. dry runs do not invoke authorisation;
3. high-assurance execution batches only missing grants and attaches them to the correct requests;
4. existing grants are preserved;
5. refreshed PR heads are the values approved and executed;
6. multi-request execution is ordered and stops on failure;
7. single-request output remains backward compatible;
8. Windows runtime defaults discover the default pipe and standard trust store only when explicit environment values are absent;
9. explicit environment values override defaults;
10. routine workflow documentation no longer instructs agents to inspect broker internals or manually choreograph authorise/attach/redeem steps.

## Non-goals

- Session-wide or wildcard authority.
- Reusing a grant for a different mutation.
- Removing Windows Hello from high-assurance writes.
- Hiding broker failures that require real debugging.
- Building a new workflow DSL for dependent mutations such as “create PR, then use its generated number in a later comment”.
