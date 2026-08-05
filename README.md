# github-delivery

A GitHub shipping skill for agents. You speak naturally; the agent loads the skill, selects the workflow, runs the evidence and policy scripts internally, and performs only the GitHub writes authorized by that request.

```text
create a PRD for the onboarding flow
break the roadmap into implementation issues
triage the open issues in this repo
run QA intake on the payment bug report
plan a refactor of the storage layer
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
- Base updates (push to latest dev) and simplification edits happen only on PRs authored by the authenticated user; foreign PRs receive the owner instructions in the verdict/status instead.
- PR mutations re-check the expected head immediately before execution.
- Merge operations are pinned with `--match-head-commit`.
- Social writes require idempotency keys and produce versioned receipts.
- Stacked PR topology is discovered from GitHub PR bases and managed inside the skill through `references/stacked-prs.md`; stacks restack bottom-up and merge bottom-up with revalidation after every parent lands. Restack work enables `rerere` (conflict memory), resolves the push remote via `remote.pushDefault` (never hardcodes `origin`), and gates review/readiness/merge on a parent-ancestor `needsRebase` preflight; changes are edited only on the layer that owns the path, and a merge-queue base may enqueue the contiguous lower stack all-or-nothing.
- Issue lifecycle workflows cover PRDs, issue breakdown, triage, QA intake, refactor plans, `ready-for-agent` briefs, and persistent out-of-scope records.
- Merge-ready and full-review claims require an adaptive visible-polling settle on unchanged heads: 60 seconds by default, 180 seconds after a push, rebase, restack, force-with-lease, or review/thread change, with the authoritative gate re-polled every 20 seconds.
- Waiting on required CI or a rerun is **polling, never a single long blocking sleep**: re-check the run every ~1 minute and act the moment it finishes, fails, or restarts; a blocking `sleep`/`Start-Sleep` longer than 30 seconds is forbidden.
- Active Git conflicts while updating or shipping a PR are resolved through `references/resolve-conflicts.md` from the intent and evidence of both sides, never from markers alone.
- Review depth is derived from changed paths, patches, symbols, removed controls, dependencies, workflow permissions, and uncertainty rather than filenames alone.
- Full-review execution plans end with a mandatory `Publish final verdict` item and cannot terminate while that item or any required prerequisite remains `pending` or `in_progress`.
- Optional reviewers such as Cursor Bugbot cannot suppress the final verdict; unavailable reviewer evidence is recorded and the complementary review continues.
- The bug axis runs a built-in adversarial **Finder → Challenger → Arbiter** trio (`references/bug-hunt-method.md`) with static-analysis leads (typecheck/lint/Semgrep/CodeQL when installed plus tool-free complexity/churn/marker heuristics), finding-card evidence, a Gate 0 impact bar, and honest coverage buckets (`confirmed` / `dismissed` / `manual-review` / `unreviewed`) — partial coverage is reported, never disguised as clean.
- Security review applies Gate 0 before any Confirmed finding and checks A→B→C escalation chains before assigning severity.
- OAuth / token / key provider reviews enforce **HTTPS-only destinations for credential-bearing adapters**: a shared `http(s)` baseUrl validator is not enough when an adapter attaches OAuth/API-key `Authorization` headers to a configured `http://` URL (CWE-319) — the validator and every sibling adapter building requests from `provider.baseUrl` are checked.
- Bot full-review signals are acted on immediately: when a bot (e.g. `@coderabbit review`) announces a **full review** instead of an incremental one, the own bug + security + spec re-review on the current head runs first instead of settling on `[GD] Fixed` replies for a stale head.
- Every retained regression assertion is **bound to a probe anchor** in the skill docs: `validate-evals.mjs` requires each `regression-cases.jsonl` assertion id to have a matching `<!-- assertion: … -->` marker inside one of the case's expected resources. Deleting or renaming a Must-probe rule in `references/` now fails the offline evals (assertion drift is a CI break, not a silent gap).
- Probe routing is **deterministic and CI-verified**: each bug class is a named probe (`<!-- probe: … -->` in `bug-review.md` / `security-review.md`) whose trigger regexes live in `scripts/lib/probe-registry.mjs`; `planReviewScope` emits `requiredProbes` from the diff shape, and `tests/evals/scope-cases.jsonl` pins the exact probe set each CodeRabbit/Codex diff-shape class must route to. A trigger that stops firing, a probe whose tag is dropped, or a regression assertion moved off its probe's doc all fail the offline evals.
- Review axes must emit **machine-checkable probe-application evidence**: before the bug or security axis is complete, the agent records `{ probeId, status, files?, reason? }` for every `requiredProbes[]` id and `scripts/verify-probe-coverage.mjs` must exit `0`. `clean`/`findings`/`n-a` statuses are enforced (n-a requires a concrete reason; findings requires reviewed files that are probe trigger files), so "we ran the probes" is verifiable, not asserted.
- Creating a PR runs a **pre-open bug + security gate** (`scripts/pre-open-gate.mjs`) against the local branch diff: the PR is not opened until required bug lenses and security surfaces are reviewed and Confirmed High/Critical findings are fixed, and never opened from an incomplete diff.

