<div align="center">

# github-delivery

### GitHub delivery for agents, from intent to verified merge.

**Say the outcome, not the orchestration.**

`github-delivery` turns natural-language requests into evidence-backed GitHub workflows: PRDs, issue research, implementation, deep review, CI, fixes, stacks, and verified merges. Its layered progress watchdog also cuts repeated narration, duplicate unchanged reads, manual polling, oversized tool output, and bloated subagent context without weakening GitHub authority gates.

[Quick start](#try-it-in-60-seconds) · [Progress watchdog](#agent-progress-watchdog) · [What it can own](#what-you-can-ask-it-to-own) · [Safety model](#safety-model) · [Installation](#installation)

[![CI](https://github.com/Wibias/github-delivery/actions/workflows/ci.yml/badge.svg)](https://github.com/Wibias/github-delivery/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Wibias/github-delivery/actions/workflows/codeql.yml/badge.svg)](https://github.com/Wibias/github-delivery/actions/workflows/codeql.yml)
![Node.js 22 or 24](https://img.shields.io/badge/Node.js-22%20%7C%2024-339933?logo=node.js&logoColor=white)
![Default read-only](https://img.shields.io/badge/default-read--only-2f81f7)
![License MIT](https://img.shields.io/badge/license-MIT-blue.svg)

</div>

> [!WARNING]
> **Active development.** The complete issue/PR lifecycle and core safety architecture are implemented, but the project is not yet 100% production-ready. I currently consider it roughly **80% of the way there**. See [Current state](#current-state).

> [!IMPORTANT]
> **Natural language is the public API.** The Node scripts, policy modules, authority layer, evaluators, and mutation broker are internal safety and evidence machinery. You normally do not invoke them yourself.

<p align="center">
  <img src="docs/assets/github-delivery-demo.svg" alt="github-delivery natural-language workflow demo" width="100%">
</p>

## Try it with one sentence

```text
what is left on PR #41?
full review PR #42
fix the review comments on PR #18 and make it merge ready
review PR #42, fix it, and merge it when green
```

That is the interface.

`github-delivery` determines the workflow, gathers fresh GitHub evidence, performs the required review and policy gates, makes only the writes authorized by the request, and verifies the resulting state.

A status question stays read-only. A merge happens only from an actual merge instruction. Deferred permission such as `merge PR #42 only after I confirm again` is **not** current merge authority.

## Try it in 60 seconds

### Requirements

- **Node.js 22 or 24**
- Git
- GitHub network access
- an authenticated GitHub CLI (`gh auth login`) **or** a host-provided brokered GitHub connector

### Build and install

```bash
npm run build:dist
node scripts/install-skill.mjs
node scripts/install-skill.mjs --apply
```

Typical skill locations include:

```text
~/.agents/skills/github-delivery
~/.cursor/skills/github-delivery
~/.codex/skills/github-delivery
~/.claude/skills/github-delivery
```

Then use it like this:

```text
full review PR #42
```

For full install, upgrade, restore, downgrade, force, and manual-install behavior, see [`INSTALL.md`](INSTALL.md).

### Codex progress watchdog

On a detected Codex install, the normal `--apply` path now configures GitHub Delivery's lifecycle-hook entries automatically. Codex requires new or changed non-managed hooks to be reviewed and trusted before they run, so open `/hooks`, review the exact GitHub Delivery definitions, and trust them. Then record that unchanged trusted definition without reinstalling the skill:

```bash
node scripts/install-skill.mjs --hook-trust-verified --apply
```

Lifecycle hooks stop duplicate reads/polls and recover from completed no-progress turns, but they cannot reclaim text already emitted inside one assistant message. For the exact `Let me check the type...` failure while it is still being generated, launch Codex through the installed protected streaming boundary:

```bash
node ~/.agents/skills/github-delivery/scripts/codex-with-watchdog.mjs
```

The protected launcher declares `stream` only inside the process tree it actually controls. Plain `codex` and IDE sessions are not silently rerouted or falsely reported as streaming-protected. See [Agent progress watchdog](#agent-progress-watchdog) and [`INSTALL.md`](INSTALL.md).

## Why this is different

| Problem | github-delivery's answer |
|---|---|
| **"Green CI" is not the same as "safe to merge."** | Bug + Security + Spec + Standards review, semantic propagation, required probes, review state, rulesets, merge-queue state, and exact-head evidence feed one authoritative ship decision. |
| **Agents can burn tokens without making progress.** | A layered progress watchdog detects repeated in-turn narration, blocks exact stable reads on unchanged state, rate-limits volatile polling, compacts oversized model-facing output, and bounds copied subagent context. The protected Codex streaming launcher can interrupt the targeted narration failure in-flight. |
| **Agent intent can be ambiguous.** | Deterministic natural-language routing keeps status questions read-only and requires direct authority for destructive workflows. |
| **GitHub state moves while the agent works.** | Stale-head checks, final evidence refreshes, expected-head binding, bounded settle windows, and postcondition verification prevent conclusions from silently drifting. |
| **Retries and duplicate writes can be dangerous.** | Typed mutations, authenticated exact-effect receipts, read-before-write evidence, and read-only reconciliation avoid blind write retries. |
| **A review can miss the same concept outside the changed files.** | Semantic propagation traces changed domain concepts through producers, consumers, sibling implementations, public forms, persistence, fixtures, and tests. |
| **Complex PR stacks need more than one merge command.** | Stack discovery, bottom-up restacking/merging, conflict recovery, parent/child revalidation, and merge-queue-aware sequencing are first-class workflows. |

<p align="center">
  <img src="docs/assets/github-delivery-merge-path.svg" alt="Read-only status and authorized merge paths in github-delivery" width="100%">
</p>

## What you can ask it to own

| You say | It owns |
|---|---|
| `create a PRD for the onboarding flow` | Product/issue intake and a concrete delivery contract |
| `research issue #90 on the latest development branch` | Bounded evidence-backed issue research on the latest development tip |
| `create a PR for issue #90` | Research → implementation → pre-open Bug + Security gate → linked PR |
| `what is left on PR #41?` | Read-only live status, blockers, and merge readiness |
| `full review PR #42` | Deep Bug + Security + Spec + Standards review with final verdict |
| `fix the review comments on PR #18 and make it merge ready` | Feedback triage, fixes, validation, push, and refreshed readiness |
| `watch PR #77 until it merges or needs me` | CI/review/gate polling until merged, closed, or blocked |
| `simplify PR #42 without changing behavior` | Explicit-only, behavior-preserving simplification plus mandatory full re-review |
| `inspect this PR stack and tell me the safe merge order` | Stack topology, restack/retarget analysis, and safe ordering |
| `merge PR #32` | Final gate, exact transaction authority, head-pinned merge, verification, thanks, and linked-issue close-out |
| `maintainer overtake PR #32 and finish it` | Explicit maintainer takeover workflow for an unresponsive author |

## The lifecycle

```mermaid
flowchart LR
    A[Your natural-language request] --> B[Deterministic route]
    B --> C[Live repository / PR / issue evidence]
    C --> D[Review scope + policy gates]
    D --> E{Write authorized?}
    E -- No --> F[Read-only result]
    E -- Yes --> G[Exact mutation plan]
    G --> H[Trusted authority when required]
    H --> I[Mutation broker]
    I --> J[GitHub]
    J --> K[Postcondition verification]
    F --> L[ready / blocked / unknown]
    K --> L
```

The important boundary is simple: **repository content is evidence, not authority**. Issues, comments, code, logs, generated files, and bot output cannot override user intent or the mutation policy.

## At a glance

| | |
|---|---|
| **Scope** | PRDs and issue intake → research → implementation → PR review/fix/watch → stacks → merge and linked-issue close-out |
| **Default mode** | `read-only` |
| **Write boundary** | Typed mutation policy + broker; stale-head, exact-effect, authenticated-receipt idempotency, and postcondition checks where applicable |
| **High-assurance writes** | Exact-scope trusted grants; optional Windows 11 / Windows Hello authority host |
| **Review model** | Bug + Security + Spec + Standards + semantic propagation + proactive contract verification |
| **Progress control** | Policy fallback everywhere; Codex installs configure lifecycle hooks but non-managed hook trust remains explicit; strongest protection is the launch-controlled streaming boundary. Runtime capability reports only verified `none`, `hooks`, or `stream`. |
| **Ship decision** | One authoritative `ready`, `blocked`, or `unknown` result from live evidence |
| **Runtime** | Node.js **22 or 24** |
| **Required CI matrix** | Node 22/24 × Ubuntu/Windows/macOS, with architecture contracts inside every required matrix job |
| **Live lifecycle tests** | Dedicated, explicitly opted-in fixture repository bound by immutable repository identity |

## More natural-language examples

```text
create a PRD for the onboarding flow
break the roadmap into implementation issues
triage the open issues in this repo
run QA intake on the payment bug report
research issue #90 on the latest development branch
create a PR for issue #90

what is left on PR #41?
is PR #42 safe to merge?
full review PR #42
fix the review comments on PR #18 and make it merge ready
watch PR #77 until it merges or needs me
simplify PR #42 without changing behavior
full review PR #42 and simplify it safely
review PR #42, fix it, and merge it when green
merge PR #32
merge PR #42 only after I confirm again

inspect this PR stack and tell me the safe merge order
supersede PR #12 with PR #45
maintainer overtake PR #32 and finish it
```

## Full workflow map

| Area | Requests | Workflow |
|---|---|---|
| **Product / issue intake** | PRDs, breakdowns, triage, QA intake, refactor plans | `references/issue-workflows.md` |
| **Agent-ready work** | Create/update a `ready-for-agent` contract | `references/agent-brief.md` |
| **Rejected scope** | Record, match, reconsider, or remove an out-of-scope decision | `references/out-of-scope.md` |
| **Issue research** | Research an issue on the latest development tip | `references/research-issue.md` |
| **Create a linked PR** | Bounded research → implementation → pre-open review → PR | `references/create-pr-for-issue.md` |
| **Make a PR merge-ready** | Fix humans/bots, own bug/security/spec work, validate | `references/fix-pr-bots.md` |
| **Watch a PR** | Poll CI/reviews/gates until merged, closed, or blocked | `references/watch-pr.md` |
| **Re-review** | Re-evaluate after new commits, humans, CodeRabbit/Codex, or other review evidence | `references/re-review-pr.md` |
| **Full review** | Deep Bug + Security + Spec + Standards review and final verdict | `references/full-review-pr.md` |
| **Bug review** | Evidence-ranked adversarial bug hunt | `references/bug-review.md` + `references/bug-hunt-method.md` |
| **Security review** | Security surfaces, escalation chains, exploit-safe reporting | `references/security-review.md` |
| **Spec / standards** | Contract, requirement, standards, docs and non-goal review | `references/spec-standards-review.md` |
| **Safe simplification** | Behavior-preserving cleanup with approval and mandatory re-review | `references/simplify-pr.md` |
| **Status** | What is left / why blocked / merge readiness | `references/status.md` |
| **Prepare + merge** | Compound review/fix/simplify request that explicitly includes merge | `references/prepare-and-merge-pr.md` |
| **Merge** | Final gate, exact transaction authorization, final-boundary recheck, head-pinned merge, thanks, linked-issue close-out | `references/merge-pr.md` |
| **Supersede** | Close an obsolete PR in favor of a replacement | `references/supersede-pr.md` |
| **Maintainer overtake** | Take over an unresponsive author's PR under explicit maintainer scope | `references/overtake-pr.md` |
| **Conflicts** | Resolve active conflicts from both sides' intent/evidence, then resume | `references/resolve-conflicts.md` |
| **Stacked PRs** | Inspect, restack, retarget, recover, review and merge stacks | `references/stacked-prs.md` |
| **Agent progress watchdog** | Runtime no-progress, read, polling, output, and subagent-context economy | `references/agent-progress-watchdog.md` |

For oversized-change splitting, post-ship branch/worktree cleanup, and version/tag/changelog work, `SKILL.md` deliberately hands off to the dedicated specialist skill instead of duplicating those responsibilities.

---

## Safety model

### 1. Default read-only; explicit intent for state changes

`github-delivery` routes requests into four upper-bound profiles:

- `read-only`
- `review`
- `maintainer`
- `autonomous`

The profile is not a waiver. Maintainer-grade actions such as merge, close, supersede, reviewer changes, ordinary human-thread resolution, or branch deletion still require the direct instruction required by the selected workflow.

The merge router uses a narrow positive command grammar. Status questions containing words such as *merge* or *ship* do not silently become destructive requests. Future or conditional permission is also excluded: confirmation/approval that the user explicitly defers until later remains read-only until the later confirmation actually happens.

### 2. Every network-visible GitHub write crosses one mutation boundary

Creating/editing issues or PRs, labels, assignments, comments, reviews, thread state, draft state, reviewers, remote branches, closes, merges, and follow-up objects are brokered through `scripts/github-mutate.mjs`, `scripts/lib/github-mutation-router.mjs`, and the lifecycle/legacy broker implementations behind that router.

The action model is centralized in `scripts/lib/mutation-action-registry.mjs`. Policy, broker behavior, routing/high-assurance semantics, and architecture tests are derived or cross-checked from that registry so adding an action cannot silently skip a safety layer.

PR mutations that can become stale are bound to the **expected head** and re-read it immediately before execution. Branch pushes bind the intended repository/remote/branch and exact old/new tips; history rewrites use exact `--force-with-lease`, never bare force.

A repository-wide mutation-boundary regression check rejects direct production GitHub/remote-Git write paths outside the approved boundary.

### 3. Trusted authority binds the exact effect

Caller fields such as `mutationMode`, `explicitInstruction`, `exactTextConfirmed`, `source: user`, or `trusted: true` are policy assertions — not proof of consent.

Where trusted authority is required, a host-issued grant binds a deterministic `scopeSha256` over the semantically relevant effect: repository, action, mode, PR/head, merge method, targets, idempotency key, and hashes of human-visible text. Redemption-required grants are short-lived and one-time.

Protected thread-state mutations are part of that high-assurance boundary. In particular, `resolve_bot_thread` cannot be authorized merely because repository/bot content caused the request; the Windows authority host classifies it as Windows Hello-protected even in `review` mode.

#### Human-thread replies

A human reply can be **planned** so its exact text is visible, but execution requires both:

- exact-text confirmation bound to the outgoing body; and
- trusted scoped authority.

A caller-computed hash or boolean cannot authorize the reply by itself.

#### Full-review verdict provenance

A format-valid `[GD]` verdict posted by the authenticated GitHub actor is not automatically trusted merge evidence.

Full-review publication is a high-assurance special case: `scripts/github-authorize.mjs` stamps durable hidden authority provenance onto the exact reviewed-head verdict request. `scripts/verify-verdict-published.mjs` verifies both the verdict format and the historical trusted-authority provenance at the comment's creation time. Same-actor lookalike verdicts without a valid scoped grant are rejected as merge-review evidence.

### 4. Exact idempotency receipts and safe retries

Durable creates and social writes use stable idempotency keys plus remote read-before-write evidence, but a predictable hidden marker is **not** sufficient proof that the intended effect already happened.

Receipt reuse is bound to the authenticated GitHub actor and the exact visible effect. The verifier rejects foreign-actor marker collisions, rejects pull requests returned by the Issues API when verifying issue creation, binds PR creation to the intended title/base/head, and binds review-thread replies to the intended parent comment. Autonomous same-key effects still use a remote claim so competing workers cannot both publish the same durable effect.

GitHub rate-limit retries are deliberately asymmetric:

- only commands proven **read-only** may retry;
- `Retry-After` and `X-RateLimit-Reset` are honored when present;
- fallback backoff is bounded, with **3 attempts by default**;
- GraphQL `mutation`, GitHub writes, and ambiguous API calls are **never blindly retried** after an unknown result.

A merge write that returns a non-zero/transport error after the exact write reached the runner is handled by **read-only reconciliation**, not a second merge attempt. The broker re-reads the exact-head merge state and returns `reconciled_after_error` only when GitHub proves the intended merged/queued/auto-merge outcome. If the result cannot be proved, the outcome remains explicitly unknown.

### 5. Ownership and foreign-PR boundary

Base updates, scoped code pushes, and simplification edits are performed only when the workflow has the required ownership/write authority. Foreign PRs receive exact owner instructions unless the user explicitly enters the maintainer-overtake workflow.

### 6. Progress and context economy cannot weaken the gates

The progress watchdog is defence in depth around agent execution. It does **not** grant GitHub mutation authority, execute writes on the agent's behalf, or turn omitted/unknown evidence into success.

- Stable read fingerprints bind state generation + tool + canonical input; exact duplicates are blocked only while that state remains unchanged.
- Volatile status reads are rate-limited rather than cached forever. A relevant state change invalidates the stable-read cache.
- Unknown tools fail toward allowing evidence acquisition rather than being denied by economy classification.
- Oversized model-facing output is compacted with bounded head/tail, retained failure-signalling lines, and explicit omission metadata.
- Oversized subagent inputs are rejected by the Codex hook adapter with a **6,000-character default budget** so large parent context is referenced rather than recopied.

---

## Review depth: more than "the checks are green"

A merge-ready or full-review path does not outsource judgment to CI or bots. The `blocking` scope rule is a binding readiness contract: a scope component marked blocking cannot be silently skipped, treated as advisory, or reported clean without its required evidence.

### Multidimensional review

The review bar combines:

- **Bug** review
- **Security** review
- **Spec** review
- **Standards** review
- repository-wide **semantic propagation** when a domain concept changes
- **Proactive contract verification** appropriate to the diff

Review depth is derived from changed paths, patch content, symbols, removed controls, dependencies, workflow permissions, architecture surfaces, and uncertainty — not filenames alone.

### Semantic propagation

Changed files are only the starting points. A full review traces each changed domain concept from its authoritative source through producers, consumers, sibling implementations, derived/public representations, persistence/serialization, fixtures, and tests.

Families such as provider sets, capability tables, schemas, enums, platform matrices, registries, or defaults are partitioned by materially different behavior. One representative is not accepted as coverage for the whole family unless equivalence is actually proved.

### Adversarial bug review

The bug axis uses a built-in **Finder → Challenger → Arbiter** method. Static-analysis leads and tool-free heuristics feed finding cards with explicit evidence and a Gate 0 impact bar. Coverage is reported honestly as `confirmed`, `dismissed`, `manual-review`, or `unreviewed`; partial coverage is never presented as clean.

### Deterministic probes and machine-checkable coverage

Known bug/security classes are named probes in `scripts/lib/probe-registry.mjs`.

- Diff shape deterministically produces `requiredProbes`.
- Offline scope fixtures pin the exact expected probe set.
- Retained regression assertions are bound to documentation anchors.
- Each required probe must emit `{ probeId, status, files?, reason? }` evidence.
- A required probe with concrete trigger files must resolve to `clean` or `findings`; it cannot be downgraded to `n-a` by free-form model prose.
- `n-a` remains valid only for the no-trigger edge case and requires a non-empty reason.
- `scripts/verify-probe-coverage.mjs` must accept that evidence before the axis can be considered complete.

Dropping a trigger, probe tag, assertion anchor, or required application record is a CI failure rather than silent review drift.

### Proactive contract verification

Depending on the diff, the review actively checks contracts such as wiring, operator smoke behavior, test honesty, docs/non-goals, input shape, evidence semantics, scale/determinism, malformed-input handling, serialization budgets, recursive termination, and CLI/API payload completeness.

Passing bots are necessary evidence when required, but are never sufficient proof by themselves.

### Security-specific behavior

Security review applies Gate 0 before a Confirmed finding and checks escalation chains before severity is assigned. Public output is redacted when exploit detail would be unsafe.

Credential-bearing OAuth/token/key adapters receive an explicit transport check: destinations must be HTTPS; a shared validator that still permits an adapter to attach credentials to `http://` is not accepted.

### Bot full-review signals

When a bot announces a **full review** rather than an incremental update, the skill runs its own Bug + Security + Spec review on the current head before treating prior `[GD] Fixed` replies as sufficient.

### Full-review completion is locked to a final verdict

A full review is not complete merely because analysis stopped. Its execution plan retains a mandatory **Publish final verdict** item until the final verdict for the reviewed head has been delivered.

Normal completion requires a format-valid, verified GitHub verdict. If GitHub publication is genuinely unavailable because of an auth, network, or API hard blocker, the workflow records that exact blocker and provides the complete verdict in chat instead. Choosing a stricter mutation mode on its own is not publication unavailability. The only permitted exit with **no verdict at all** is explicit user cancellation.

Same-head reruns use a material-delta anti-noise rule: when the strict label/TLDR result has not materially changed, an already valid verdict may be reused instead of posting duplicate top-level noise.

---

## Merge readiness and GitHub semantics

The ship path deliberately models platform details that commonly cause "green but not actually safe" mistakes.

- Required checks belong to the exact current PR generation; old-SHA results, partial matrices, queued checks, and incomplete evidence do not count.
- Check evidence preserves expected workflow/app/integration identity; same-name Check Run / Commit Status collisions cannot impersonate an app-bound required check.
- GitHub's authoritative check target is used where the platform evaluates a test-merge/merge-queue generation instead of naively trusting a convenient head result.
- Active applicable `required_status_checks` rules are aggregated; strict server-enforced base coherence is present when **any** applicable active rule requires strict required checks, independent of ruleset ordering.
- GitHub review decision, stale approvals, last-push approval requirements, unresolved review threads, conflicts, behind state, and merge-queue state are evaluated.
- The canonical merge driver precomputes the exact merge + optional post-merge-thanks transaction, obtains trusted grants for that exact batch, then recaptures live state and re-verifies the final merge boundary and review evidence **before** redeeming a grant or writing.
- `gh pr merge`/API success is not automatically reported as an immediate merge: queued/auto-merge and actual merged outcomes remain distinct.
- An error after an attempted merge write is reconciled from read-only exact-head state; the write is never blindly retried.
- Unknown future GitHub enum/state values fail closed instead of being treated as success.
- Dependency Review degradation fails closed across real dependency surfaces, including nested/non-Node dependency graphs such as NuGet.
- Merge execution requires same-head github-delivery review evidence, not merely a green ship gate.

### Base-health isolation

When a required check is red, the `baseHealth` component classifies the evidence as:

- `fix_in_pr` — introduced by the PR;
- `separate_follow_up` — reproduced on the base tip; or
- `investigate` — origin is unknown.

An unknown origin is a hard evidence stop. A base failure may still block shipping, but does not silently expand the implementation scope of the PR.

### Adaptive settle before a positive final claim

Once the authoritative gate first becomes ready, the workflow visibly settles on unchanged heads:

- **60 seconds** by default;
- **180 seconds** after a push, rebase, restack, force-with-lease, approval/thread change, or newly discovered workflow;
- authoritative gate re-check every **20 seconds**;
- no single blocking sleep longer than **30 seconds**.

Polling uses short bounded waits so new evidence can be observed without one long blocking sleep. When pending required CI is the only blocker, `scripts/ci-wait.mjs` owns the wait; parallel `Start-Sleep`, repeated `gh pr checks`, repeated `gh run view`, or equivalent manual polling loops are not a second waiting strategy. Material change resets the settle window, and one final authoritative gate closes the decision.

There is no path to a positive readiness, publication, or merge claim without one fresh final gate.

---

## Create-PR flow: bounded research, then forward progress

Creating a linked PR uses a bounded **research → implementation → pre-open review** sequence before publication.

Creating a PR follows this lifecycle:

```text
bounded need-to-fix research
        ↓
implementation
        ↓
pre-open Bug + Security gate on the non-empty candidate diff
        ↓
publish linked PR
        ↓
normal merge-ready lifecycle
```

The pre-open gate is **post-implementation and pre-publication**. It cannot become a research loop that prevents the first implementation commit. Completed issue research is reused when the relevant issue/development state has not changed.

`scripts/pre-open-gate.mjs` blocks incomplete/empty candidate diffs and prevents publication while required review evidence is incomplete or Confirmed High/Critical findings remain unresolved.

Remote branch push, PR creation/body correction, issue assignment, and related lifecycle writes use the same typed authority-aware mutation boundary rather than bypassing it with bare GitHub commands.

---

## Stacked PRs

Stack topology is discovered from live GitHub PR bases and qualified by repository/ref identity, so forks with identical branch names are not collapsed into one stack node.

The stack workflow:

- restacks **bottom-up**;
- merges **bottom-up**;
- enables `git rerere` to reuse conflict resolutions across cascading restacks;
- resolves the push remote through `remote.pushDefault` instead of hardcoding `origin`;
- refuses to guess in ambiguous multi-remote repositories;
- checks that each parent remote tip is an ancestor of its child before review/readiness/merge;
- edits a change only on the layer that owns that path/concern;
- revalidates every surviving child after a parent changes or lands;
- can enqueue a contiguous lower stack all-or-nothing when the base uses a merge queue and every participating PR independently satisfies readiness.

Rewritten stack pushes use the typed `push_code` authority path with exact old/new tips and force-with-lease semantics.

Active conflicts route through `references/resolve-conflicts.md` and are resolved from the intent/evidence of both sides, never from conflict markers alone.

---

## Safe simplification

Simplification is **explicit-only**. Its goal is lower cognitive load and safer maintenance. **Line count is never the goal**; fewer lines are acceptable only when behavior and clarity improve.

A candidate must preserve APIs, errors, ordering, concurrency, side effects, persistence, compatibility, validation, authorization, security, CI/evidence boundaries, and other material behavior.

The flow is conservative:

1. finish concrete bug/security/spec/feedback/base/CI work;
2. propose a bounded candidate list with invariants, risk, and validation;
3. allow **nothing worth simplifying** as a valid result;
4. require explicit approval before mutation;
5. apply only approved candidates;
6. run focused validation and required repository gates;
7. push the changed head;
8. automatically run the complete full review again with simplification disabled;
9. publish the final verdict only from that post-simplification head.

There is no recursive simplification loop.

---

## Agent progress watchdog

GitHub Delivery has a layered progress watchdog for a failure mode policy prose alone cannot reliably stop: an agent can spend a large amount of context narrating the same intention, rereading unchanged state, polling manually, or copying oversized evidence without producing external progress.

The watchdog is deliberately separate from mutation authority. It can interrupt, block, rate-limit, compact, or request a focused retry; it cannot authorize or execute a GitHub write.

| Enforcement level | What it does |
|---|---|
| **Policy only** | `GD-CORE-008` through `GD-CORE-010` provide the universal fallback for bounded progress and evidence/context economy when the host exposes no verified interception surface. |
| **Codex lifecycle hooks** | The normal install configures `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, and `SessionEnd`. After Codex's explicit non-managed hook trust review, they enforce duplicate-read blocking, volatile-poll limits, output compaction, focused subagent briefs, and one bounded corrective continuation. |
| **Protected Codex stream** | The installed `codex-with-watchdog.mjs` launch boundary observes streamed assistant deltas and issues one private `turn/interrupt` when repeated low-novelty intent narration crosses the watchdog threshold. This is the only layer that can stop the targeted failure while the message is still streaming. |

A configured hook is not automatically an active hook: Codex ties trust to the exact hook definition and skips a new or changed non-managed hook until it is reviewed in `/hooks`. GitHub Delivery records `hook_trust_required` rather than falsely reporting `hooks` in that state. The protected launcher independently marks its own process tree `stream`, so a protected session does not depend on machine-wide activation guesswork.

### Read and context economy

- Stable reads use `SHA-256(state-generation + tool-name + canonical-tool-input)` and are reusable until relevant state changes.
- Volatile reads remain refreshable; the default identical-poll interval is **30 seconds**.
- Pending-only required CI is delegated to `scripts/ci-wait.mjs` instead of parallel manual polling loops.
- Oversized tool output keeps a bounded head/tail plus unique failure/error/blocker/status signals and explicit omitted-character metadata.
- Codex hook mode uses a **6,000 serialized-character** default subagent-input budget and requires focused briefs that reference source files rather than copying large parent context.
- Raw tool arguments are not persisted in watchdog state; session ids and read inputs are represented by SHA-256 fingerprints.

For operator details, hook trust, host integration, and the protected streaming boundary, see [`references/agent-progress-watchdog.md`](references/agent-progress-watchdog.md).

---

## Live GitHub lifecycle fixture

The unit/eval suite proves deterministic contracts; **Live Integration** exercises the real GitHub lifecycle against a dedicated fixture repository.

The target is intentionally fail-closed and must be explicitly opted in with all of the following:

- `LIVE_FIXTURE_REPOSITORY` — dedicated `OWNER/REPO` target;
- `LIVE_FIXTURE_REPOSITORY_ID` — its immutable numeric GitHub repository ID;
- source and fixture repository names and IDs must differ;
- `.github/github-delivery-live-fixture.json` on the fixture base branch, binding the exact source and fixture names **and** numeric IDs;
- `LIVE_FIXTURE_TOKEN` with the capabilities required by the acceptance workflow.

A writable but unrelated repository therefore fails identity verification **before the first fixture mutation**, even if its repository name was accidentally configured.

The lifecycle exercises issues, branches, PRs, the Node 22/24 required check matrix, evidence snapshots, delayed head propagation, stale-head rejection, close behavior, and independent cleanup with versioned evidence artifacts. Cleanup re-verifies target identity before destructive cleanup actions.

The hosted workflow intentionally uses `--disposition close`; it does not bypass the trusted-authority requirement by merging fixture PRs.

Manual dispatch is always available. Scheduled execution remains opt-in through `LIVE_FIXTURE_ENABLED=true`.

See [`docs/live-integration.md`](docs/live-integration.md) and [`docs/live-github-integration.md`](docs/live-github-integration.md).

---

## Internal architecture

| Surface | Responsibility |
|---|---|
| `SKILL.md` | Host discovery, deterministic natural-language routing, entrypoint contracts |
| `scripts/lib/skill-router.mjs` | Positive/negative/deferred natural-language merge-intent classification |
| `references/policy-kernel.md` | Canonical cross-workflow invariants |
| `references/policy/*.md` | Focused mutation, evidence, review, CI, Git, issue, publication, release, and stack policy modules |
| `scripts/policy-bundle.mjs` | Deterministic workflow → policy-module resolution and architecture validation |
| `scripts/ship-gate-snapshot.mjs` | Capture one paginated evidence snapshot |
| `scripts/ship-gate.mjs` | Produce the authoritative `ready` / `blocked` / `unknown` decision |
| `scripts/lib/merge-boundary.mjs` | Bind head/base/rules fingerprints and aggregate strict ruleset enforcement |
| `scripts/merge-pr-driver.mjs` | Authorize the exact merge transaction, recapture final state, execute and summarize |
| `scripts/lib/mutation-action-registry.mjs` | Central mutation action semantics and propagation contract |
| `scripts/github-mutate.mjs` | Dry-run and execute authorized GitHub writes |
| `scripts/lib/github-mutation-router.mjs` | Route lifecycle and legacy mutation execution through one public mutation surface |
| `scripts/lib/github-mutation-broker.mjs` | Typed legacy/social executors, stale checks, idempotency and postconditions |
| `scripts/lib/github-lifecycle-mutation-broker.mjs` | Typed lifecycle creates/updates with exact remote receipt verification |
| `scripts/lib/idempotency-receipt.mjs` | Authenticated actor + exact-effect receipt matching |
| `scripts/lib/idempotency-receipt-runner.mjs` | Filter forged/non-exact marker hits from social idempotency reads |
| `scripts/lib/mutation-execution-context.mjs` | Trusted execution/redemption and ambiguous merge-outcome reconciliation |
| `scripts/github-authorize.mjs` | Attach exact-scope trusted authority grants and verdict provenance |
| `authority-host/windows/` | Optional Windows 11 / Windows Hello local trusted-authority issuer |
| `scripts/lib/github-retry.mjs` | Bounded retry policy for proven GitHub reads only |
| `scripts/lib/agent-progress-watchdog.mjs` | Host-agnostic narration-stall detection, read fingerprints, state generations, and output economy |
| `scripts/lib/watchdog-activation.mjs` | Truthful `none` / trusted `hooks` / controlled `stream` activation selection and non-sensitive receipt state |
| `scripts/codex-watchdog-hook.mjs` | Codex lifecycle-hook entrypoint for tool-boundary enforcement and bounded Stop recovery |
| `scripts/lib/codex-watchdog-remote-bridge.mjs` | Authenticated loopback bridge that applies the streaming watchdog between Codex remote client and stdio App Server |
| `scripts/codex-with-watchdog.mjs` | Protected Codex launcher and current-session `stream` capability declaration |
| `scripts/codex-app-server-watchdog-proxy.mjs` | Stdio streaming proxy for custom App Server clients with private in-flight `turn/interrupt` handling |
| `scripts/install-codex-watchdog-hooks.mjs` | Dry-run-first, backup-safe, idempotent Codex hook installer/repair path |
| `scripts/runtime-capabilities.mjs` | Report verified progress-watchdog capability as `none`, `hooks`, or `stream` |
| `scripts/review-scope.mjs` | Evidence-ranked review scope and required probes |
| `scripts/lib/probe-registry.mjs` | Deterministic diff-shape → named review-probe routing |
| `scripts/lib/probe-evidence.mjs` | Validate required probe evidence and reject required-trigger `n-a` downgrades |
| `scripts/verify-probe-coverage.mjs` | Machine-check required probe-application evidence |
| `scripts/pre-open-gate.mjs` | Gate PR publication on the implemented candidate diff |
| `scripts/inspect-stack.mjs` | Discover repository-qualified stack topology and safe order |
| `scripts/lib/live-fixture-identity.mjs` | Bind live lifecycle tests to the immutable opted-in fixture target |
| `scripts/live-github-fixture.mjs` | Exercise the real GitHub lifecycle |
| `scripts/build-dist.mjs` | Build deterministic versioned skill bundles |
| `scripts/prepare-release.mjs` | Verify release identity, checksums, SBOM, notes and provenance subjects |

The architecture intentionally uses **progressive disclosure**: a routed workflow loads the policy kernel plus only the modules it declares, instead of dumping every rule into every agent turn. `GD-CORE-009` and `GD-CORE-010` extend that idea into execution: prefer authoritative aggregate reads, reuse valid state snapshots, escalate diagnostics from status → failing component → focused excerpt → full raw output only when required, and pass subagents focused briefs with source references instead of copied context. Architecture validation ensures these context reductions do not remove required safety contracts.

---

## Installation

### Requirements

- **Node.js 22 or 24**
- Git
- GitHub network access
- an authenticated GitHub CLI (`gh auth login`) **or** a host-provided brokered GitHub connector

Build a deterministic bundle:

```bash
npm run build:dist
```

Or verify reproducibility while building release artifacts:

```bash
npm run dist:check
```

The installer is dry-run first. Full install, upgrade, backup, restore, downgrade, force, watchdog trust refresh, and manual-install behavior is documented in [`INSTALL.md`](INSTALL.md).

Typical skill locations include:

```text
~/.agents/skills/github-delivery
~/.cursor/skills/github-delivery
~/.codex/skills/github-delivery
~/.claude/skills/github-delivery
```

### Codex progress watchdog

On Codex, the normal installer configures the lifecycle-hook definitions along with the skill. Codex still requires explicit review/trust of new or changed non-managed hooks in `/hooks`; GitHub Delivery does not bypass that trust gate.

After trusting the unchanged definitions, persist the verified hook mode with:

```bash
node scripts/install-skill.mjs --hook-trust-verified --apply
```

For mid-message repeated-narration interruption, use the protected launcher:

```bash
node ~/.agents/skills/github-delivery/scripts/codex-with-watchdog.mjs
```

The launcher starts the real App Server over stdio, interposes an authenticated loopback remote bridge, and marks only its own launched process tree as `stream`. Ordinary `codex` and IDE sessions are not silently rerouted. The standalone `scripts/install-codex-watchdog-hooks.mjs` remains available for repair/non-standard installs.

### Optional Windows authority host

`authority-host/windows/` provides a stronger local approval path on Windows 11:

- Windows Hello for protected/high-assurance approval, including maintainer mode, destructive actions, protected bot-thread resolution, human replies, and format-recognized full-review verdicts;
- non-exportable ECDSA P-256 signing key via the Microsoft Platform Crypto Provider (TPM-backed when available);
- repository allowlist;
- finite exact-scope batches;
- 60-second grants with one-time redemption;
- current-user Named Pipe API — no arbitrary signing endpoint and no private key material exposed to the agent.

It is optional and does **not** automatically enable global strict-authority mode. See [`authority-host/windows/README.md`](authority-host/windows/README.md).

---

## Development and repository controls

Run the authoritative local suite:

```bash
npm run check
```

The required CI matrix runs **Node 22 and 24** on:

- Ubuntu
- Windows
- macOS

Every required matrix leg runs the normal repository checks **and** the architecture contract tests for mutation-action propagation and review-context integrity. Windows legs additionally restore/build the authority host in locked mode and run its self-test.

Repository controls also include:

- CodeQL for JavaScript/TypeScript and C#;
- Dependency Review;
- repository/workflow policy validation;
- deterministic distribution checks;
- offline routing, regression and review-scope evaluations;
- documentation/policy contracts;
- mutation-boundary and architecture regression tests;
- progress-watchdog regressions for narration stalls, duplicate reads, polling, output compaction, subagent budgets, hook trust/configuration, protected streaming interruption, and safe installation;
- OpenSSF Scorecard;
- release checksum/SBOM/provenance verification.

The separate **Architecture Contracts** workflow provides focused feedback, while the safety-critical architecture tests also live inside the required CI matrix so a path-filtered advisory workflow cannot be the only enforcement point.

The declared repository rules in `.github/repository-policy.json` currently require the six Node 22/24 matrix jobs, Dependency Review, and both CodeQL analyses with strict up-to-date-branch semantics.

---

## Security reporting

Do not publish suspected vulnerability details in a public issue or pull request. Use GitHub private vulnerability reporting as documented in [`SECURITY.md`](SECURITY.md).

---

## Current state

The complete issue/PR delivery lifecycle and its safety architecture are implemented: evidence-backed routing and ship gates, deferred-intent-safe merge routing, brokered lifecycle mutations, trusted exact-scope authority and durable verdict provenance, Windows Hello protection for high-assurance thread actions, deep review, semantic propagation, deterministic probes with non-bypassable required evidence, pre-open review, safe simplification, repository-qualified stacks, conflict recovery, merge-queue semantics, aggregated strict-ruleset enforcement, authenticated exact-effect idempotency receipts, ambiguous-merge readback reconciliation, safe read retries, layered progress/context economy with trust-aware Codex hook configuration and a protected streaming launch boundary, issue close-out, deterministic release packaging, repository controls, and dedicated live lifecycle fixtures.

Remaining work is primarily **operational** rather than a missing architecture layer: keep live repository rules/security settings aligned with the documented policy, provision and maintain the dedicated live fixture target/credential, run release acceptance for new versions, keep host integrations explicitly configured where runtime watchdog enforcement is desired, and extend the regression corpus as GitHub and agent hosts evolve.
