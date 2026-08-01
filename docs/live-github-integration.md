# Live GitHub integration fixtures

The unit suite proves policy behavior with deterministic fixtures. The live lifecycle workflow proves that the same code still matches GitHub's real API, check-run, branch, issue, pull-request, and mutation semantics.

## Scenario

Each run uses a unique `[shipping-github-fixture:<run-id>]` marker and a branch below `shipping-github-fixture/`. It performs these steps:

1. Create a temporary issue.
2. Create and push a temporary fixture branch.
3. Open a draft PR.
4. Prove the authoritative ship gate does not report a draft as ready.
5. Mark the PR ready and observe its real checks.
6. Capture a paginated evidence snapshot.
7. Push another commit after the snapshot.
8. Prove the mutation broker rejects the stale expected head before spawning a GitHub write.
9. Re-evaluate the final gate.
10. Close or merge the fixture PR.
11. Close the fixture issue and delete the branch.
12. Upload a versioned receipt.

Cleanup runs on failure and is restricted to the run's namespaced fixture branch and resources.

## Running it

Use the **Live Integration** workflow manually. `close` is the safe default. `merge` additionally tests the brokered merge path and should only be selected when repository rules allow the workflow token to merge fixture PRs.

Weekly execution is opt-in. Set the repository variable `LIVE_FIXTURE_ENABLED=true` to enable the scheduled run.

The workflow intentionally uses the current repository so the fixture PR receives the same CI, CodeQL, and dependency-review behavior as ordinary changes. A future dedicated fixture repository can run the same CLI without changing the scenario contract.

### Approval-required runs

GitHub can place pull-request workflows created by `GITHUB_TOKEN` into an approval-required state. The parent lifecycle job remains alive and logs:

```text
fixture_workflows_approval_required
```

Open the temporary fixture PR and choose **Approve workflows to run** before the observation timeout. If approval never arrives, the lifecycle fails closed and cleans up its namespaced resources.

## Required check evidence

A successful fixture must observe all current hosted checks:

- `CI / Node 20 / ubuntu-latest`
- `CI / Node 20 / windows-latest`
- `CI / Node 20 / macos-latest`
- `CI / Node 22 / ubuntu-latest`
- `CI / Node 22 / windows-latest`
- `CI / Node 22 / macos-latest`
- at least one check from `Dependency Review`
- at least one check from `CodeQL`

Additional checks are allowed and retained in the receipt. The fixture never treats an empty check set as success.

The observer reports stable failure or waiting codes:

| Code | Meaning |
|---|---|
| `fixture_workflows_approval_required` | GitHub is waiting for manual workflow approval |
| `fixture_checks_not_observed` | No PR checks appeared |
| `fixture_checks_pending` | Required checks appeared but are still running |
| `fixture_required_checks_missing` | One or more required workflows or matrix jobs never appeared |
| `fixture_checks_failed` | An observed check failed, was cancelled, skipped, or timed out |

Approval, missing, and pending states remain pollable until the deadline. A failed check stops immediately. Any unresolved state at timeout fails the lifecycle and triggers best-effort cleanup.

## Evidence contract

A successful receipt contains every required lifecycle event exactly once, records a non-ready draft decision, records `stale_head_rejected` with outcome `rejected`, and includes the complete normalized check evidence:

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

The real `checks` array contains one normalized entry for every observed check. A zero count, incomplete expected set, unsuccessful conclusion, missing cleanup, or accepted stale-head mutation invalidates the receipt.
