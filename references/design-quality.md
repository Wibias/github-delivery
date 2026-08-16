# Design quality review

Use this companion during Standards review when a diff changes executable behavior, architecture, domain/state modeling, concurrency, or non-trivial control flow. It is an **advisory design lens**, not a replacement for repository standards, Spec review, bug/security review, or executable evidence.

The goal is to identify changed designs that impose avoidable reader, state, or boundary complexity and to explain the concrete cost. Do not turn a preferred pattern into a blocker by itself.

## Authority and reporting

Repository-specific standards, ADRs, accepted architecture, compatibility requirements, and explicit product constraints win over this baseline.

A design-quality observation counts only when the changed code provides concrete evidence of a maintenance, correctness, testability, or operational cost. Report the exact file/symbol, the cost in this diff, and the bounded safer shape. If the concern is only taste, omit it.

If a design issue creates a real behavior defect, vulnerability, spec violation, or unproven non-local safety assumption, route it to the Bug, Security, Spec, or `references/safety-invariant.md` path instead of hiding it as a style suggestion.

## 1. Keep the normal use case visible

Top-level orchestration should make the normal use case understandable without forcing the reader through low-level plumbing first.

Look for changed code where:

- the primary operation is buried under nested conditionals, process plumbing, conversion details, or exceptional branches;
- guard conditions can safely reject invalid or inapplicable states before the main path;
- helpers hide mechanical details while the caller still exposes the meaningful domain sequence;
- a reader needs unrelated files or history merely to understand the normal path.

Do not flatten control flow when ordering, cleanup, transactions, locking, or error propagation requires the existing structure. "Happy path first" is a readability goal, not permission to move required failure handling out of its owning boundary.

## 2. Put validation at the owning boundary

Raw external data should be parsed, narrowed, and validated at the boundary that first owns it: CLI/config input, network/API input, GitHub/tool output, IPC, persistence deserialization, filesystem input, or another trust transition.

After that boundary establishes a trusted internal representation, do not repeat the same validation at every internal layer merely for reassurance. Repeated checks increase reader load and can drift into inconsistent interpretations.

Additional internal checks are justified when they protect a **different** contract, for example:

- a second trust transition or deserialization boundary;
- an authorization/security boundary;
- persistence or corruption detection;
- a lifecycle, concurrency, or state-machine invariant;
- an assertion that makes a programmer error fail loudly at the owning layer.

For security- or authority-sensitive code, fail-closed requirements remain binding. Boundary discipline means assigning validation to the correct owner, not deleting necessary defenses.

## 3. Make abstractions compress complexity

An abstraction should hide more complexity than it introduces.

Evaluate the total reader cost, not line count:

- extra files, interfaces, wrappers, factories, configuration, and call hops;
- new concepts or names the reader must remember;
- indirection that does not enforce policy, compatibility, lifecycle, ownership, or a stable domain boundary;
- generic machinery built for hypothetical reuse rather than demonstrated requirements.

A useful abstraction shortens the set of facts callers must understand. If ten obvious local lines become several layers with no stronger contract, the abstraction has negative value even if each individual file looks "cleaner".

### Deep-module checks

When a changed abstraction or seam is material, use these as **advisory tests**, not mandatory vocabulary or automatic violations:

- **Deletion test:** imagine deleting the abstraction. If the complexity actually disappears, the abstraction may be pass-through ceremony. If the same policy/invariants would spread back across many callers, the abstraction is probably earning its keep.
- **Interface as test surface:** callers and stable tests should usually be able to exercise the behavior through the same owning interface. Repeated testing past the public/owning surface can signal that the boundary is too shallow or that important behavior lives in caller choreography.
- **Real seam test:** a configurable interface/port with only one concrete use can be speculative. A second real adapter/variant, including a justified production-vs-test adapter at an actual external seam, is stronger evidence that the seam represents real variation.
- **Leverage and locality:** prefer boundaries that give callers substantial behavior through a small understandable contract and concentrate change, bugs, invariants, and verification in one owner rather than scattering them across callers.

