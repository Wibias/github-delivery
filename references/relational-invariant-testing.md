# Relational invariant testing

Individual schemas and helpers can all be correct while their composition is unsafe. Test stateful relationships across GitHub Delivery boundaries, especially where stale state, cached evidence, authority, retries, receipts, or postconditions interact.

## Current acceptance invariants

`tests/unit/relational-invariants.test.mjs` protects these cross-component contracts:

1. **Head refresh → authority scope:** refreshing a stale PR head must change the authority scope hash. A grant for the old head cannot remain semantically valid for the new head.
2. **Branch binding → authority scope:** binding the live PR branch is part of the effect scope even when the commit SHA itself did not move.
3. **Visible effect → authority scope:** changing human-visible mutation text changes the scope hash, while an internal idempotency transport marker does not.
4. **Receipt actor binding:** possession/collision of an idempotency marker does not prove the effect when the remote object belongs to another actor.
5. **Receipt effect binding:** the same marker cannot hide different visible content.
6. **Reply parent binding:** a reply receipt is valid only for the intended parent review comment.

These are intentionally integration-style unit tests over existing modules, not a new production abstraction.

## Expansion targets

Add a relational regression whenever a real failure involves two or more otherwise-valid components. High-value classes include:

- review evidence captured on head A reused after head B appears;
- authority scope refreshed but an older grant/receipt is still consumed;
- partial review/probe coverage incorrectly promoted to complete;
- mutation returned an ambiguous transport result and retry repeats the write instead of reconciling remotely;
- verifier reads a sibling object rather than the exact object the mutator changed;
- cached verdict/review state survives a material head/scope change;
- mutation scope widens after authorization;
- stack parent changes but child readiness evidence remains trusted;
- semantic propagation evidence belongs to a different variant partition than the final claim.

Prefer testing the real exported modules together. Add a new helper only when the invariant cannot be expressed or enforced through existing boundaries.
