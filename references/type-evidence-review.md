# Type evidence review

Use this companion during Standards review when a diff changes TypeScript or typed JavaScript and the changed path carries meaningful compile-time or runtime type evidence. It is an **evidence-preservation lens**, not a generic style guide and not a replacement for the repository's compiler, linter, schema validation, bug review, or security review.

## Goal

Preserve evidence that the program already established instead of discarding it into a broader anonymous type and later recreating certainty with assertions, reflection, mocks, or repeated ad hoc narrowing.

The core question is:

> What fact did the code know here, where was that fact weakened or lost, and what credible evidence establishes it again?

A type pattern is not a finding merely because a stricter codebase might ban it. Report only concrete evidence loss that creates a correctness, testability, maintainability, or reviewability cost in this diff.

## Authority and scope

- **Repository standards override this baseline.** Existing ADRs, type conventions, generated-code constraints, framework contracts, and configured lint rules win.
- If the repository already runs anti-slop, ESLint, Oxlint, Biome, TypeScript, or another relevant analyzer, use its result as repository evidence. Do not install a new linter or vendor a plugin merely to perform this review.
- Do not turn a passing or failing lint rule into a GitHub Delivery verdict without checking the concrete code path and governing repository contract.
- Scope this lens to changed TypeScript, JavaScript with JSDoc/types, schema adapters, typed API/CLI boundaries, and directly necessary adjacent contracts.
- When the concern demonstrates reachable wrong behavior, an unproven safety assumption, or a test that cannot detect broken production wiring, hand it to the Bug, Security, Spec, or safety-invariant path. Do not hide a real defect as an advisory style note.

## Rule-by-rule anti-slop checklist

Use these names as review shorthands for the practical anti-slop subset. They do not create a universal style law. The repository's configured lint rule is binding when present, and this checklist supplies the judgement layer when GitHub Delivery reviews a repository that does not use the same plugin.

- **`no-chained-type-assertions`:** flag `value as unknown as T`, `value as object as T`, nested assertions, or equivalent chains when no parser, runtime check, exhaustive branch, constructor, or verified interop contract adds evidence between the casts. A contained assertion at a real library interop boundary is not a finding merely because it is an assertion.
- **`no-known-value-widening`:** flag a precise known value that is deliberately widened to `unknown`, `object`, an anonymous object, or a generic/open container when the lost shape matters later. Do not apply this to raw external input whose key or value universe is genuinely unknown.
- **`no-object-parameters`:** treat broad internal `object` parameters as a lead when the caller already has a named owner/domain type or the boundary already validated the value. Do not convert this into a blanket ban for external boundaries, framework hooks, or genuinely generic APIs.
- **`no-reflect-apply`:** flag `Reflect.apply` when a normal typed function call is available and reflection only bypasses the call contract. True dynamic dispatch or library interop can justify it when the invariant is explicit and contained.
- **`no-reflect-get`:** flag `Reflect.get` when typed property access is available and reflection only discards a stable property contract. Dynamic registries, proxies, compatibility layers, or library interop can justify it when the dynamic boundary is real.
- **`no-widen-then-assert`:** flag flows that widen a known value and later assert it back to a narrower type without new evidence. Review the earlier evidence-destroying boundary, not only the later cast.
- **`require-safety-comment-for-type-assertion`:** require a credible invariant for a material assertion, not ritual wording. Do not require a literal `SAFETY:` comment generically. If the repository requires `SAFETY:` through its lint/config contract, that repository rule is binding and the review should enforce it.

For all seven checks, distinguish a repository-standard violation from a GitHub Delivery advisory. Escalate only when the evidence proves a Bug, Security, Spec, or safety-invariant consequence.

## 1. Trace evidence creation

Before judging an assertion or broad type, identify the strongest evidence available immediately before it. Examples include:

- literal and object-key inference;
- discriminated unions and exhaustive variants;
- validated schema/parser output;
- branded or nominal values established by a constructor or parser;
- generic constraints and overload contracts;
- known registry keys or tuple positions;
- repository-owned DTOs and domain types;
- runtime checks at an external trust boundary.

If no stronger fact exists yet, a broad type such as `unknown` may be the correct representation.

## 2. Look for evidence destruction

### Chained assertions

Treat `value as unknown as T`, `value as object as T`, nested type assertions, or equivalent assertion chains as a strong lead when the intermediate type exists only to bypass an incompatibility.

Ask what invariant makes the final type true. If no local validation, constructor, parser, exhaustive branch, library contract, or other credible proof establishes it, the assertion is laundering uncertainty rather than expressing evidence.

### Known-value widening

Look for **known-value widening**: a value has a precise inferred shape or finite key set, then an explicit broader annotation discards that information.

Examples include:

- a literal registry widened to `Record<string, Handler>` when the known keys matter downstream;
- a discriminated value widened to `object`, `{}`, `unknown`, or an anonymous dictionary;
- a concrete tuple or readonly object widened to a generic container before later recovery;
- a parsed domain value widened back to raw transport-like data inside trusted internal code.

Prefer preserving inference, `satisfies`, an appropriate generic, a discriminated model, or a named owner contract when those shapes express the real contract.

### Widen then assert

Trace local and cross-function flows where code deliberately widens a known value and later asserts it back to the original or another narrow type.

The later cast is often only the symptom. The review target is the earlier boundary that unnecessarily erased the evidence.

### Broad internal contracts after validation

`unknown` is useful at trust boundaries. It becomes suspicious when validated internal values repeatedly cross helpers as `unknown`, `object`, `{}`, or unsafe dictionaries and every consumer must rediscover facts already proved upstream.

