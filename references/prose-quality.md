# Prose quality for durable GitHub text

Use this companion when `github-delivery` authors durable prose: PR descriptions,
issue bodies, PRDs, review/status comments, merge-ready summaries, and other
GitHub text that is not required to remain exact user-authored wording.

This layer improves readability only. Evidence, policy, template shape, security
redaction, exact GitHub syntax, and exact user-confirmed text always win over
style cleanup.

## Core rules

1. **Use repository words.** Prefer the real file, symbol, flag, check, action,
   state, or command name over a synonym or invented abstraction.
2. **State concrete facts.** Replace vague praise, concern, or confidence with
   the behavior, evidence, number, path, SHA, check, or consequence that earns
   the claim.
3. **Use plain words.** Prefer `use`, `help`, `start`, `stop`, `read`, `write`,
   `move`, and `delete` when they are accurate. Do not make routine engineering
   work sound more abstract than it is.
4. **Prefer active voice.** Name the actor when it matters: `ship-gate.mjs`
   blocks the claim, the compiler rejects the input, or the workflow posts the
   comment.
5. **Keep one main thought per sentence.** Split a sentence when conditions,
   exceptions, evidence, and conclusions compete for attention.
6. **Put conditions before actions.** State when a step applies before telling
   the reader to do it.
7. **Cut filler and ceremony.** Remove generic introductions, repeated
   conclusions, promotional wording, vague attributions, excessive hedging,
   and phrases that do not change the meaning.
8. **Do not force symmetry.** Use the natural number of bullets and sections.
   Do not pad an artifact to make every section look equally full.
9. **Use sentence-case headings.** Do not add decorative emoji or formatting
   that competes with the evidence.
10. **Keep names stable.** Do not cycle through synonyms for the same workflow,
    gate, state, action, or concept.

## Publication tells

Delete these when `github-delivery` authors the prose. This is a deletion list,
not a voice. Do not add first person, personality, or "soul." Do not score
whether the text "sounds human." Do not ban em dashes. Quoted user text and
evidence states stay exact.

- **Chatbot phrases.** Cut `I hope this helps`, `Let me know if you need
  anything`, `Of course!`, `Certainly!`, `Great question!`, `You're absolutely
  right!`, and `Found the smoking gun!`.
- **Process narration.** Cut `I then ran`, `Let me now`, `After investigating`,
  and other play-by-play of the agent's steps. State the result and the
  evidence.
- **Puffery.** Cut `crucial`, `delve`, `pivotal`, `showcase`, `testament`,
  `underscore`, `vibrant`, `groundbreaking`, and abstract `landscape` /
  `tapestry` when they add no fact.
- **Contrast crutches.** Rewrite `not just X, but Y` and `not X, it's Y` as the
  actual point.
- **Vague attributions.** Name the source, or delete `experts believe` /
  `industry reports suggest`.

Typed-code anti-slop (chained assertions, known-value widening, `any` casts)
stays in `references/type-evidence-review.md`. Extra comments, defensive
try/catch on trusted paths, and similar code cleanup stay on the explicit
`references/simplify-pr.md` workflow. Do not import a second lint stack or a
standalone humanizer skill to do this job.

## Evidence-preservation rule

Never rewrite exact evidence for style. Preserve these verbatim when present:

- commands, flags, paths, symbols, SHAs, check names, branch names, labels, and
  GitHub `@mentions`;
- required publication markers, headings, closing keywords, and idempotency
  identities;
- quoted user text or exact wording the user already confirmed;
- security redactions and policy-required terms.

Do not turn an uncertain result into a confident sentence while editing prose.
`unknown`, `not run`, `not reproduced`, `blocked`, and other evidence states
keep their exact meaning.

## Artifact-specific guidance

### PR descriptions and review comments

Lead with the result, then the evidence that supports it. Do not narrate the
agent's process or repeat the same fact in several forms. A reviewer should be
able to identify the change, risk, validation, and next action on the first
read.

### Issues and PRDs

Use the project's vocabulary and separate requirements from explanation. Keep
acceptance criteria executable or observable. Do not hide an unresolved product
decision inside polished prose.

### Documentation

Pick one dominant mode before writing:

- tutorial: learning by doing;
- how-to: steps to a specific goal;
- reference: facts for lookup;
- explanation: bounded context and rationale.

Split mixed modes instead of making one page teach, specify, persuade, and
troubleshoot at the same time.

## Final self-audit

Before publication, ask:

1. Does every material claim point to concrete evidence or an explicit decision?
2. Can any sentence lose words without losing meaning?
3. Did style editing alter an exact command, state, template field, or policy term?
4. Does any sentence sound reusable in an unrelated repository because it says
   nothing specific about this work?
5. Did the rewrite make uncertainty look more certain than the evidence allows?
6. Did any publication tell remain (chatbot phrase, process narration, puffery,
   or `not just X, but Y`)?

Fix the prose only when the answer improves readability without weakening the
underlying contract.

## Provenance

This reference adapts ideas from Cursor's `pstack` `unslop` and
`technical-writing` skills. `pstack` is MIT licensed, copyright 2026 Lauren Tan.
The publication-tell list reuses concrete phrase classes from that lineage.
It does not import humanizer skills, authenticity scoring, first-person "soul,"
or an em-dash ban. The rules here are rewritten for `github-delivery`'s
evidence-first GitHub publication model rather than copied as a standalone
Cursor skill.
