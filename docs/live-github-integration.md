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

## Evidence contract

A successful receipt contains every required lifecycle event exactly once, records a non-ready draft decision, and records `stale_head_rejected` with outcome `rejected`. Missing cleanup or an accepted stale-head mutation fails the run.