Do not ban broad boundary types. Ask whether the boundary already created a trusted internal representation and whether a deeper layer is throwing that representation away.

### Reflection over typed contracts

`Reflect.get`, `Reflect.apply`, dynamic property access, or equivalent reflective machinery is a lead only when a stable typed property/call contract is already available and reflection bypasses it.

Reflection is not automatically wrong. Framework adapters, proxies, decorators, compatibility layers, and genuinely dynamic registries may require it.

## 3. Require proof quality for assertions

A material assertion should correspond to an identifiable invariant that TypeScript or the local type system cannot express directly.

Credible proof can come from:

- a runtime parser or schema check on the same value;
- an exhaustive branch that establishes the variant;
- a constructor or factory with a verified postcondition;
- a repository-owned lookup whose key universe proves the result;
- a documented third-party library guarantee verified at an interop boundary;
- a focused test that exercises the exact invariant when static proof is impractical.

A comment can document that proof, but **a comment is not proof by itself**. Do not require a literal `SAFETY:` comment. A truthful nearby explanation is useful only when the underlying invariant is independently credible.

When a cast is necessary for library interop, contain it at the interop boundary and expose a stronger repository-owned contract internally rather than repeating the assertion through the codebase.

## 4. Test honesty and module mocks

A module mock is not automatically a problem. Treat it as a lead when the test claims to verify behavior that the mock itself bypasses.

High-value cases include tests for:

- CLI command or route registration;
- dependency construction and adapter selection;
- module side effects or startup registration;
- plugin/provider discovery;
- API wiring between an exported surface and its production implementation.

If mocking the registry, router, module loader, or production composition root lets the test pass while real wiring is broken, report a test-honesty or Bug finding and require a real seam, smoke test, or integration path that would fail on the broken production wiring.

A focused unit test that replaces a clock, network client, filesystem, or service through an existing dependency-injection seam is not a finding merely because it uses a mock. Check whether the claimed production contract is verified elsewhere.

## 5. Explicit non-findings

Do not report these by default:

- raw **untrusted external input** represented as `unknown` before parsing;
- `unknown` in a catch or adapter boundary where the value genuinely has no stronger contract yet;
- `typeof`, `instanceof`, discriminant checks, or type predicates used to establish a real runtime fact;
- schema validation that narrows a boundary value into a trusted internal type;
- genuinely open dictionaries whose key universe is not known by design;
- a single contained library interop assertion backed by a verified external/runtime invariant;
- module mocks that exercise a real repository seam and do not bypass the behavior the test claims to verify;
- names such as `Shape` merely because another codebase dislikes the vocabulary.

**Do not ban `unknown`. Do not ban `typeof`. Do not require a literal `SAFETY:` comment.** Those blanket policies would conflict with valid trust-boundary and interoperability designs.

## 6. Classification and reporting

For each material observation record:

- **Location:** changed file and symbol/hunk.
- **Evidence created:** the strongest fact available before the questionable step.
- **Evidence lost:** the widening, assertion chain, reflection, mock, or anonymous contract that removed or bypassed that fact.
- **Proof:** what, if anything, establishes the later narrower claim.
- **Concrete cost:** reachable bug, hidden wiring failure, invalid-state exposure, duplicated validation, weakened exhaustiveness, or material reader/test burden.
- **Bounded correction:** the smallest shape that preserves or re-establishes the fact honestly.
- **Authority:** Bug/Security/Spec/repository standard when binding; otherwise advisory Standards evidence.

Use `none` when no material type-evidence issue exists. Do not pad a clean review with generic cast or mock complaints.

### Severity boundary

Escalate beyond advisory Standards review only when the evidence supports it:

- **Bug/type-safety:** a concrete runtime trigger can violate the asserted contract, an impossible state becomes reachable, or broken production wiring can remain green under the test.
- **Security/safety invariant:** authorization, trust, integrity, or another material safety decision depends on an unproven type assertion or erased discriminator.
- **Spec:** docs/API/CLI promises rely on a type path that does not implement the promised contract.
- **Advisory Standards:** evidence is unnecessarily weakened and creates concrete maintenance/testability cost, but no current wrong behavior is proved.

Passing typecheck alone does not prove an assertion is truthful. Conversely, an assertion or broad type alone does not prove a bug.

## 7. Preferred corrections

Prefer the smallest correction that preserves the real contract:

1. keep inference when it already describes the value;
2. use `satisfies` when validation against a broader contract is needed without widening the value;
3. use a named domain/owner contract when callers need a stable abstraction;
4. use generics or discriminated unions when relationships between inputs and outputs matter;
5. parse and narrow raw input once at the owning trust boundary;
6. contain unavoidable assertions/reflection at one verified interop boundary;
7. test through real dependency seams when production wiring is the behavior under review.

Do not introduce speculative abstractions or large refactors merely to remove a cast.

## Relationship to other review companions

- `references/design-quality.md` owns the broader boundary, domain-model, abstraction-cost, and state-ownership questions.
- `references/bug-review.md` owns reachable incorrect behavior and test paths that fail to detect broken production behavior.
- `references/safety-invariant.md` owns material non-local facts a positive verdict depends on.
- Repository lint/typecheck remains executable evidence, not a substitute for this judgement layer.

## Provenance

This review lens adapts the evidence-preservation ideas from dmmulroy's MIT-licensed `anti-slop` project, especially chained assertions, known-value widening, widen-then-assert flows, assertion justification, and test-seam concerns. GitHub Delivery intentionally does **not** import anti-slop's blanket bans on `unknown`, runtime `typeof`, module mocking, reflection, or naming. The rules are rewritten as repository-aware evidence heuristics that fit GitHub Delivery's existing fail-closed review model.
