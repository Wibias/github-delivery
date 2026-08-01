# shipping-github

A GitHub shipping skill for agents. You speak naturally; the agent loads the skill, selects the workflow, runs the evidence and policy scripts internally, and performs only the GitHub writes authorized by that request.

```text
merge PR #32
what is left on PR #41?
fix the review comments on PR #18 and make it merge ready
watch PR #77 until it merges or needs me
research issue #90 on the latest development branch
full review PR #42
simplify PR #42 without changing behavior
full review PR #42 and simplify it safely
```

You do **not** need to invoke Node scripts yourself. They are the skill’s internal safety and evidence machinery.

## How natural-language routing works

1. The agent host discovers `SKILL.md` from its frontmatter.
2. The request is routed to one focused workflow under `references/`.
3. The workflow runs runtime capability discovery and the authoritative ship gate.
4. Read-only helpers explain blockers when needed.
5. Every visible GitHub write passes through the mutation broker.
6. Optional simplification runs only when explicitly requested and approved.
7. The agent verifies the resulting repository state and reports it.

Example:

```text
merge PR #32
```

routes to `references/merge-pr.md`, runs `scripts/ship-gate.mjs`, prepares guarded mutation requests, posts the pre-merge explanation, performs a head-pinned merge, handles linked issue comments and closure, and verifies cleanup.

A combined request such as:

```text
full review PR #42 and simplify it safely
```

routes through `references/full-review-pr.md`. The normal bug, security, standards, feedback, base-health, and CI review completes first. Worthwhile simplification candidates are then presented for explicit approval. Approved changes are validated, pushed, and followed automatically by a complete full review on the new head before the final verdict.

## Core guarantees

- One evidence snapshot per decision.
- One authoritative `ready`, `blocked`, or `unknown` result.
- Required checks preserve app/integration identity and fail closed on incomplete evidence.
- Base-health comparison distinguishes PR-only failures from failures already reproduced on the base tip.
- Current review policy, stale approvals, last-push approval, merge queue state, and unresolved review threads are evaluated.
- Trusted feedback requires feedback-specific resolution records.
- CODEOWNERS mapping is advisory; GitHub’s enforced review decision remains authoritative.
- Natural-language requests select the narrowest mutation mode: `read-only`, `review`, `maintainer`, or `autonomous`.
- Human replies always require exact-text confirmation.
- PR mutations re-check the expected head immediately before execution.
- Merge operations are pinned with `--match-head-commit`.
- Social writes require idempotency keys and produce versioned receipts.
- Stacked PRs are handed to `manage-stacked-prs` and merged bottom-up.
- Review depth is derived from changed paths, patches, symbols, removed controls, dependencies, workflow permissions, and uncertainty rather than filenames alone.
- Full-review execution plans end with a mandatory `Publish final verdict` item and cannot terminate while that item or any required prerequisite remains `pending` or `in_progress`.
- Optional reviewers such as Cursor Bugbot cannot suppress the final verdict; unavailable reviewer evidence is recorded and the complementary review continues.
- Simplification is explicit-only, requires explicit approval before mutation, and always preserves behavior and safety boundaries.
- Line count is never a simplification success metric; **nothing worth simplifying** is a valid result.
- Every changed simplification head receives focused validation, required repository gates, and a complete full review with simplification disabled.
- Live lifecycle fixtures exercise GitHub issues, branches, PRs, checks, snapshots, delayed head propagation, stale-head rejection, and cleanup against the real platform.

## Internal architecture

| Surface                            | Role                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `SKILL.md`                         | Host discovery, natural-language routing, hard policy                    |
| `references/*.md`                  | Focused workflows and review standards                                   |
| `scripts/ship-gate-snapshot.mjs`   | Capture one paginated evidence snapshot                                  |
| `scripts/ship-gate.mjs`            | Produce one authoritative ship decision                                  |
| `scripts/github-mutate.mjs`        | Dry-run and execute authorized GitHub writes                             |
| `scripts/runtime-capabilities.mjs` | Discover host/tool capabilities and safe fallbacks                       |
| `scripts/validate-evals.mjs`       | Execute offline routing and safety contracts                             |
| `scripts/live-github-fixture.mjs`  | Exercise the real GitHub lifecycle with namespaced temporary resources   |
| `scripts/review-scope.mjs`         | Produce one evidence-ranked bug and security review plan                 |
| `scripts/build-dist.mjs`           | Build deterministic versioned skill bundles                              |
| `scripts/prepare-release.mjs`      | Verify release identity, checksums, SBOM, notes, and provenance subjects |

