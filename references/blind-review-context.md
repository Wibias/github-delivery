# Blind review context

Use this contract for the first discovery pass of merge-ready, full-review, and security-review work.

## Goal

Prevent PR framing, prior reviewer conclusions, and reputation signals from biasing the first bug/security discovery pass. Blind discovery is an evidence partition, not a claim that contextual information is unimportant. Context is added immediately afterward for reconciliation.

## Phase A: blind discovery

Build the first-pass packet with `scripts/review-context.mjs` or the equivalent host integration using `scripts/lib/review-context.mjs`.

The blind packet is **allowlist-based**. It may include:

- repository / PR identity and immutable base/head identity;
- diff and changed-file inventory;
- adjacent source required to reason about the changed code;
- relevant tests;
- repository policies that govern the code;
- static-analysis evidence;
- review scope / required probes.

It withholds framing and prior conclusions, including:

- PR title and body;
- author identity or reputation;
- labels;
- issue and spec framing;
- commit-message framing;
- human review comments;
- reviewer verdicts;
- bot conclusions.

Unknown top-level fields are withheld by default rather than silently leaking into the blind packet.

The blind packet is bound to `headSha`. If the head changes, discard it and rebuild it.

## Phase B: context reconciliation

After independent discovery has produced candidate findings, expose the complete contextual packet. Reconcile candidates against:

- issue / spec intent;
- PR description and claimed behavior;
- commit history;
- human and bot feedback;
- repository history needed to prove compatibility or intent.

Context may dismiss or reprioritize a candidate only with evidence. It must not erase a discovery lead merely because the PR description, author, bot, or prior reviewer says the change is safe.

## Required review ordering

For workflows that adopt this contract:

1. Build blind packet for the exact head.
2. Perform independent bug/security discovery from that packet.
3. Persist candidate claims and evidence before contextual framing is added.
4. Build reconciliation packet for the same head.
5. Challenge candidates using intent/history/framework evidence.
6. Send disputed or high-impact candidates to independent validation/arbitration.
7. If the head moves, invalidate both packets and any evidence that cannot be proven head-independent.

## CLI

```bash
node scripts/review-context.mjs review-input.json --phase blind-discovery
node scripts/review-context.mjs review-input.json --phase context-reconciliation
```

The CLI emits a deterministic fingerprint so hosts can record exactly which context partition was used for a review phase.

## Non-goals

- This does not hide repository security policy or code required for reasoning.
- This does not weaken semantic-propagation, Spec/Standards, CI, or ship gates.
- This does not make contextual review optional.
- This does not treat a blind first-pass finding as confirmed without validation.
