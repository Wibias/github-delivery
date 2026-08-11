# CI Policy

Canonical rules for required checks, base-health classification, reruns, settling, and watch behavior.

### GD-CI-001 — Required checks belong to the current head

Read required checks for the exact current PR head. A successful older SHA, partial matrix, duplicate producer, or queued check cannot satisfy the current gate.

### GD-CI-002 — Classify red checks with base health

Use the `baseHealth` component to distinguish PR-introduced failures (`fix_in_pr`), failures reproduced on the base (`separate_follow_up`), and unknown origin (`investigate`). A shared base failure may still block merging but does not automatically expand implementation scope; unknown origin is a hard evidence stop.

### GD-CI-003 — Prefer fixes over blind reruns

Prefer fix/harden over reruns. Application/API test timeouts and deterministic failures are not infrastructure merely because they are inconvenient. Rerun only when evidence supports true infrastructure failure.

### GD-CI-004 — Bound infrastructure reruns

The same failure twice on one SHA stops blind reruns. For true infrastructure, rerun only the failed run/job, verify it actually restarted, and cap automatic true-infra reruns at three per SHA.

### GD-CI-005 — Use adaptive settling before final readiness

After the authoritative gate first becomes ready, settle for 60 seconds by default and 180 seconds after a push, rebase, restack, force-with-lease, approval/thread change, or newly discovered workflow. Poll the authoritative gate every 20 seconds; never hide one blocking sleep longer than 30 seconds. Reset on material change and finish with one final gate.

### GD-CI-006 — Pending, missing, failing, or unknown blocks readiness

Do not claim ready or merge while any required check is failing, pending, missing, stale, or unknown, or while the branch is conflicted/behind when current-tip compilation is required.

### GD-CI-007 — Update the correct topology

For a standalone PR, update from its base. For a stack, update the bottom PR from trunk and each child from its immediate parent, bottom to top. Revalidate each changed head afterward.

### GD-CI-008 — Watch runs the authoritative gate every wake

Watch MUST run scripts/ship-gate.mjs every wake. Exit 0 permits waiting, exit 1 means act on known blockers, and exit 2 forbids a readiness claim until incomplete evidence is restored.

### GD-CI-009 — CI wait timing is adaptive and evidence-backed

When pending required CI is the only blocker, use `scripts/ci-wait.mjs` instead of inventing a fixed runner-specific wait loop. Unknown check timing starts with an estimate of 5 minutes and the authoritative gate is polled every 30 seconds. Five minutes is an estimate, not a timeout: do not stop waiting merely because the estimate is exceeded, and do not impose a fixed poll-count or total-wait cap by default.

When this path applies, do not run parallel ad-hoc `Start-Sleep`, repeated `gh pr checks`, `gh run view`, or equivalent manual polling loops. Inspect lower-level run, job, or log evidence only after the wait driver reports a failure or ambiguous state, or another material state change requires diagnosis.

The wait driver may learn successful check durations per repository and check identity from observed completed runs. Learned timing requires at least three samples; until then, keep the 5-minute estimate. Timing history is advisory only and never overrides gate state.

Name a runner or platform only when current GitHub evidence names it in the current check context or metadata. Do not infer that Windows, macOS, Linux, or another runner is slow from historical prose or a previous repository. On every wake, rerun the authoritative gate; stop waiting immediately if the head moves, evidence becomes unknown, or any blocker other than pending required CI appears.
