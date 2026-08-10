# Research evidence hierarchy

Research quality depends on matching evidence to the **claim being proved**. Do not use one universal “primary > secondary” ordering for every question.

Use `scripts/lib/research-evidence-hierarchy.mjs` or:

```bash
node scripts/research-evidence-rank.mjs claim.json
```

## Claim types

### Current runtime behavior

For “does this still happen on the current development head?” prefer:

1. exact-head runtime reproduction;
2. executable tests/controlled fixtures;
3. shipping source on the exact head;
4. verified live GitHub/runtime state;
5. repository/spec/official documentation;
6. maintainer statements / primary repository context;
7. secondary sources;
8. model memory.

Runtime/test/source evidence is downgraded when it belongs to another head or is not bound to the claimed current head.

### Required/intended contract

For “what should the system do?” prefer:

1. repository policy / authoritative repository spec;
2. official documentation / standards;
3. explicit maintainer authority;
4. shipping source and executable observations;
5. external analysis.

Observed accidental behavior does not overrule an explicit governing contract merely because it currently executes that way.

### History / shipped state

For “when did this land, close, ship, or change?” prefer:

1. commits and pull requests;
2. issue/timeline events;
3. release records / verified live GitHub state;
4. maintainer statements;
5. source snapshots;
6. secondary prose.

Do not infer historical landing from current source alone when commit/PR evidence is available.

### External prior art / research

For external implementation guidance prefer:

1. official documentation / standards;
2. primary repositories and shipping source;
3. primary research papers;
4. maintainers/authors;
5. blogs/tutorials;
6. forums/social posts;
7. model memory.

When importing code/design rather than merely learning from it, record the source URL/revision and check the applicable licence/attribution requirements.

## Contradictions

Do not average away contradictory high-quality evidence.

When top-tier evidence disagrees:

1. expose the conflict;
2. identify what differs: head/version, environment, configuration, test input, intended contract vs actual behavior, or source freshness;
3. gather the smallest discriminating evidence;
4. keep the research verdict partial/unknown until the conflict is settled.

A lower-ranked source can overturn a higher-ranked one only when it provides concrete evidence that the higher-ranked source is stale, inapplicable, misread, or answering a different claim.

## Runtime debugging discipline

Combine this hierarchy with `references/runtime-evidence.md`:

- reproduce before guessing when feasible;
- capture real logs/traces/response bodies/state rather than relying on symptoms alone;
- locate the failing boundary from observed evidence;
- distinguish reporter theory from demonstrated root cause;
- compare working vs broken paths;
- fix the source of the defect, then rerun the same discriminator on the fixed head.

`not-reproduced` is evidence about one attempt/environment, never automatic proof of fixed.

## Evidence records

Useful research evidence records should include enough identity to be audited later:

- `id`;
- `kind`;
- conclusion/claim supported;
- repository/head/version/environment when applicable;
- source URL/commit/PR/test/artifact reference when applicable;
- freshness/date when externally sourced;
- limitations or applicability notes.

Model memory may help generate search terms or hypotheses, but should not be the final authority when primary/current evidence is obtainable.