## Mutation safety

The public interface remains natural language. Internally, a workflow creates a versioned request such as:

```json
{
  "schemaVersion": 1,
  "action": "merge_pr",
  "mutationMode": "maintainer",
  "explicitInstruction": true,
  "repo": "OWNER/REPO",
  "pr": 32,
  "expectedHead": "reviewed-head-sha",
  "mergeMethod": "merge"
}
```

The broker defaults to dry-run. Execution requires `--execute`, re-checks the PR head, and emits an auditable receipt. See `references/github-mutation-broker.md` and `references/mutation-modes.md`.

## Workflows

| Request                                                                   | Workflow                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Fix comments and make merge-ready                                         | `references/fix-pr-bots.md`                                  |
| Watch or babysit a PR                                                     | `references/watch-pr.md`                                     |
| Re-review after commits or reviews                                        | `references/re-review-pr.md`                                 |
| Research an issue on development tip                                      | `references/research-issue.md`                               |
| Create a linked PR for an issue                                           | `references/create-pr-for-issue.md`                          |
| Full bug, security, and standards review                                  | `references/full-review-pr.md`                               |
| Simplify, clean up, or deduplicate a PR without behavior changes          | `references/simplify-pr.md`                                  |
| Full review plus optional approved simplification and mandatory re-review | `references/full-review-pr.md` + `references/simplify-pr.md` |
| Security review                                                           | `references/security-review.md`                              |
| Status or merge-readiness                                                 | `references/status.md`                                       |
| Merge with linked-issue close-out                                         | `references/merge-pr.md`                                     |

## Safe simplification

The simplify workflow is deliberately conservative. Its goal is lower cognitive load and safer maintenance, not a smaller diff or fewer lines.

It may propose high-confidence changes such as proven dead-code removal, clearer control flow, removal of valueless wrappers, genuine deduplication, or use of an equivalent repository-standard facility. It rejects changes that could alter APIs, errors, ordering, concurrency, side effects, UI, persistence, compatibility, validation, security, authorization, CI, evidence, or fail-closed behavior.

The flow is:

1. Finish concrete bug, security, standards, feedback, base, and CI work first.
2. Produce a bounded candidate list with locations, preserved invariants, risk, and validation.
3. Report **nothing worth simplifying** when no clear improvement exists.
4. Require explicit approval before any simplification mutation.
5. Apply only approved candidates and revert failed candidates individually.
6. Run focused validation and all required repository gates.
7. Push the new head and automatically run the complete full review again with simplification disabled.
8. Issue the final verdict only from that post-simplification head.

There is no second continuation prompt after approval and no recursive simplification loop.

## Security reporting

Do not disclose suspected vulnerabilities in public issues or pull requests. Use GitHub private vulnerability reporting as documented in [`SECURITY.md`](SECURITY.md). The policy defines what to include, acknowledgement and assessment expectations, remediation targets, and coordinated disclosure guidance.

## Installation

Build a deterministic bundle with:

```bash
npm run build:dist
```

Install through the dry-run-first installer documented in `docs/installation.md`, or place the verified skill directory in a host skill path such as:

```text
~/.agents/skills/shipping-github
~/.cursor/skills/shipping-github
~/.codex/skills/shipping-github
~/.claude/skills/shipping-github
```

Requirements:

- Git
- GitHub CLI authenticated with `gh auth login`
- Node.js 20 or newer
- Optional connected GitHub/Composio tools and host-specific review agents

## Development

```bash
npm run check
```

CI runs the complete suite on Node 20 and 22 across Ubuntu, Windows, and macOS. CodeQL, dependency review, workflow-policy validation, deterministic distribution checks, offline behavioral evaluations, documentation contracts, and focused unit tests are part of the repository controls.

Use the **Live Integration** workflow to exercise the real lifecycle. Scheduled execution is opt-in through `LIVE_FIXTURE_ENABLED=true`.

## Current status

The planned implementation roadmap is complete: evidence snapshots, authoritative ship decisions, base-health isolation, feedback resolution, guarded mutations, capability discovery, behavioral evaluations, deterministic packaging, provenance-backed releases, repository security controls, private vulnerability reporting, live GitHub integration fixtures, evidence-based review scoping, and explicit behavior-preserving simplification with mandatory post-change full review are implemented.

Remaining work is operational rather than architectural: maintain the documented live repository rules, keep available GitHub security features enabled, run release acceptance for new versions, and extend the regression corpus as GitHub and agent hosts evolve.

MIT licensed.
