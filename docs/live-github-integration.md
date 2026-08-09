# Live GitHub integration fixtures

The deterministic unit/eval suite proves policy behavior offline. The **Live Integration** workflow proves that the same lifecycle still matches GitHub's real issue, branch, pull-request, check, snapshot, stale-head, and cleanup semantics.

Live acceptance runs against an explicitly opted-in **dedicated fixture repository**, never against `Wibias/github-delivery` itself.

## Target identity contract

Before credential probing, lifecycle mutation, or cleanup mutation, the live path verifies:

- configured `LIVE_FIXTURE_REPOSITORY`;
- configured immutable `LIVE_FIXTURE_REPOSITORY_ID`;
- the target's actual numeric GitHub repository ID;
- a different source and fixture repository name;
- a different source and fixture numeric repository ID; and
- `.github/github-delivery-live-fixture.json` on the target base branch, binding the exact source + fixture names and IDs.

The sentinel uses:

```json
{
  "schemaVersion": 1,
  "kind": "github-delivery/live-fixture-target",
  "fixtureRepository": "OWNER/FIXTURE_REPO",
  "fixtureRepositoryId": 123456789,
  "sourceRepository": "Wibias/github-delivery",
  "sourceRepositoryId": 1317569489
}
```

A writable unrelated repository therefore fails before the first fixture mutation even when its name is accidentally configured.

See [`live-integration.md`](live-integration.md) for provisioning instructions.

## Scenario

Each run uses a unique `[github-delivery-fixture:<run-id>]` marker and a branch below `github-delivery-fixture/`.

The lifecycle:

1. verifies immutable source/fixture identity;
2. verifies the dedicated credential's read capabilities;
3. creates a temporary fixture issue;
4. creates and pushes a temporary fixture branch;
5. opens a draft PR;
6. proves the authoritative ship gate does not report a draft as ready;
7. marks the PR ready and observes its real checks;
8. captures a paginated evidence snapshot;
9. pushes another commit after the snapshot;
10. proves a stale expected-head mutation is rejected before a GitHub write;
11. re-evaluates the final gate;
12. closes the fixture PR;
13. closes the fixture issue and deletes the branch; and
14. uploads versioned credential, lifecycle, and cleanup evidence.

All created resources are restricted to the exact run marker and derived branch. The lifecycle performs immediate best-effort cleanup on ordinary failures. A separate workflow step runs with `if: always()` so process failure or interruption cannot silently skip cleanup.

Cleanup re-verifies the same immutable fixture identity before it mutates the target.

## Branch source and fixture repository

The Actions job checks out `Wibias/github-delivery`, adds the dedicated fixture repository as a verified Git remote, fetches its base branch, creates a namespaced fixture branch from the checked-out source tree, adds the run marker, and pushes only that derived branch to the fixture remote.

The target repository must be provisioned so pull requests emit the acceptance checks below. The fixture identity sentinel alone does not create CI/rules configuration.

## Required check evidence

The current live acceptance contract requires:

- `CI / Node 22 / ubuntu-latest`
- `CI / Node 22 / windows-latest`
- `CI / Node 22 / macos-latest`
- `CI / Node 24 / ubuntu-latest`
- `CI / Node 24 / windows-latest`
- `CI / Node 24 / macos-latest`
- at least one check from `Dependency Review`
- at least one check from `CodeQL`

Additional checks are allowed and retained in the receipt. An empty or incomplete required-check set can never pass.

The observer reports stable waiting/failure codes:

| Code | Meaning |
|---|---|
| `fixture_workflows_approval_required` | GitHub is waiting for manual workflow approval |
| `fixture_checks_not_observed` | No PR checks appeared |
| `fixture_checks_pending` | Required checks appeared but are still running |
| `fixture_required_checks_missing` | One or more required workflows or matrix jobs never appeared |
| `fixture_checks_failed` | An observed check failed, was cancelled, skipped, stale, or timed out |

Approval, missing, and pending states remain pollable until the deadline. A failed check stops immediately. Any unresolved state at timeout fails the lifecycle.

## Rate-limit behavior

GitHub reads in the lifecycle use the shared bounded retry layer. It retries only commands proven read-only, honors `Retry-After` or `X-RateLimit-Reset` when available, otherwise uses bounded exponential backoff, and defaults to at most three attempts.

GraphQL mutations, GitHub writes, and ambiguous commands are never automatically repeated after an unknown result. This lets evidence reads tolerate transient rate limiting without turning a network ambiguity into duplicate fixture writes.

## Stale-head proof

The lifecycle deliberately captures a snapshot and then changes the PR head. It submits a mutation request bound to the old head and requires the mutation boundary to reject it before spawning the external GitHub write.

A receipt in which that stale mutation was accepted is invalid even if every hosted check is green.

## Workflow disposition

The hosted Live Integration workflow uses:

```text
--disposition close
```

The live fixture CLI currently refuses merge disposition because a real merge requires trusted authority. Acceptance therefore validates lifecycle close/cleanup behavior rather than bypassing the normal merge authorization path.

## Approval-required runs

GitHub may place temporary pull-request workflows into an approval-required state. When that happens the lifecycle remains pollable and reports:

```text
fixture_workflows_approval_required
```

Approve the temporary fixture PR workflows before the observation timeout. If approval never arrives, the lifecycle fails closed and independent cleanup still runs.

## Cancellation and cleanup

Cleanup discovers only resources whose title exactly matches the current run marker and only the branch derived from the current run ID. It is idempotent when a resource is already closed or removed.

A normal script failure writes partial lifecycle evidence before exiting. If execution is interrupted before the normal receipt can be written, independent cleanup records the failure rather than silently presenting the run as successful.

Missing required evidence files are an artifact-upload error, not a warning.

## Evidence artifact

The workflow uploads:

- `live-fixture-credential.json`
- `live-fixture-receipt.json`
- `live-fixture-cleanup.json`

A successful receipt contains every required lifecycle event, records a non-ready draft decision, records `stale_head_rejected` with outcome `rejected`, and carries complete normalized check evidence.

Example shape:

```json
{
  "checks": {
    "conclusion": "success",
    "count": 8,
    "expectedWorkflows": ["CI", "CodeQL", "Dependency Review"],
    "observedWorkflows": ["CI", "CodeQL", "Dependency Review"],
    "checks": []
  }
}
```

The real `checks` array contains one normalized entry for every observed check. A zero count, incomplete expected set, unsuccessful conclusion, invalid fixture identity, missing cleanup, or accepted stale-head mutation invalidates the acceptance evidence.
