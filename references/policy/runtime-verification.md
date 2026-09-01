# Runtime Verification Policy

Apply this module only when a project-local verification skill exists and the candidate change affects observable runtime behavior or carries material runtime risk. The verifier is a project capability; GitHub Delivery consumes its evidence and does not generate or repair it during delivery.

### GD-RUNTIME-001 — Runtime evidence is exact-head and fail-closed

When this module applies, identify the project-local `.agents/skills/verify-*` owner and the affected feature-map entries. Run the covered real user-facing path after implementation and evaluate its receipt with:

```text
node scripts/runtime-verification-receipt.mjs --receipt <receipt.json> --repo OWNER/REPO --head <FULL_HEAD_SHA>
```

Interpret the classifier exactly:

- `pass_current`: positive runtime evidence for the named feature on the exact candidate HEAD;
- `stale`: historical evidence only; rerun the affected verification on current HEAD before a positive runtime claim;
- `fail`: the driven behavior is wrong; correct the candidate and rerun;
- `blocked`: required runtime coverage is incomplete; keep that gap visible and do not round it up to pass;
- `invalid`: restore valid evidence before using it for delivery decisions.

A later candidate HEAD invalidates earlier positive runtime evidence. Tests, type checks, builds, CI, and proactive contract verification remain separate evidence and are not replaced by a runtime receipt.

Do not activate this module merely because a verifier exists. Docs-only, type-only, or clearly internal behavior-preserving changes do not require runtime driving unless the diff creates material runtime risk. Observable CLI/API/UI behavior, persistence semantics, migrations, runtime bug fixes, or performance claims normally do.

If the repository lacks a usable verifier, do not synthesize one inside GitHub Delivery. Record the coverage gap or hand off verifier creation/repair to the owning verification-harness capability. A fresh verifier should receive the acceptance criteria, current HEAD, verifier path, and affected feature entries, not the implementation worker's transcript or confidence claims.
