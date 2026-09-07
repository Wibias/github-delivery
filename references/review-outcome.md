# Review outcome visibility

Use this companion for full-review and merge-ready evidence. It does not add review axes or another review engine; it makes the conclusions of existing review machinery visible and keeps their authority clear.

## Code quality

Source this result from the existing Spec/Standards review and its advisory companions (`references/code-smells.md`, `references/design-quality.md`, and `references/type-evidence-review.md` when applicable).

Report exactly one compact outcome:

- `clean` — applicable advisory lenses found no material reader, maintenance, testability, state-ownership, or abstraction-cost issue;
- `n/a — <reason>` — no meaningful executable/design surface exists (for example docs-only/mechanical-only);
- `<N> material observation(s)` — then name only observations with a concrete cost and bounded correction.

Keep authority explicit. An advisory code-quality observation is not a hard Standards violation unless a documented repository rule independently makes it one. When it is actionable, classify it through `references/review-finding-triage.md` before changing code.

## Blast radius

Do not create a separate blast-radius reviewer. Build this result from:

1. `references/semantic-propagation-review.md` for changed concepts, authority, producers/consumers, public/derived representations, variants, and coverage; and
2. `references/safety-invariant.md` when a material non-local risk depends on a fact that caller search alone does not prove.

Report:

- **Scope:** `local | non-local`
- **Affected concepts:** `<concepts>`
- **Safety invariant:** `<fact>` or `n/a — <local-only reason>`
- **Proof:** `n/a | Claimed | Located | Traced | Executed | Reproduced`
- **Confirmed risks:** `none | <real risks>`
- **Cleared risks:** `none | <risks checked and why cleared>`
- **Unproven:** `none | <material assumptions>`

`local` is valid only when evidence shows the change does not alter shared, public, serialized, persisted, provider-family, lifecycle, protocol, schema, or other non-local behavior. Do not infer local scope merely because few files changed.

A material invariant below `Executed` must remain explicitly `unproven` unless the governing review documents why executable proof is not practical and treats the evidence gap accordingly. Never round a polished explanation up to safe.

## Public verdict placement

Full-review and merge-ready public evidence should expose both conclusions near the other review axes:

```markdown
- **Code quality:** clean | n/a — <reason> | <N> material observation(s)
- **Blast radius:** local/non-local — <proof level or n/a>; risks: <none/summary>; unproven: <none/summary>
```

When a full details section is present, include the expanded blast-radius fields there only when they add reviewer value. Do not dump propagation matrices, caller inventories, or proof transcripts into the public comment; keep those as workflow evidence unless a concrete risk requires explanation.

## Completion

A positive full-review/merge-ready conclusion requires:

- applicable Code quality observations triaged without turning taste into blockers;
- semantic propagation completed where the changed concept requires it;
- material non-local safety assumptions proved as far as practical;
- any material `unproven` invariant reflected honestly in the gate/verdict rather than silently omitted.
