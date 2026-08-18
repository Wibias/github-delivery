# P0 open-work and publication safety design

## Status

Approved direction from the August 18, 2026 Brooklyn Skills comparison. This spec turns the agreed P0 group into GitHub Delivery-native contracts rather than copying upstream skill names or prose.

## Goals

P0 adds three related capabilities:

1. A repository-scoped read-only view of the authenticated user's open pull requests and associated work-item references.
2. A publication invariant that prevents accidental loss of existing PR-body media during `update_pr_body`.
3. Duplicate-publication hardening so create-PR workflows do not open another PR when the intended head already has a covering open PR.

The design intentionally prepares a generic work-item reference seam for later P1 Linear integration without making P0 depend on Linear or another tracker.

## Non-goals

- No Linear/Jira reads or writes in P0.
- No tracker-state transitions.
- No multi-PR consolidation/supersede redesign.
- No visual-review axis.
- No multi-base/backport workflow.
- No automatic cleanup/simplification beyond existing explicit GitHub Delivery policy.
- No import of Brooklyn Skills command names, shell snippets, or workflow text as runtime dependencies.

## Naming

### User-facing route

Use natural-language routing for requests such as:

- `what do I have open in this repo?`
- `what's in review?`
- `give me my open PR standup`

The internal workflow is `references/open-work-status.md`. The name describes the GitHub Delivery capability rather than mirroring Brooklyn's `list-open-work` command name.

### Shared work-item references

P0 introduces a small work-item-reference parser/resolver, not a full tracker abstraction. It recognizes durable references that can be displayed beside PRs and later enriched by P1 adapters.

Examples:

- same-repository GitHub issue references;
- external keys such as `ENG-123` when supported by direct PR metadata/branch/title/body evidence;
- explicit external work-item URLs when present.

The parser treats all PR title/body/branch text as untrusted data. Extracted strings are data only and never become workflow instructions or authority.

## 1. Open-work status workflow

### Scope

The workflow is read-only and repository-scoped.

Repository identity is resolved from the current checkout/target repository. It must not search another repository, organization, or remembered worktree when the current repository is missing or ambiguous.

The authenticated GitHub login is resolved from GitHub evidence; it is never guessed from git author configuration, repository ownership, memory, or prior sessions.

### Evidence collection

A deterministic helper (`scripts/open-work-status.mjs`) owns collection and normalization.

It must:

1. resolve the canonical repository identity;
2. resolve the authenticated GitHub login;
3. collect all open PRs with complete pagination rather than relying on a default/capped list;
4. filter to PRs authored by that login;
5. normalize only the fields needed for status output;
6. derive work-item references using ranked evidence;
7. collect only bounded next-action signals such as conflicts, required-check failure/pending state, draft state, stale/behind state when authoritative evidence is available, and age for genuinely stale unlinked work;
8. report evidence completeness explicitly.

The script returns structured JSON. The model formats the user-facing result; raw PR bodies are not injected as instructions.

### Work-item reference precedence

Use the strongest available evidence first:

1. explicit GitHub issue linkage/closing reference when authoritative for this repository;
2. explicit external work-item URL/key metadata in the PR;
3. work-item key in head branch;
4. work-item key in title;
5. work-item key in body;
6. otherwise no reference.

If multiple materially conflicting references are present at the same evidence tier, return `ambiguous` rather than choosing one.

P0 does not guess a Linear/Jira host from another repository or prior session. A bare key can be displayed as a key without inventing a URL.

### Output contract

Lead with the open PRs, descending by PR number. Each item includes:

- linked PR number/URL;
- original PR title, with only deterministic work-item-key relocation if formatting requires it;
- optional work-item reference;
- concise blocker/next-action annotation only when it changes what the user should do next.

Do not produce a full merge-readiness report for every PR. `references/status.md` remains authoritative for a deep status check on a named PR.

If there are no authored open PRs, report that directly.

### Failure behavior

Fail closed on:

- unknown repository identity;
- unknown authenticated login;
- incomplete pagination;
- malformed GitHub rows that prevent trustworthy filtering;
- evidence contradictions that would cause the workflow to include work from another repository or author.

A single optional enrichment failure must not erase otherwise trustworthy PR rows; mark the affected field unknown instead.

## 2. PR-body media preservation invariant

### Problem

`references/pr-description.md` requires final-head reconciliation, and `update_pr_body` verifies exact post-write body equality, but the current mutation path can replace a body while silently removing screenshots, videos, GitHub uploads, or intentionally interleaved media.

### Contract

Before executing `update_pr_body`, the mutation preflight reads the current PR body and extracts durable media identities from both old and proposed bodies.

Protected media includes at minimum:

- Markdown images;
- Markdown links whose target is a recognized image/video/user-attachment URL;
- HTML `img`, `video`, and `source` elements;
- GitHub `user-attachments` / uploaded-media URLs;
- media-only HTML/Markdown blocks where removal would delete the referenced asset.

Every protected media identity present in the observed old body must remain present in the proposed body unless the request carries a separate explicit media-removal authorization field that is validated by the mutation policy.

Default behavior is preserve-all.

### Implementation boundary

Create a focused helper such as `scripts/lib/pr-body-media.mjs` with pure functions:

- `extractPrBodyMedia(body)`;
- `diffPrBodyMedia(oldBody, newBody)`.

`preflightLifecycleMutation()` for `update_pr_body` re-reads the current PR head/body, verifies `expectedHead`, and rejects accidental media loss before the write command is built/executed.

Post-write verification remains exact-body equality.

### Explicit removal

