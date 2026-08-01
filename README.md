# shipping-github

A GitHub shipping skill for agents. You speak naturally; the agent loads the skill, selects the workflow, runs the evidence and policy scripts internally, and performs only the GitHub writes authorized by that request.

```text
merge PR #32
what is left on PR #41?
fix the review comments on PR #18 and make it merge ready
watch PR #77 until it merges or needs me
research issue #90 on the latest development branch
```

You do **not** need to invoke Node scripts yourself. They are the skill’s internal safety and evidence machinery.

## How natural-language routing works

1. The agent host discovers `SKILL.md` from its frontmatter.
2. The request is routed to one focused workflow under `references/`.
3. The workflow runs runtime capability discovery and the authoritative ship gate.
4. Read-only helpers explain blockers when needed.
5. Every visible GitHub write passes through the mutation broker.
6. The agent verifies the resulting repository state and reports it.

Example:

```text
merge PR #32
```

routes to `references/merge-pr.md`, runs `scripts/ship-gate.mjs`, prepares guarded mutation requests, posts the pre-merge explanation, performs a head-pinned merge, handles linked issue comments and closure, and verifies cleanup.

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
- Live lifecycle fixtures exercise GitHub issues, branches, PRs, checks, snapshots, stale-head rejection, and cleanup against the real platform.

## Internal architecture

| Surface | Role |
|---|---|
| `SKILL.md` | Host discovery, natural-language routing, hard policy |
| `references/*.md` | Focused workflows and review standards |
| `scripts/ship-gate-snapshot.mjs` | Capture one paginated evidence snapshot |
| `scripts/ship-gate.mjs` | Produce one authoritative ship decision |
| `scripts/github-mutate.mjs` | Dry-run and execute authorized GitHub writes |
| `scripts/runtime-capabilities.mjs` | Discover host/tool capabilities and safe fallbacks |
| `scripts/validate-evals.mjs` | Execute offline routing and safety contracts |
| `scripts/live-github-fixture.mjs` | Exercise the real GitHub lifecycle with namespaced temporary resources |
| `scripts/review-scope.mjs` | Produce one evidence-ranked bug and security review plan |
| `scripts/build-dist.mjs` | Build deterministic versioned skill bundles |
| `scripts/prepare-release.mjs` | Verify release identity, checksums, SBOM, notes, and provenance subjects |

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

| Request | Workflow |
|---|---|
| Fix comments and make merge-ready | `references/fix-pr-bots.md` |
| Watch or babysit a PR | `references/watch-pr.md` |
| Re-review after commits or reviews | `references/re-review-pr.md` |
| Research an issue on development tip | `references/research-issue.md` |
| Create a linked PR for an issue | `references/create-pr-for-issue.md` |
| Full bug, security, and standards review | `references/full-review-pr.md` |
| Security review | `references/security-review.md` |
| Status or merge-readiness | `references/status.md` |
| Merge with linked-issue close-out | `references/merge-pr.md` |

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

CI runs the complete suite on Node 20 and 22 across Ubuntu, Windows, and macOS. CodeQL, dependency review, workflow-policy validation, deterministic distribution checks, offline behavioral evaluations, and focused unit contracts are part of the repository controls.

Use the **Live Integration** workflow to exercise the real lifecycle. Scheduled execution is opt-in through `LIVE_FIXTURE_ENABLED=true`.

## Current status

The planned implementation roadmap is complete: evidence snapshots, authoritative ship decisions, base-health isolation, feedback resolution, guarded mutations, capability discovery, behavioral evaluations, deterministic packaging, provenance-backed releases, repository security controls, live GitHub integration fixtures, and evidence-based review scoping are implemented.

Remaining work is operational rather than architectural: apply the documented live repository rules, enable available GitHub security features, run release acceptance, and maintain the regression corpus as GitHub and agent hosts evolve.

MIT licensed.