Do not force repository terminology such as `module`, `port`, `adapter`, or `service` when the project already has established domain/architecture language. Judge the underlying ownership and complexity, not the label.

Do not inline a boundary that genuinely owns policy, security, lifecycle, compatibility, observability, or independently changing behavior.

## 4. Model domain states and invariants explicitly

When the same domain decision is scattered across booleans, string tags, repeated `if`/`switch` branches, or synchronized fields, ask whether one explicit model would remove invalid combinations and duplicated interpretation.

Useful shapes can include:

- enums or discriminated states for mutually exclusive lifecycle states;
- registries/tables for one authoritative mapping used by several consumers;
- value objects for validated domain concepts;
- state transitions owned by the object/module responsible for the invariant;
- one canonical source from which derived representations are generated.

Do not introduce a domain type only to rename a primitive. The model must remove ambiguity, illegal states, duplicated conditionals, or ownership confusion.

## 5. Give mutable state one clear owner

For changed mutable state, identify who is allowed to change it and who merely observes it.

Prefer one owner for state transitions and invariants over several callers directly coordinating fields. A caller should request a domain operation when that keeps transition rules in one place.

When concurrent actors appear to share mutable state, ask first whether the state can be partitioned or separately owned. If true sharing is required, enforce coordination structurally with the repository's locking, transaction, sequencing, or ownership mechanism. Comments and conventions are not concurrency control.

Do not add synchronization merely because concurrency is imaginable. Require a reachable shared-state path, a documented concurrency contract, or another credible failure model.

## 6. Require evidence before optional complexity

New abstractions, fallback chains, compatibility layers, speculative safeguards, and generalized machinery need a concrete reason in the current contract.

Good reasons include:

- a current requirement or supported compatibility contract;
- an observed bug, runtime state, log, fixture, or user report;
- demonstrated reuse or repeated maintenance cost;
- a credible security, authorization, data-integrity, platform-semantic, or concurrency threat/failure model.

Do **not** require a production incident before protecting a security or integrity boundary. Evidence-before-complexity rejects unsupported architecture, not proactive controls backed by a concrete threat or failure model.

## Review output

For each material design-quality observation record:

- **Location:** changed file and symbol/hunk.
- **Lens:** happy path | boundary | abstraction cost | domain model | state ownership | evidence/complexity.
- **Concrete cost:** what becomes harder, duplicated, unsafe, or easier to misread in this diff.
- **Bounded correction:** the smallest design change that removes that cost.
- **Authority:** advisory, or the repository rule/bug/security/spec contract that independently makes it binding.

Use `none` when no material design-quality issue exists. Do not pad a clean Standards review with theoretical refactors.

## Relationship to existing companions

- `references/code-smells.md` supplies negative heuristic smells. This file supplies positive design questions and the cost test for deciding whether a smell matters.
- `references/minimal-solution.md` helps choose a solution shape before implementation; this file reviews the design cost of the result.
- `references/semantic-propagation-review.md` maps changed concepts across the system. Domain/source-of-truth concerns found here can trigger that deeper propagation check.
- `references/safety-invariant.md` proves the material fact a positive verdict depends on when design risk is non-local.
- `references/simplify-pr.md` remains explicit-only for edits. A Standards reviewer may report a material design issue, but must not silently perform optional simplification.

## Provenance

This reference adapts and combines design ideas from Cursor's MIT-licensed `pstack` principles, including boundary discipline, domain modeling, reader-load reduction, and separating shared state before serialization, with happy-path, abstraction-cost, state-ownership, and pragmatic complexity ideas from Hona's publicly shared engineering-design gist. The deletion-test, interface-as-test-surface, real-seam, leverage, and locality checks additionally adapt deep-module ideas from Matt Pocock's MIT-licensed `codebase-design` skill. The wording and review contract are rewritten for `github-delivery`'s evidence-first, fail-closed model; repository language and decisions remain authoritative.