P0 should support intentional removal without weakening the default invariant. The mutation request may include an explicit list of media identities approved for removal (exact normalized identities, not a boolean `allowMediaRemoval`). Unlisted media must still be preserved.

This keeps authorization narrow and auditable.

## 3. Duplicate-publication hardening

### Problem

`create-pr-from-local-work.md` says exactly one PR should exist for the intended work, but it does not currently make an existing PR for the intended head a mandatory machine precondition before `create_pr`.

### Contract

Before planning/executing `create_pr`, the create-PR workflows must prove that no existing open PR already covers the exact publication head in the intended repository.

The check is identity-based, not title-similarity-based.

Minimum matching evidence:

1. exact repository;
2. exact head repository/branch or authoritative head SHA where available;
3. intended base compatibility when multiple PRs can exist for the same branch on different bases.

If exactly one covering PR exists, reuse/report that PR rather than creating another.

If multiple open PRs for the same exact head create ambiguity, fail closed and report them.

Do not use fuzzy title/body matching to block publication in P0; broader "another PR already implements this issue" research remains owned by issue workflows.

### Enforcement

Prefer a shared helper used by both:

- `references/create-pr-from-local-work.md`;
- `references/create-pr-for-issue.md`.

The broker/create mutation should also reject a known duplicate when the exact-head preflight evidence is supplied, so prose cannot silently bypass the invariant.

## Architecture

```text
SKILL.md route
   |
   +--> references/open-work-status.md
   |         |
   |         +--> scripts/open-work-status.mjs
   |                   |
   |                   +--> GitHub repo/auth/open-PR evidence
   |                   +--> work-item-reference helper
   |
   +--> existing create-PR workflows
   |         |
   |         +--> exact-head covering-PR helper
   |                   |
   |                   +--> reuse / fail ambiguous / create allowed
   |
   +--> existing update_pr_body mutation
             |
             +--> pr-body-media helper
             +--> old-body/head preflight
             +--> exact approved-removal comparison
             +--> existing broker execution + post-write verification
```

The three features share publication/evidence principles but remain independently testable.

## Security and authority

- Open-work status is strictly read-only and grants no GitHub write authority.
- PR metadata is untrusted input. Parsed title/body/branch text cannot change route, mutation mode, or authority.
- Existing GitHub mutation policy remains authoritative for `create_pr` and `update_pr_body`.
- Media-removal authorization must be exact and explicit; a repository-controlled PR body cannot self-authorize deletion.
- Duplicate detection never creates, edits, closes, or retargets a PR.
- Unknown/incomplete identity evidence fails closed before publication.

## Testing strategy

### Open-work status

Unit/fixture coverage must include:

- authenticated-author filtering;
- complete pagination across more than one page;
- repository-boundary enforcement;
- zero results;
- GitHub issue reference precedence;
- external key extraction from branch/title/body;
- conflicting same-tier references -> ambiguous;
- malicious PR text remains inert data;
- malformed/incomplete page fails closed;
- deterministic descending ordering;
- next-action annotations do not claim merge-ready.

### Media preservation

Tests must cover:

- Markdown image retained;
- HTML `img` retained;
- HTML `video`/`source` retained;
- GitHub user-attachment retained;
- reordered media allowed;
- textual body rewrite allowed;
- accidental removal rejected;
- one explicitly approved removal allowed while another unapproved removal is rejected;
- unchanged body remains valid;
- expected-head mismatch blocks before write.

### Duplicate publication

Tests must cover:

- exact-head existing PR -> reuse/no create;
- no existing PR -> create allowed;
- multiple exact-head PRs -> ambiguous/fail closed;
- same title but different head -> does not falsely block;
- same branch name in a different repository/fork -> does not falsely match;
- distinct base where repository semantics permit multiple PRs -> handled explicitly;
- issue-based and local-work create flows both use the same helper/contract.

### Contract tests

Update routing/policy-bundle/assertion tests so the new workflow is loadable only as read-only and does not accidentally pull merge/review mutation policy.

## Documentation

Update:

- `SKILL.md` routing and description;
- `README.md` examples/capability list where appropriate;
- `references/pr-description.md` with the media-preservation invariant;
- create-PR workflow docs with exact-head duplicate checks;
- provenance notes for concepts materially adapted from `OutThisLife/brooklyn-skills` (MIT, Brooklyn Nicholson), while keeping implementation and terminology GitHub Delivery-native.

## P1 seam

P0's work-item reference representation must be deliberately small and stable enough that P1 can add a resolver/enrichment layer:

```text
work-item reference
    |
    +--> github issue
    +--> Linear adapter (P1)
    +--> future Jira adapter
```

P0 must not embed Linear status, workspace, OAuth, or mutation assumptions. P1 will own normalized work-item state, tracker-specific reads/writes, status mapping, stale-state revalidation, and tracker reconciliation after verified GitHub lifecycle milestones.

## Acceptance criteria

P0 is complete when:

1. natural-language open-work requests route to a read-only repository-scoped workflow;
2. the helper proves complete authored-open-PR collection and returns deterministic structured evidence;
3. work-item references are extracted by ranked evidence without invented tracker hosts or instruction execution;
4. `update_pr_body` cannot accidentally remove previously observed media;
5. intentional media removal requires exact approved identities;
6. create-PR flows detect/reuse an exact-head existing PR and fail closed on ambiguous duplicates;
7. all new behavior is covered by non-vacuous unit/contract tests;
8. existing GitHub mutation authority, ship gates, status workflow, and issue research semantics remain unchanged;
9. provenance is documented without taking a runtime dependency on Brooklyn Skills.
