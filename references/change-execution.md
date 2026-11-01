# Change execution for migrations and mechanical sweeps

Use this companion when an authorized implementation or refactor includes a broad deterministic transformation, an internal API migration, many similar call-site edits, or a sequence of dependent changes where one large unverified edit would hide failures.

The goal is to make non-trivial change waves reproducible, bounded, and easy to verify without forcing ceremony onto small edits.

## Trigger

Apply this companion when one or more of these are true:

- several callers must move from one internal API/shape to another;
- the same deterministic edit repeats across many files or data entries;
- generated or derived representations must be regenerated from one source;
- a migration has meaningful intermediate states that can be checked independently;
- a hand-edited sweep would make omissions difficult to detect.

Do **not** build a codemod, migration framework, or multi-step plan for a tiny local change when the tool/plan would cost more than the edit and add no stronger evidence.

## 1. Inventory the whole migration surface

Before the first migration edit, identify:

- the authoritative old and new contract;
- direct callers/consumers and derived representations;
- fixtures, tests, generated artifacts, docs, persisted formats, external consumers, and downstream compatibility that can keep the old contract alive;
- any intentionally supported old form that cannot be removed in this wave.

Use `references/semantic-propagation-review.md` when the concept crosses multiple representations or producer/consumer families. Do not infer completeness from one grep result when aliases, serialization, generation, or another language can encode the same contract.

## 2. Migrate callers, then delete obsolete internal paths

When the new internal API/shape is the intended design and compatibility is not required:

1. migrate the complete known caller set;
2. update tests and fixtures to assert the new contract rather than the old implementation detail;
3. delete the obsolete internal API, adapter, alias, fallback, or compatibility branch in the same change wave;
4. search again for residual callers/old forms and treat unexpected survivors as incomplete migration evidence.

Do not keep an internal legacy path solely because migrating callers is inconvenient.

A compatibility layer may remain only when there is concrete evidence that the old form was shipped, persisted, externally consumed, required by a supported version, or otherwise part of a real compatibility contract. Record the reason and the condition that allows its later removal. "Just in case" is not a compatibility contract.

### Expand-contract when one-step migration cannot stay green

Use an **expand-contract** sequence when the old and new internal forms can safely coexist for a bounded period but changing every caller in one step would create an unnecessarily large red or unreviewable intermediate state.

1. **Expand:** add the new form beside the old without removing the old path. Keep the overlap minimal and prove that existing callers still work.
2. **Migrate:** move caller families in independently checkable batches, for example by package, directory, provider family, or another real blast-radius partition. Each batch is blocked by the expand step and gets its own focused residual/check evidence.
3. **Contract:** after every intended caller is on the new form and the final residual search is clean, delete the old internal form and its migration-only tests/fixtures. The contract step is blocked by every migration batch.

The temporary old path in an expand-contract sequence is **migration scaffold**, not evidence of a supported compatibility contract. Do not preserve it after the contract gate merely because it existed during the migration.

Do not force expand-contract when dual forms would create ambiguous writes, split-brain state, unsafe schema semantics, incompatible persistence, or another real correctness risk. In that case use the smallest bounded non-shippable local/integration phase allowed by §5 and make the broken/intermediate invariant explicit.

## 3. Build a lever when it lowers change risk

For a broad, deterministic, repeatable transformation, prefer a small script/codemod/generator when it materially improves at least one of:

- completeness;
- repeatability after base changes;
- reviewability of the transformation rule;
- deterministic regeneration of derived output;
- reduction of hand-edit mistakes.

The lever should be narrower than the migration, not a new general-purpose framework. Prefer repository-native tooling and temporary task scripts when that is enough.

A useful lever should:

- be deterministic for the same input;
- fail loudly on an unexpected shape rather than silently skipping it;
- preserve unrelated formatting/content where practical;
- expose the count or identity of transformed targets when completeness matters;
- support a dry-run/diff/verification mode when mutation risk justifies it;
- be removed after use when it has no ongoing repository value, or retained with a documented maintenance purpose when it does.

Do not require automation when a small manual edit is clearer, safer, and easier to verify.

## 4. Remove shared state before serializing it

When a change wave exposes concurrent mutation or retry hazards, do not jump straight to a lock.

