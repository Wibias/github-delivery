# Review finding triage

Use this companion before changing code for a human or bot review finding when the finding is not already an obvious required fix. It separates two questions that must not be collapsed:

1. **Is the finding true?**
2. **If true, what action is justified in this PR?**

A plausible reviewer comment is evidence to investigate, not authority to mutate code.

## 1. Classify truth

Every material finding gets exactly one truth classification:

`confirmed | false-positive | stale | unproven`

- **confirmed** — current-head source, behavior, contract, or executable evidence establishes the claimed problem.
- **false-positive** — current-head evidence shows the claimed problem does not occur or the cited rule/contract does not apply.
- **stale** — the finding describes an older head, removed code, or a condition already changed before this triage.
- **unproven** — the concern is plausible but available evidence does not establish or refute it cheaply enough. Do not round `unproven` up to confirmed or safe.

For material claims about a library, runtime, platform, API, protocol, or dependency, check the **actual dependency / pinned or shipped version** and local patches where relevant. A generic memory of how an API behaves is not enough. Prefer an **executable probe** that calls the real shipped path when the finding's correctness depends on runtime behavior.

## 2. Classify action

Independently assign exactly one action classification:

`must-fix | worth-fixing | decline | human-decision`

### must-fix

Use `must-fix` when current evidence establishes at least one concrete consequence in the current PR scope:

- reachable wrong behavior or a Bug;
- Security, authorization, privacy, integrity, or trust-boundary failure;
- Spec or acceptance-criteria violation;
- documented repository-standard or accepted architecture violation;
- compatibility, lifecycle, persistence, serialization, concurrency, or platform-semantic breakage;
- a material maintenance/testability/operational cost that makes the changed design meaningfully unsafe or misleading.

A bot calling something “important”, “critical”, or “best practice” does not itself satisfy this threshold.

### worth-fixing

Use `worth-fixing` for a bounded improvement that has a concrete benefit in this diff but is not required for correctness or policy, such as:

- clear avoidable duplication;
- an abstraction that adds measurable reader cost without owning a useful invariant;
- a misleading name or interface that materially raises misuse risk;
- a test that passes but cannot detect the behavior it claims to protect;
- a small simplification with clear maintenance value and low blast radius.

Keep the correction local. Do not turn a useful nit into architecture work.

### decline

Use `decline` when changing code would not improve the current PR enough to justify the mutation, including:

- taste or style preference with no concrete cost;
- an alternative implementation that is merely different;
- speculative refactoring for hypothetical reuse;
- unsupported “could potentially” failure modes with no credible reachable path;
- formatting/style already accepted or enforced by repository tooling;
- a technically true observation that is intentionally required by the Spec, repository standard, compatibility contract, or owning boundary.

A decline needs a short evidence-backed reason. Do not disguise a valid in-scope `must-fix` as “non-blocking”.

### human-decision

Use `human-decision` when the technically valid options change product behavior, compatibility promises, public API, architecture direction, risk acceptance, or authorized scope and the existing sources do not choose between them.

Do not let a bot make that product decision by default.

## 3. Truth does not imply action

Keep the two classifications separate. Examples:

| Finding | Truth | Action | Why |
|---|---|---|---|
| Bot identifies a reachable null dereference | confirmed | must-fix | concrete wrong behavior |
| Bot prefers a different helper name | confirmed | decline | true observation, no material cost |
| Bot cites behavior removed two commits ago | stale | decline | no current-head target |
| Bot asserts a dependency throws in an edge case but no shipped-version source/probe establishes it | unproven | decline or human-decision | do not mutate from speculation |
| Design review finds a tiny duplicated parser branch | confirmed | worth-fixing | bounded maintenance benefit |

`confirmed` does not automatically mean `must-fix`. `false-positive` and `stale` normally lead to `decline`. `unproven` must not be treated as proof for a code change; escalate to `human-decision` only when the unresolved risk itself materially affects shipping.

## 4. Scope-creep guard

Review feedback must not expand the PR beyond the user's original goal merely because the broader change would be “cleaner”. Fix real shortcomings owned by the current diff. For adjacent improvements, require a concrete current-PR consequence or leave them out.

When a finding touches a changed path but proposes a broad redesign, first ask whether the smallest correction can remove the demonstrated problem. Prefer that bounded correction.

## 5. Fix, decline, and resolution sequence

For findings that require action:

1. classify Truth + Action against the current head;
2. implement the smallest complete correction;
3. verify the relevant behavior;
4. push the fix;
5. reply in the correct thread with the evidence when a reply is required;
6. resolve only when the governing mutation policy permits it.

For `decline`, reply with the compact evidence-backed reason when public resolution is useful. For bot findings, never resolve an in-scope valid finding with only a defer-to-another-PR excuse.

## Output

Keep triage compact:

```markdown
- **Finding:** <thread/id + one-line claim>
- **Truth:** confirmed | false-positive | stale | unproven
- **Action:** must-fix | worth-fixing | decline | human-decision
- **Evidence:** <current-head path/source/probe>
- **Reason:** <one sentence>
```

The purpose is a better decision, not a larger review report.
