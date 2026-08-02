# Semantic Propagation Review

Use this review axis for every `full-review-pr` run.

Its purpose is to detect changes that are locally correct in the modified file
but inconsistent with another representation, sibling variant, public output,
canonical registry, schema, capability table, default, serializer, or test.

This axis is mandatory. Bug, security, Spec, Standards, and CI review do not
replace it.

## Core rule

A full review must trace every changed domain concept, not merely every changed
file.

For each changed concept, identify:

1. the authoritative source of truth;
2. every producer or transformation of that concept;
3. every consumer;
4. every derived, cached, serialized, persisted, or public representation;
5. every materially distinct entity or behavior variant;
6. every relevant positive and negative test;
7. every required equality or intentional difference between representations.

The review is incomplete while any applicable item is unidentified or
unverified.

## Step 1: Name the changed concepts

Translate the diff into domain concepts.

Examples:

- reasoning-effort ladder;
- model capability;
- provider support;
- authorization scope;
- feature availability;
- default selection;
- catalog membership;
- API response shape;
- persistence format;
- schema validation;
- retry policy;
- environment capability;
- command routing.

Do not use filenames as the concept name.

A PR may change more than one concept. Create one audit record per concept.

## Step 2: Find the authoritative source

For each concept, identify which representation is authoritative.

Possible sources include:

- canonical catalog or registry;
- schema;
- database model;
- protocol definition;
- generated specification;
- configuration source;
- provider capability declaration;
- documented compatibility table;
- existing invariant test.

If authority is ambiguous, record that ambiguity as a review finding. Do not
silently choose the implementation in the changed file as authoritative.

## Step 3: Search beyond the diff

Use the changed symbols, field names, enum values, identifiers, model names,
provider names, serialized keys, and test descriptions to search the entire
repository.

Inspect:

- sibling implementations;
- catalog and registry definitions;
- synchronization or generation code;
- serializers and API responses;
- UI and CLI representations;
- caches and persisted forms;
- fixtures and snapshots;
- validation code;
- documentation that defines behavior;
- tests outside the changed directory.

The changed-file list is a starting point, not the review boundary.

## Step 4: Build the propagation matrix

For every changed concept, produce this matrix:

| Field | Required content |
|---|---|
| Concept | Domain-level behavior that changed |
| Authoritative source | File and symbol that define correct behavior |
| Producers | Code that creates or transforms the value |
| Consumers | Code that reads or acts on it |
| Public/derived representations | API, CLI, UI, serialized, cached, generated, or persisted forms |
| Variants | Materially distinct models, providers, platforms, modes, roles, or configurations |
| Required equality | Representations that must match exactly |
| Intentional differences | Differences supported by explicit evidence |
| Positive tests | Required values or behavior |
| Negative tests | Forbidden, absent, rejected, or unsupported values |
| Result | matched, intentional difference, or blocker |

Do not publish the final verdict without completing every applicable row.

## Step 5: Partition families by behavior

When changed code applies to a collection or family, enumerate its members and
partition them by actual behavior.

Examples include:

- models;
- providers;
- platforms;
- operating systems;
- roles;
- permission levels;
- feature-flag states;
- schema versions;
- protocol variants;
- storage backends;
- command modes.

A single representative test is valid only when equivalence is proved from the
implementation and source data.

Similar names, shared prefixes, inheritance, or membership in the same family
do not prove equivalence.

If members have different canonical values, defaults, permissions,
capabilities, error behavior, or compatibility guarantees, test every distinct
partition.

## Step 6: Reconcile canonical and derived representations

When the concept exists in both canonical and derived forms, compare them
directly.

Prefer an exact parity test or probe:

```text
derived(entity) == canonical(entity)
```

Run the comparison for every materially distinct variant.

Do not settle for checking that a known-good value is present when an extra
value would also be observable behavior.

For lists, sets, enums, permissions, efforts, features, and capabilities,
verify both:

- expected values are present;
- unexpected values are absent.

Use exact equality when order is part of the public contract. Use exact set
equality when order is not part of the contract.

## Step 7: Audit test representativeness

For every changed family-wide helper or shared transformation, answer:

1. Which variants does the production logic affect?
2. Which behavior partitions exist?
3. Which partition does each test cover?
4. Which partitions remain uncovered?
5. What evidence proves an uncovered member is equivalent to a covered member?
6. Are negative assertions present for accidental widening?
7. Would an extra capability, enum member, permission, route, or default make
   the test fail?

Block the verdict when production behavior affects multiple partitions but
tests cover only one without proving equivalence.

Use this finding language:

`Coverage is not representative of the changed abstraction.`

## Step 8: Reconcile claims and current evidence

Before the final verdict, verify that:

- the PR description matches the current head;
- claimed test counts match the current test changes;
- current required CI has completed;
- probes and local validation use the reviewed head;
- no evidence belongs only to an earlier SHA;
- generated or synchronized representations are current.

A stale PR body is not necessarily a code defect, but it is a review finding
and must be corrected before a merge-ready verdict when it materially
misdescribes scope or validation.

## Blocking conditions

The semantic propagation axis is blocked when any of these remains:

- no authoritative source was identified;
- authority is ambiguous and unresolved;
- an affected producer or consumer was not inspected;
- a public or serialized representation was not reconciled;
- family members were not partitioned by behavior;
- representative coverage was assumed rather than proved;
- a canonical and derived representation disagree;
- tests cover only positive presence where accidental widening is possible;
- a materially distinct variant lacks coverage;
- a repo-wide search for the changed concept was not performed;
- PR claims or validation evidence refer to an older head;
- required CI remains incomplete.

These are final-verdict blockers, not optional follow-up suggestions.

## Required output

Return one section per changed concept:

```markdown
### Semantic propagation: <concept>

- **Authoritative source:** `<path>:<symbol>`
- **Producers:** ...
- **Consumers:** ...
- **Public/derived representations:** ...
- **Material variants:** ...
- **Required equality:** ...
- **Intentional differences:** ...
- **Positive tests:** ...
- **Negative tests:** ...
- **Result:** matched | intentional difference | blocker
- **Evidence:** `<path>:<line>`, command/probe, or test
```

Then return:

```markdown
### Semantic propagation verdict

- **Concepts audited:** ...
- **Unmapped surfaces:** none | ...
- **Unproven equivalence assumptions:** none | ...
- **Representation mismatches:** none | ...
- **Variant coverage gaps:** none | ...
- **Verdict:** pass | blocked
```

The full-review final verdict may proceed only when this axis returned `pass` or
when every blocker is explicitly incorporated into a non-approval verdict.
