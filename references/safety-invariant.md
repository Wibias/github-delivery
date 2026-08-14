# Safety invariant proof

Use this companion when a review finds that a change has non-local risk: shared helpers, hub modules, serialization, schemas, provider families, protocol boundaries, lifecycle timing, caches, persisted data, or another path where grep alone does not prove safety.

The goal is to identify the small number of facts that make the change safe and push those facts toward executable proof.

## Name the invariant

For each material risk, state the fact the positive verdict depends on.

Examples:

- every public capability list is derived from the same canonical registry;
- the cleanup call only removes entries that are already unreachable;
- the parser rejects malformed input before persistence;
- the new default is used only when the caller omitted the field;
- all provider variants pass through the same validated transformation.

Do not replace the invariant with a list of callers. The useful question is what must stay true for those callers to remain safe.

## Proof ladder

Record the strongest level reached for each material invariant:

1. **Claimed:** the reviewer states the invariant but has not tied it to code.
2. **Located:** exact source lines, pinned dependency source, schema, or contract support it.
3. **Traced:** the relevant bad path was followed and shown not to reach the unsafe state.
4. **Executed:** a test, script, probe, or command runs the real path and fails loudly if the invariant is false.
5. **Reproduced:** the invariant was also exercised in the running product or closest production-like environment.

A polished explanation is not stronger evidence than the level it reached.

## Review flow

1. Read the changed behavior and identify the non-local risk.
2. Find the one or two invariants that collapse the main risk if they hold.
3. Search past direct callers. Check serialized forms, other languages, external libraries, timing/lifecycle behavior, feature flags, caches, generated data, and pinned dependency behavior when relevant.
4. Prove each invariant as far down the ladder as is practical and useful.
5. Separate confirmed risks from cleared risks. Do not leave a long list of speculative breakage in the final verdict.
6. If an important invariant remains below executable proof, mark it `unproven` and explain why. Do not round the evidence up to "safe".

## Relationship to semantic propagation

`references/semantic-propagation-review.md` maps every changed concept across authoritative and derived representations. This companion adds a narrower question for risky concepts: what fact makes the propagation safe, and how strongly was that fact proved?

Use semantic propagation to find the affected system. Use the safety invariant to prove the key assumption inside that system.

## Output

For each material invariant, report:

- **Invariant:** the exact fact the verdict depends on.
- **Risk if false:** concrete wrong behavior.
- **Proof level:** Claimed | Located | Traced | Executed | Reproduced.
- **Evidence:** path/line, dependency source, test, script, probe, or runtime result.
- **Status:** proved | unproven | violated.

A violated invariant is a finding. An unproven material invariant remains an evidence gap and must be reflected in the final verdict.

## Provenance

This reference adapts the "prove the fact that makes it safe" idea from Cursor's `pstack` `blast-radius` skill. `pstack` is MIT licensed, copyright 2026 Lauren Tan. The proof ladder and output are rewritten for `github-delivery`'s review and evidence model.