- Full review traces every changed domain concept from its authoritative source through all producers, consumers, public or derived representations, materially distinct variants, and positive and negative tests.
- Family-wide behavior cannot be approved from one representative test unless equivalence is proved; canonical and derived representations must be reconciled for every material behavior partition.
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
| `scripts/inspect-stack.mjs`        | Discover the PR stack graph and report the safe restack/merge order      |
| `scripts/validate-evals.mjs`       | Execute offline routing + safety contracts; verify regression-assertion → probe-anchor binding and diff-shape → probe routing |
| `scripts/verify-probe-coverage.mjs` | Verify the review emitted accepted probe-application evidence for every required probe |
| `scripts/live-github-fixture.mjs`  | Exercise the real GitHub lifecycle with namespaced temporary resources   |
| `scripts/review-scope.mjs`         | Produce one evidence-ranked bug and security review plan                 |
| `scripts/pre-open-gate.mjs`        | Gate PR creation on bug + security scope for the unopened branch diff    |
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
| Create a PRD from conversation or repository context                      | `references/issue-workflows.md` → PRD Workflow               |
| Break a PRD, plan, spec, or issue into implementation issues              | `references/issue-workflows.md` → Issue Breakdown            |
| Triage issue(s), labels, state, readiness, or rejection                   | `references/issue-workflows.md` → Triage Workflow            |
| Run QA intake or file reproducible bug reports                            | `references/issue-workflows.md` → QA Intake                  |
| Create a refactor request, RFC, or tiny-commit plan                       | `references/issue-workflows.md` → Refactor Plan              |
| Write or update a `ready-for-agent` issue contract                        | `references/agent-brief.md`                                  |
| Record, match, or remove a rejected enhancement decision                  | `references/out-of-scope.md`                                 |
| Fix comments and make merge-ready                                         | `references/fix-pr-bots.md`                                  |
| Watch or babysit a PR                                                     | `references/watch-pr.md`                                     |
| Re-review after commits or reviews                                        | `references/re-review-pr.md`                                 |
| Research an issue on development tip                                      | `references/research-issue.md`                               |
| Create a linked PR for an issue (pre-open bug/security gate first)        | `references/create-pr-for-issue.md`                          |
| Full bug, security, and standards review                                  | `references/full-review-pr.md`                               |
| Bug review on a PR or branch (deep adversarial method)                    | `references/bug-review.md` + `references/bug-hunt-method.md` |
| Credential-transport / OAuth-provider bug review                          | `references/bug-review.md` → probe: credential transport     |
| Spec and Standards review on a PR                                         | `references/spec-standards-review.md`                        |
| Simplify, clean up, or deduplicate a PR without behavior changes          | `references/simplify-pr.md`                                  |
| Full review plus optional approved simplification and mandatory re-review | `references/full-review-pr.md` + `references/simplify-pr.md` |
| Security review                                                           | `references/security-review.md`                              |
| Status or merge-readiness                                                 | `references/status.md`                                       |
| Merge with linked-issue close-out                                         | `references/merge-pr.md`                                     |
| Resolve an active Git conflict while updating or shipping a PR            | `references/resolve-conflicts.md`, then resume the workflow  |
| Inspect, restack, retarget, recover, or merge stacked PRs                 | `references/stacked-prs.md`                                  |

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
~/.agents/skills/github-delivery
~/.cursor/skills/github-delivery
~/.codex/skills/github-delivery
~/.claude/skills/github-delivery
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

The planned implementation roadmap is complete: evidence snapshots, authoritative ship decisions, base-health isolation, feedback resolution, guarded mutations, capability discovery, behavioral evaluations, deterministic packaging, provenance-backed releases, repository security controls, private vulnerability reporting, live GitHub integration fixtures, evidence-based review scoping, the issue lifecycle (PRDs, breakdowns, triage, QA intake, refactor plans, agent briefs, out-of-scope records), internal stacked-PR lifecycle with bottom-up merging and gh-stack-derived operational practices (rerere conflict memory, remote.pushDefault resolution, parent-ancestor needsRebase preflight, layer-ownership editing, merge-queue all-or-nothing lower-stack merge), conflict resolution, adaptive settle verification, spec and standards review, explicit behavior-preserving simplification with mandatory post-change full review, a pre-open bug + security gate for PR creation, HTTPS-only credential-transport enforcement for OAuth/key provider reviews, immediate own-review reaction to bot full-review signals, regression-assertion → probe-anchor binding, deterministic diff-shape → probe routing with scope-case fixtures, and machine-checkable probe-application evidence gated by `verify-probe-coverage.mjs` are implemented.

Remaining work is operational rather than architectural: maintain the documented live repository rules, keep available GitHub security features enabled, run release acceptance for new versions, and extend the regression corpus as GitHub and agent hosts evolve.

MIT licensed.