1. First ask whether the state can stop being shared: partition by owner/key, make one phase produce immutable output for the next, or give one component sole write ownership.
2. If a real cross-worker invariant still requires shared state, encode serialization structurally with a single writer, bounded lock/lease, compare-and-swap/version check, transactional boundary, queue, or explicitly sequential phase. "These callers normally do not overlap" is not concurrency control.
3. Make externally repeatable operations converge. Setup, migration, retry, and resume paths should tolerate an already-applied step or a crash after partial progress without duplicating effects or corrupting state.
4. When idempotency needs a key or durable marker, derive it from stable operation intent and store enough state to distinguish completed, retryable, and stale/incomplete work. Never delete or steal a lock/marker solely because it is old without proving ownership/lease semantics make that safe.
5. Verify the invariant with a rerunnable check that exercises repetition or contention. A successful single run is not proof that retries or concurrent writers are safe.

Prefer fewer shared mutable states over more elaborate synchronization. Serialization is the fallback for an invariant that truly must be shared, not the default architecture.

## 5. Sequence verifiable units

Break the change into the smallest meaningful units that end in a state you can check. A unit can be a planning step, edit batch, migration phase, or commit; it does not have to map one-to-one to Git commits.

For each unit:

1. state the intended effect;
2. state the evidence/check that distinguishes success from an incomplete or wrong transformation;
3. apply only that unit;
4. run the check before advancing when feasible;
5. stop or roll back when the unit introduces a red required gate or invalidates the migration assumptions.

Examples of useful unit checks:

- old-call-site count decreases to the expected value;
- new API contract tests pass while old compatibility tests are removed only after callers are gone;
- generated output is reproducible and residual old tokens are zero;
- one provider/platform partition migrates and its focused validation passes before the next partition;
- a schema/data migration proves read/write compatibility for the current phase before deleting the old path.

Do not manufacture dozens of tiny commits solely to appear disciplined. The requirement is independently checkable progress, not commit-count aesthetics.

## 6. Keep intermediate states honest

Prefer units that keep the working tree/build/test surface valid. When a migration genuinely requires a temporary intermediate state that is not independently shippable:

- keep it local to the smallest possible window;
- do not publish or call it merge-ready;
- record which invariant is temporarily incomplete;
- finish the paired unit before running the final gates;
- do not weaken repository checks merely to make the intermediate state green.

Required publication, CI, security, and ship gates still apply to the final candidate head. This companion never authorizes knowingly broken remote states when the governing workflow forbids them.

## 7. Verification for a completed change wave

Before claiming the migration/sweep complete, verify:

- every inventoried caller/representation is migrated or has a documented compatibility reason;
- residual searches for old names/shapes produce only intentional survivors;
- any automation produced the expected target count/result and did not silently skip unexpected input;
- repeatable operations remain convergent after retry/resume and shared-state invariants survive the intended contention model;
- focused checks passed for the meaningful partitions;
- repository-required tests/build/lint/security/CI gates pass on the final head;
- removed legacy paths are not still referenced by tests, fixtures, docs, generated artifacts, or supported downstream contracts.

For non-local safety claims, use `references/safety-invariant.md` rather than treating a successful sweep as proof of every semantic assumption. Before publishing numeric residual/caller counts or a broad "migration complete" statement, apply `references/completion-claims.md` so the final report uses the current measured result rather than an earlier remembered count.

## Planning output

When this companion is used in a refactor plan, record:

- **Migration surface:** old/new contract and caller/consumer inventory.
- **Compatibility decision:** delete old path, or keep it with concrete reason/removal condition.
- **Migration strategy:** direct | expand-contract | bounded non-shippable phase, with why.
- **Shared-state decision:** eliminate/partition | serialize, with the invariant and mechanism when serialization remains.
- **Idempotency decision:** how retries/resume converge for externally repeatable mutation.
- **Lever decision:** manual | script/codemod/generator, with why.
- **Verifiable units:** ordered effects and checks.
- **Completion proof:** residual search, repetition/contention checks when applicable, focused checks, and final gates.

## Provenance

This reference adapts practical ideas from Cursor's MIT-licensed `pstack` principles for migrating callers before deleting legacy APIs, building a lever for non-trivial mechanical work, sequencing work into verifiable units, making repeated operations idempotent, and removing shared mutable state before structurally serializing what truly must remain shared. The explicit expand-contract branch and blocker-shaped migration batches additionally adapt the wide-refactor strategy from Matt Pocock's MIT-licensed `to-tickets` skill. The rules are rewritten to fit `github-delivery`'s existing scope, evidence, compatibility, and publication contracts rather than copied as standalone skills.
