# Review-scope architecture

The review planner is one evidence engine with three interfaces:

- `review-scope.mjs` exposes the complete versioned plan.
- `security-scope.mjs` preserves the established security-review contract.
- `bug-scope.mjs` preserves the established bug-review contract.

This prevents bug and security routing from deriving incompatible conclusions from the same diff.

## Inputs

The live collector reads every changed-file page and retains filename, previous filename, status, patch, additions, and deletions. Offline callers can provide the same shape through `--input`.

## Scoring

Path evidence is weak. Changed lines, removed lines, dependency metadata, and structural workflow changes are stronger. Scores map to low, medium, and high confidence. Only medium and high evidence creates mandatory domain or lens coverage.

## Fail-closed behavior

Missing patches are explicit uncertainty and cannot justify downgrading a path signal. Diffs of 100 or more files require partitioned review and pagination verification. Removed controls and high-confidence workflow/security changes force a full security pass.

## Compatibility

Existing workflows continue invoking `security-scope.mjs` and `bug-scope.mjs`. Their output now contains the complete `reviewPlan`, evidence scores, renamed files, permission changes, and uncertainty while retaining familiar top-level fields.
