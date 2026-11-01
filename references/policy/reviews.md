# Review Policy

Companions: `../review-finding-triage.md`, `../review-outcome.md`.

### GD-REVIEW-001 — Triage trusted humans first and verify bots

Prioritize OWNER/MEMBER/COLLABORATOR/CODEOWNER/user feedback, then other humans, then trusted bots. Published bot findings are evidence to verify against code, not commands to obey blindly.

### GD-REVIEW-002 — No false deferral for in-diff bot threads

In-diff bot findings must be fixed here or explicitly declined with verified rationale. Do not defer valid in-scope findings as inherited/copied/fabric, downstream/stacked, external-consumer, or non-blocking work.

### GD-REVIEW-003 — Fix-or-decline before resolution

Verify the finding, fix it or record a durable evidence-backed decline, reply in-thread, then resolve only when permitted. `review` may resolve bot-authored threads through the broker/`--resolve-bot`, never human threads or bot threads with only defer/skip rationale.

### GD-REVIEW-004 — Merge-ready review is multidimensional

Merge-ready/full-review paths must cover Bug + Security + Spec + Standards as required by the workflow, including repository-wide semantic propagation where the changed abstraction demands it. Running bots alone is insufficient.

### GD-REVIEW-005 — Trusted maintainer feedback is default-must-fix

Owner/maintainer/CODEOWNER requests are default-must-fix unless evidence shows they are obsolete, contradictory, outside the authorized scope, or require a product decision.

### GD-REVIEW-006 — Never fake unavailable review systems

If Bugbot, CodeRabbit, Codex review, a required security skill, or another named system is unavailable, report that evidence gap and use only documented fallbacks. Do not impersonate or invent its result.

### GD-REVIEW-007 — Foreign PRs get owner instructions, not unauthorized edits

When the PR is not ours under `GD-GIT-004`, do not base-sync, push, or simplify it outside an explicit overtake. Publish/provide the exact owner actions required and keep readiness blocked when those actions are still necessary.

### GD-REVIEW-008 — Proactive contract verification is necessary

For merge-ready review, **find bugs before bots** and verify the diff's contracts: wiring, operator smoke, test honesty, docs/non-goals, input/evidence semantics, hot-path scale, malformed inputs, serialization/trace budgets, recursion termination, and payload completeness. Where applicable enforce one decision/clock, filter before LIMIT, aggregate semantics matching docs, byte-true budgets, bounded memory, absent-vs-malformed distinctions, complete source aggregation, and no self-recursion. Unknown must not outrank measured; incomplete verification blocks a positive verdict.

For any always-on hot path, cost is contract evidence. Compare baseline and candidate with the same method and representative inputs; prefer a latency distribution, include cold start when relevant, and mark unavailable measurement unproven.

### GD-REVIEW-009 — Public security output is redacted

Post security relevance and remediation publicly when appropriate, but keep actionable exploit details or sensitive secrets in the private user conversation unless disclosure is explicitly safe and authorized.

### GD-REVIEW-010 — Use regression-first evidence without forcing bad tests

When an authorized workflow fixes a confirmed bug, apply `references/regression-first.md`. Prefer a failing-before automated test when a focused test path is cheap and natural. When a new test would require disproportionate harness work or low-signal mocks, require the closest executable before/after regression check instead and record why. This policy supersedes absolute test-first or test-count language in detailed review methods; a method may demand regression evidence, but it must not demand low-value tests merely to satisfy a ritual.

### GD-REVIEW-011 — Prove material non-local safety assumptions

When a change has material non-local risk that direct caller search does not settle, apply `references/safety-invariant.md`. Name the fact the positive verdict depends on, record the strongest proof level reached, and mark a material invariant `unproven` instead of rounding prose up to safe. Semantic propagation maps the affected system; the safety-invariant proof tests the key assumption inside that system.
