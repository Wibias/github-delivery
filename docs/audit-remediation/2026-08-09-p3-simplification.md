# P3 contract centralisation and context efficiency

Audit baseline: `d5137472eafb660c18306d28484f6850aeab6ac4`

Stack base: P2 head `2cf77538debcc3f701a6044b21c949d27be2ee8a`

## Scope and order

1. Create one authoritative mutation-action registry for action identity and cross-cutting semantics.
2. Refactor policy, broker classification, authority scope, and high-assurance execution to derive from that registry instead of hand-maintained action lists.
3. Add semantic-propagation tests that fail whenever a new mutation action is not represented consistently across all required consumers.
4. Centralise reusable ref/check identity helpers where doing so removes semantic duplication without broad rewrites.
5. Reduce first-session review context by providing compact generated review-contract summaries while preserving mandatory bug, security, semantic-propagation, spec/standards, freshness, and final-verdict requirements.
6. Keep live recapture, rules/review/check freshness, trusted authority, and mutation verification unchanged; no safety gate may be removed for token savings.

## Acceptance

- [ ] One registry enumerates all mutation actions and their cross-cutting categories.
- [ ] Mutation modes/policy, broker PR/social/idempotent/thread/cleanup classifications, authority scope, and high-assurance execution consume the registry or are mechanically checked against it.
- [ ] Adding a registry action without the required authority-scope semantics fails tests.
- [ ] Adding a brokered network write outside the registered action set fails tests.
- [ ] Duplicate ref/check identity helpers are centralised only where equivalence is proven.
- [ ] A compact review contract can be loaded instead of rereading multiple large reference files for stable rules.
- [ ] Compact review context preserves every mandatory review axis and completion/freshness gate.
- [ ] Documentation points agents to the compact contract first and large references only for triggered detail.
- [ ] No mutation authority, freshness, final recapture, CI, review, or GitHub-rules gate is weakened.
- [ ] Focused regression tests are RED before production refactors.
- [ ] Full Node 22/24 Linux/macOS/Windows validation, Dependency Review, and CodeQL pass.
