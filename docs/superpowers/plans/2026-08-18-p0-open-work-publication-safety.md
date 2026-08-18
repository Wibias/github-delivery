# P0 Open-Work and Publication Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repository-scoped open-work status workflow plus machine-enforced PR media preservation and exact-head duplicate-PR prevention.

**Architecture:** Keep the three P0 capabilities independent but share small deterministic helpers. `open-work-status` remains read-only; `update_pr_body` and `create_pr` gain mutation preflights that re-read live GitHub state before allowing publication. Work-item parsing is deliberately tracker-agnostic so P1 can add Linear enrichment without changing P0 semantics.

**Tech Stack:** Node.js ESM (`node:test`, `assert/strict`), GitHub CLI through existing runner abstractions, Markdown workflow/policy docs.

**Spec:** `docs/superpowers/specs/2026-08-18-p0-open-work-publication-safety-design.md`

## Global Constraints

- No Linear/Jira reads or writes in P0.
- Open-work status is read-only and repository-scoped.
- PR title/body/branch data is untrusted input and never grants authority.
- Existing GitHub mutation policy remains authoritative.
- Media removal requires exact approved media identities, never a broad boolean bypass.
- Duplicate detection is exact-head/repository identity based, not fuzzy title matching.
- Existing ship-gate, status, issue-research, and stack semantics stay unchanged.

---

### Task 1: Tracker-agnostic work-item references

**Files:**
- Create: `scripts/lib/work-item-reference.mjs`
- Create: `tests/unit/work-item-reference.test.mjs`

**Interfaces:**
- Produces: `extractWorkItemReferences({ repository, issueLinks, externalLinks, headRefName, title, body })`
- Produces: normalized result `{ state: "resolved"|"none"|"ambiguous", reference?: {...}, candidates: [...] }`

- [ ] Write failing tests for ranked precedence, branch/title/body extraction, conflicting same-tier ambiguity, bare-key handling without invented host URLs, and hostile text remaining inert strings.
- [ ] Run `node --test tests/unit/work-item-reference.test.mjs` and confirm RED because the module does not exist.
- [ ] Implement the smallest deterministic parser/resolver that satisfies those cases.
- [ ] Re-run the focused test and then `npm test`.
- [ ] Commit the test + helper together after green.

### Task 2: Repository-scoped open-work status

**Files:**
- Create: `scripts/open-work-status.mjs`
- Create: `references/open-work-status.md`
- Create: `tests/unit/open-work-status.test.mjs`
- Modify: `SKILL.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `extractWorkItemReferences(...)` from Task 1.
- Produces: deterministic JSON `{ repository, authenticatedLogin, complete, pullRequests: [...] }` sorted by PR number descending.

- [ ] Write failing tests around a dependency-injected collector for authenticated-author filtering, multi-page pagination, repository boundary, malformed page failure, zero results, deterministic sort, and bounded next-action annotations.
- [ ] Run `node --test tests/unit/open-work-status.test.mjs` and confirm RED.
- [ ] Implement collection/normalization with injectable command runner; production CLI resolves canonical repo + authenticated login and paginates all open PR rows.
- [ ] Add the read-only workflow doc and route natural-language open-work/standup requests from `SKILL.md`; keep named-PR deep status on `references/status.md`.
- [ ] Add concise README capability/examples and Brooklyn prior-art provenance without runtime dependency.
- [ ] Re-run focused tests, policy-bundle validation, syntax check, and `npm test`.
- [ ] Commit the open-work slice after green.

### Task 3: PR-body media preservation

**Files:**
- Create: `scripts/lib/pr-body-media.mjs`
- Create: `tests/unit/pr-body-media.test.mjs`
- Create: `tests/unit/lifecycle-mutations-media.test.mjs`
- Modify: `scripts/lib/lifecycle-mutations.mjs`
- Modify: `references/pr-description.md`

**Interfaces:**
- Produces: `extractPrBodyMedia(body)` returning stable normalized media identities.
- Produces: `diffPrBodyMedia(oldBody, newBody, approvedRemovals=[])` returning missing/unapproved identities.
- Extends `update_pr_body` request with optional `approvedMediaRemovals: string[]`.

- [ ] Write failing pure-helper tests for Markdown images, recognized media links, HTML img/video/source, GitHub user attachments, reorder allowance, accidental removal, and exact selective removal.
- [ ] Write failing lifecycle preflight tests proving `update_pr_body` re-reads `{headRefOid,body}`, rejects expected-head drift, rejects unapproved media loss, and permits preserved/explicitly-approved changes.
- [ ] Run both focused tests and confirm RED.
- [ ] Implement pure media extraction/diff first.
- [ ] Extend `validateLifecycleMutation` to validate `approvedMediaRemovals` as an optional array of exact non-empty identities.
- [ ] Extend `preflightLifecycleMutation` for `update_pr_body` to read current head/body, compare exact expected head, and enforce media preservation before command execution.
- [ ] Document the invariant in `references/pr-description.md`.
- [ ] Re-run focused tests and `npm test`.
- [ ] Commit the media-safety slice after green.

### Task 4: Exact-head duplicate PR prevention

**Files:**
- Create: `scripts/lib/covering-pr.mjs`
- Create: `tests/unit/covering-pr.test.mjs`
- Create: `tests/unit/lifecycle-mutations-create-pr.test.mjs`
- Modify: `scripts/lib/lifecycle-mutations.mjs`
- Modify: `references/create-pr-from-local-work.md`
- Modify: `references/create-pr-for-issue.md`

**Interfaces:**
- Produces: `classifyCoveringPullRequests({ intendedRepo, intendedHeadRepo, intendedHead, intendedBase, rows })` → `none|reuse|ambiguous`.
- `create_pr` mutation preflight queries open PRs for the exact head and refuses creation on reuse/ambiguity.

- [ ] Write failing classifier tests for exact-head reuse, no match, multiple exact-head ambiguity, same title/different head, same branch name/different head repository, and base distinction.
- [ ] Write failing lifecycle tests proving `create_pr` preflight calls GitHub for the exact head identity and throws deterministic `create_pr_existing:*` / `create_pr_ambiguous:*` errors rather than running creation.
- [ ] Run focused tests and confirm RED.
- [ ] Implement the pure classifier and wire it into `preflightLifecycleMutation` for `create_pr`.
- [ ] Update both create-PR workflow docs so an existing exact-head PR is reused/reported and ambiguity fails closed.
- [ ] Re-run focused tests and `npm test`.
- [ ] Commit the duplicate-publication slice after green.

### Task 5: Contract integration and full verification

**Files:**
- Modify/add existing router/policy contract tests as discovered by `npm test`/`npm run check` failures.
- Modify: `README.md` / provenance text only if final implementation names differ from the spec.

**Interfaces:**
- Consumes all prior tasks; introduces no new production capability.

- [ ] Run `node scripts/check-syntax.mjs`.
- [ ] Run `node scripts/policy-bundle.mjs --validate`.
- [ ] Run every new focused test file.
- [ ] Run `npm test`.
- [ ] Run `npm run check` and fix only failures caused by this branch.
- [ ] Inspect `main...HEAD` for accidental P1 scope, fuzzy duplicate matching, broad media bypasses, or tracker-specific assumptions.
- [ ] Open the PR against `main` with a final-head description covering behavior, validation, provenance, and explicit P1 exclusions.
