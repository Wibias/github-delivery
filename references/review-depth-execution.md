# Operational review depth

The scope engine already derives bug/security review depth from diff evidence. Depth must change what the review **does**, not merely appear as a label in JSON.

`scripts/lib/review-depth-execution.mjs` maps the existing axis-specific depth values to deterministic required execution stages. `scripts/review-brief.mjs` includes those stages in both text and JSON output so the primary review entrypoint exposes the required work.

## Bug axis

| Depth | Execution obligation |
| --- | --- |
| `skip` | No bug stages. Use only when the scope engine legitimately skips the axis. |
| `baseline` | Baseline silent-failure/resource-leak/edge-case screen, required probes, coverage evidence. |
| `targeted` | Baseline + evidence-required detailed lenses, adjacent context, candidate validation. |
| `deep` | Targeted + Finder → Challenger → Arbiter, cross-boundary analysis, executable high-risk verification when feasible, coverage gap-fill. |

Deep does **not** mean automatically launching every external reviewer. External/deep multi-agent kits remain explicit-only where current policy requires that.

## Security axis

| Depth | Execution obligation |
| --- | --- |
| `skip` | No security stages. |
| `baseline` | Baseline surfaces, required probes, coverage matrix. |
| `targeted` | Baseline + evidence-required surfaces, source-to-sink validation, static leads, independent candidate validation. |
| `full` | Targeted + independent validation, attack-path/chain analysis, variant analysis, benign high-impact reproduction when safe/feasible, coverage gap-fill. |

`full` is still a defensive review depth. It does **not** grant permission to run the optional red-team/adversarial second pass. That remains explicit-user-request only.

## Gap-fill, not reviewer multiplication

After the first pass, use the scope/coverage evidence to target missing `(file/surface/lens/probe)` cells. Do not rescan already-covered low-risk areas merely to add more agents. The goal is independent evidence where uncertainty remains, not reviewer count.

## Fail-closed rules

A deeper depth cannot be satisfied by:

- a clean external bot result;
- green CI alone;
- unreviewed required files/surfaces being called clean;
- promoting medium-confidence security hypotheses to confirmed High/Critical;
- silently downgrading depth because a preferred optional tool is unavailable.

When a required stage cannot be completed, record the coverage/evidence limitation and carry it into the axis verdict.
