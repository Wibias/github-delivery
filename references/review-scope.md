# Evidence-based review scope

Run the unified planner before bug or security review:

```bash
node "<shipping-github>/scripts/review-scope.mjs" OWNER/REPO N
```

The compatibility commands `security-scope.mjs` and `bug-scope.mjs` consume the same plan and retain their established output fields.

## Evidence model

The planner combines:

- current and previous paths for renamed files
- added and removed patch lines
- removed authorization, validation, transaction, idempotency, and lifecycle controls
- changed symbols across common languages
- dependency manifests and lockfiles
- GitHub Actions permission and trust-boundary changes
- API, storage, business-state, AI/MCP, crypto, privacy, infrastructure, and outbound-network signals
- bug lenses for errors, resources, concurrency, retries, filesystem atomicity, cancellation, parsing, clocks, state, UI races, compatibility, and boundaries

Path matches are weak signals. Changed lines, removed controls, manifests, and structural workflow changes carry more weight.

## Confidence contract

| Score | Confidence | Handling |
|---|---|---|
| 6+ | high | Required coverage; may escalate to full/deep review |
| 3–5 | medium | Required targeted coverage |
| 1–2 | low | Residual lead only; never a finding by itself |

A generic logic diff receives baseline screens without falsely claiming every security domain was touched.

## Review depth

Security depth is `skip`, `baseline`, `targeted`, or `full`. Bug depth is `skip`, `baseline`, `targeted`, or `deep`.

- Pure documentation can skip.
- `SKILL.md`, MCP configuration, workflows, and executable agent references are not treated as ordinary documentation.
- Removed controls and high-confidence security evidence force a full security pass.
- Multiple required bug lenses or a high-confidence lifecycle/race signal force a deep bug pass.

## Uncertainty

Missing patches and very large diffs are reported explicitly. An incomplete plan cannot be used to downgrade path-only evidence without manual inspection. Large diffs must be partitioned by domain and checked for pagination completeness.

## Reviewer obligations

Review every high- and medium-confidence required domain or lens. Record low-confidence entries as residual leads, not findings. Prove that removed controls and broadened workflow permissions preserve the original invariant. A clean external review tool never cancels required coverage from this plan.
