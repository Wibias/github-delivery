# No-comments and automatic simplify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** github-delivery runs no-comments then simplify automatically on review, merge-ready, and create-PR paths, with per-request opt-out, without granting `push_code` to a bare full review.

**Architecture:** A prompt-level `composedHygienePasses` planner decides run/skip/n/a for each pass. A new `references/no-comments.md` workflow plus `agents/comment-inspector.md` own the keep-list and independent hunter. Existing workflows compose those passes. Router, profiles, and contract tests make the defaults and opt-outs executable.

**Tech Stack:** Node.js 22+ `node:test`, existing `scripts/lib/skill-router.mjs` routing, markdown workflow contracts, skill payload `RUNTIME_DIRS`.

## Global Constraints

- Branch from `origin/main`. Do not bundle ship-gate or docs-package work.
- Not a zero-comments ban. Innocent-list comments stay.
- Bare full review does not gain `push_code`. Opt-out does not grant `push_code`.
- Foreign PRs stay report-only.
- Line count is never a success metric.
- Opt-out is per request only. No durable config flag.
- Bare `no comments` is not opt-out.
- Failed no-comments blocks verdict / merge-ready / publication. Skipped passes cannot fail.
- Do not commit unless the user asks. Skip every Commit step.

---

### Task 1: Hygiene pass planner

**Files:**
- Create: `scripts/lib/hygiene-passes.mjs`
- Test: `tests/unit/hygiene-passes.test.mjs`

**Interfaces:**
- Consumes: prompt string, workflow path (`references/*.md`)
- Produces: `composedHygienePasses(prompt, workflow) => { noComments, simplify, skipNoCommentsReason, skipSimplifyReason }` where each pass is `"run" | "skip" | "n/a"` and skip reasons are `null` or the matched phrasing.

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { composedHygienePasses } from "../../scripts/lib/hygiene-passes.mjs";

test("composed review defaults both passes on", () => {
  const result = composedHygienePasses("full review PR #42", "references/full-review-pr.md");
  assert.deepEqual(result, {
    noComments: "run",
    simplify: "run",
    skipNoCommentsReason: null,
    skipSimplifyReason: null,
  });
});

test("opt-out is independent and does not treat bare no comments as skip", () => {
  assert.equal(composedHygienePasses("full review PR #42 without simplify", "references/full-review-pr.md").simplify, "skip");
  assert.equal(composedHygienePasses("full review PR #42 skip no-comments", "references/full-review-pr.md").noComments, "skip");
  const both = composedHygienePasses("full review PR #42 skip no-comments and without simplify", "references/full-review-pr.md");
  assert.equal(both.noComments, "skip");
  assert.equal(both.simplify, "skip");
  assert.equal(composedHygienePasses("full review PR #42 no comments", "references/full-review-pr.md").noComments, "run");
});

test("status does not compose hygiene passes", () => {
  const result = composedHygienePasses("is PR #42 merge ready?", "references/status.md");
  assert.equal(result.noComments, "n/a");
  assert.equal(result.simplify, "n/a");
});

test("standalone no-comments always runs that pass", () => {
  const result = composedHygienePasses("no-comments PR #42", "references/no-comments.md");
  assert.equal(result.noComments, "run");
  assert.equal(result.simplify, "n/a");
});
```

Cover composed workflows: `full-review-pr`, `re-review-pr`, `fix-pr-bots`, `create-pr-for-issue`, `create-pr-from-local-work`, `prepare-and-merge-pr`. Skip phrases: `without simplify`, `skip simplify`, `don't simplify`, `skip no-comments`, `without no-comments`, `keep source comments`, `don't strip comments`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/hygiene-passes.test.mjs`
Expected: FAIL because `scripts/lib/hygiene-passes.mjs` does not exist.

- [ ] **Step 3: Write minimal implementation**

`scripts/lib/hygiene-passes.mjs`:

```js
const COMPOSED = new Set([
  "references/full-review-pr.md",
  "references/re-review-pr.md",
  "references/fix-pr-bots.md",
  "references/create-pr-for-issue.md",
  "references/create-pr-from-local-work.md",
  "references/prepare-and-merge-pr.md",
]);

const SKIP_SIMPLIFY = /\b(?:without|skip|don't|dont|do not)\s+simplify\b/;
const SKIP_NO_COMMENTS = /\b(?:skip|without)\s+no-comments\b|\bkeep source comments\b|\bdon'?t strip comments\b|\bdo not strip comments\b/;

function normalizeWorkflow(value) {
  let workflow = String(value || "").trim().replaceAll("\\", "/");
  if (workflow && !workflow.startsWith("references/")) workflow = `references/${workflow}`;
  if (workflow && !workflow.endsWith(".md")) workflow += ".md";
  return workflow;
}

function normalized(prompt) {
  return String(prompt || "").trim().toLowerCase();
}

export function composedHygienePasses(prompt, workflow) {
  const text = normalized(prompt);
  const path = normalizeWorkflow(workflow);
  const skipSimplify = SKIP_SIMPLIFY.test(text);
  const skipNoComments = SKIP_NO_COMMENTS.test(text);
  const skipSimplifyReason = skipSimplify ? (text.match(SKIP_SIMPLIFY)?.[0] ?? "skip simplify") : null;
  const skipNoCommentsReason = skipNoComments ? (text.match(SKIP_NO_COMMENTS)?.[0] ?? "skip no-comments") : null;

  if (path === "references/no-comments.md") {
    return { noComments: "run", simplify: "n/a", skipNoCommentsReason: null, skipSimplifyReason: null };
  }
  if (path === "references/simplify-pr.md") {
    return { noComments: "n/a", simplify: "run", skipNoCommentsReason: null, skipSimplifyReason: null };
  }
  if (!COMPOSED.has(path)) {
    return { noComments: "n/a", simplify: "n/a", skipNoCommentsReason: null, skipSimplifyReason: null };
  }
  return {
    noComments: skipNoComments ? "skip" : "run",
    simplify: skipSimplify ? "skip" : "run",
    skipNoCommentsReason,
    skipSimplifyReason,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/hygiene-passes.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit** — skip unless the user asks.

---

### Task 2: Route explicit no-comments

**Files:**
- Modify: `scripts/lib/skill-router.mjs` (add `NO_COMMENTS_REQUEST`, insert route before standalone simplify, add path to `ROUTABLE_WORKFLOWS`)
- Modify: `scripts/lib/workflow-mode.mjs` (add `"references/no-comments.md": ["maintainer"]`)
- Test: `tests/unit/skill-router.test.mjs` (new cases)

**Interfaces:**
- Consumes: `routeShippingGithubPrompt(prompt)`
- Produces: `{ workflow: "references/no-comments.md", mutationMode: "maintainer", explicitActions: ["push_code"] }`
- Full review plus no-comments / opt-out still selects `references/full-review-pr.md`
- Bare full review still has no `push_code`

- [ ] **Step 1: Write the failing tests** in `tests/unit/skill-router.test.mjs`

```js
test("routes explicit no-comments to the no-comments workflow", () => {
  assert.deepEqual(routeShippingGithubPrompt("no-comments PR #42"), {
    skill: "github-delivery",
    workflow: "references/no-comments.md",
    mutationMode: "maintainer",
    explicitActions: ["push_code"],
  });
  assert.equal(routeShippingGithubPrompt("strip comments on PR #42").workflow, "references/no-comments.md");
});

test("full review plus no-comments or opt-out stays on full review without granting push_code", () => {
  const combined = routeShippingGithubPrompt("full review PR #42 skip no-comments");
  assert.equal(combined.workflow, "references/full-review-pr.md");
  assert.deepEqual(combined.explicitActions, []);
  const withSimplify = routeShippingGithubPrompt("full review PR #42 and simplify it safely");
  assert.equal(withSimplify.workflow, "references/full-review-pr.md");
  assert.equal(withSimplify.mutationMode, "maintainer");
});
```

- [ ] **Step 2: Run the new tests**

Run: `node --test tests/unit/skill-router.test.mjs`
Expected: FAIL on missing workflow.

- [ ] **Step 3: Implement routing**

Add near `SIMPLIFY_REQUEST`:

```js
const NO_COMMENTS_REQUEST = /\b(no-comments|strip comments|comment sicko|comment inspector)\b/;
const SKIP_NO_COMMENTS_REQUEST = /\b(?:skip|without)\s+no-comments\b|\bkeep source comments\b|\bdon'?t strip comments\b|\bdo not strip comments\b/;
```

In `ROUTABLE_WORKFLOWS`, add `"references/no-comments.md"` next to simplify.

After the `FULL_REVIEW_REQUEST` block, before standalone simplify:

```js
if (NO_COMMENTS_REQUEST.test(text) && PR_REFERENCE.test(text) && !SKIP_NO_COMMENTS_REQUEST.test(text) && !FULL_REVIEW_REQUEST.test(text)) {
  return result("references/no-comments.md", "maintainer", ["push_code"]);
}
```

Do not add `push_code` to bare full review. `and simplify` may still grant maintainer/`push_code` as today.

Add workflow-mode entry `"references/no-comments.md": ["maintainer"]`.

- [ ] **Step 4: Re-run router tests**

Run: `node --test tests/unit/skill-router.test.mjs tests/unit/hygiene-passes.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit** — skip unless the user asks.

---

### Task 3: Controller profile and skill payload

**Files:**
- Modify: `scripts/lib/delivery-workflow-profiles.mjs` (`PROFILE_DEFINITIONS["no-comments"] = { graph: REVIEW_GRAPH, mutation: "maintainer" }`)
- Modify: `tests/unit/delivery-workflow-profiles.test.mjs` (add `"no-comments"` to `ROUTED_WORKFLOWS`)
- Modify: `scripts/lib/distribution.mjs` (`RUNTIME_DIRS` includes `"agents"`)

**Interfaces:**
- Consumes: `resolveDeliveryWorkflowProfile("references/no-comments.md")`
- Produces: `{ workflow: "no-comments", mutation: "maintainer", graph: REVIEW_GRAPH }`

- [ ] **Step 1: Extend the profiles test list with `"no-comments"` and run it** — FAIL unknown workflow.
- [ ] **Step 2: Add the profile definition and `agents` to `RUNTIME_DIRS`.**
- [ ] **Step 3: Run** `node --test tests/unit/delivery-workflow-profiles.test.mjs` — PASS
- [ ] **Step 4: Commit** — skip unless the user asks.

---

### Task 4: No-comments workflow and comment inspector

**Files:**
- Create: `references/no-comments.md`
- Create: `agents/comment-inspector.md`
- Test: `tests/unit/no-comments-contract.test.mjs`

**Interfaces:**
- Consumes: policy modules like simplify (`policy-kernel`, `mutation`, `evidence`, `git`, `reviews`, stacks-when-detected)
- Produces: agent-facing keep-list, inspector, apply vs report, failure that blocks verdict, spawn-if-available comment inspector

- [ ] **Step 1: Write contract tests** covering:
  - policy-modules block present
  - innocent list: license, public API docs, issue/RFC, external/protocol gotcha, style-only suppressions (no encode-later catch-all)
  - guilty: narration, alibi, correctness/safety suppressions, our-code surprises
  - spawn comment inspector when host can spawn; parent fallback is not a failed hunt
  - inspector rejects application-code edits; one rerun; second rejection fails the pass
  - apply only on own PR with `push_code`; foreign/read-only report-only
  - failed pass blocks verdict / merge-ready / publication; out-of-scope leftover is a merge-ready blocker
  - opt-out skip cannot fail
  - `comment-depth.md` is GitHub posts, not source comments
  - fixtures A–G as regex contracts on the workflow text (narration example, alibi example, keep examples, two-rejected-reports, foreign report-only, opted-out does not block, out-of-scope merge-ready blocker)

- [ ] **Step 2: Run** `node --test tests/unit/no-comments-contract.test.mjs` — FAIL missing files.
- [ ] **Step 3: Write `references/no-comments.md` and `agents/comment-inspector.md` from the spec Primary rule, inspector, apply table, failure list, and composition order.** Include `node scripts/workflow-brief.mjs no-comments` in the workflow controller note if other review workflows name the brief. The comment inspector may only touch comments and raise root-cause flags; never application code. Keep-list matches the spec, not pstack delete-on-doubt.
- [ ] **Step 4: Re-run contract tests** — PASS
- [ ] **Step 5: Commit** — skip unless the user asks.

---

### Task 5: Simplify is default-on when composed

**Files:**
- Modify: `references/simplify-pr.md` trigger, approval gate
- Modify: `references/full-review-pr.md` steps 0/7 (no-comments first, simplify after correctness, opt-out, auto-apply on own+push_code, no recursive pass)
- Modify: `tests/unit/simplify-review-contract.test.mjs`

**Interfaces:**
- Consumes: `composedHygienePasses` (agents read it via workflow prose; do not require the agent to import the JS)
- Produces: simplify no longer explicit-only on composed paths; standalone simplify still exists; contract card and nothing-worth-simplifying stay; own PR with `push_code` auto-applies eligible candidates; foreign still report-only

Replace simplify trigger with: default-on when composed by full review, re-review, merge-ready/fix, create-PR pre-open, or prepare-and-merge, unless the request opts out. Standalone explicit simplify remains.

Replace approval gate: on own PRs when `push_code` is already allowed, apply eligible contract-card candidates without a second yes. Do not interpret a bare full review as `push_code`. Keep “present the list” for read-only/foreign.

Update the “activation was explicit” done-when bullet.

Rewrite `simplify-review-contract.test.mjs`:
- still routes standalone simplify
- still combined full review + simplify → full-review-pr maintainer
- **stop** requiring SKILL.md / simplify / full-review `explicit-only` / `explicitly asks` as the activation rule
- require automatic composition unless opted out
- keep line count never, nothing worth simplifying, revert individually, foreign no edits
- README: automatic on review/merge-ready unless opted out; line count never; nothing worth simplifying; SECURITY.md still required. Drop the requirement that README still says simplification is explicit-only. Keep an example `full review PR #42 without simplify` and `no-comments PR #42`.

- [ ] **Step 1: Update the contract tests first, run, watch FAIL.**
- [ ] **Step 2: Patch simplify-pr.md and full-review-pr.md.**
- [ ] **Step 3: Re-run** `node --test tests/unit/simplify-review-contract.test.mjs` — PASS
- [ ] **Step 4: Commit** — skip unless the user asks.

---

### Task 6: Compose into the remaining workflows

**Files:**
- Modify: `references/re-review-pr.md`
- Modify: `references/fix-pr-bots.md`
- Modify: `references/create-pr-for-issue.md`
- Modify: `references/create-pr-from-local-work.md`
- Modify: `references/prepare-and-merge-pr.md`
- Modify: `references/shared-rules.md` (ownership applies-to includes `no-comments`)
- Modify: `references/design-quality.md` (simplify is not explicit-only for composed edits; Standards still must not silently simplify outside the composed pass)
- Modify: `references/minimal-solution.md` (same)

Each composed workflow gets a short **Hygiene passes** section:

1. Resolve `composedHygienePasses` equivalent from this request (skip phrases in the spec table).
2. If no-comments is `run`, load `references/no-comments.md` **before** bug/security/spec work. Failure blocks completion.
3. After correctness work, if simplify is `run`, load `references/simplify-pr.md`. Nothing-worth-simplifying is valid.
4. If either pass changed the head, re-validate with both passes disabled.
5. Name skipped passes in the verdict/publication text.

prepare-and-merge: simplification is no longer “only if explicitly requested”; it is default-on unless opted out. no-comments is also default-on unless opted out.

create-PR paths: run after implementation / candidate validation, before or as part of pre-open. Failure blocks publication.

- [ ] **Step 1: Add a composition contract test** in `tests/unit/no-comments-contract.test.mjs` that each composed workflow file mentions `references/no-comments.md`, `references/simplify-pr.md`, and skip/opt-out.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Patch the workflow files.**
- [ ] **Step 4: Re-run composition tests — PASS.**
- [ ] **Step 5: Commit** — skip unless the user asks.

---

### Task 7: Public skill surface

**Files:**
- Modify: `SKILL.md` route table + “Simplification is explicit-only” paragraph
- Modify: `README.md` capabilities, safe simplification section, workflow map, examples
- Modify: `CHANGELOG.md` Unreleased Added/Changed
- Modify: `references/comment-depth.md` one-line distinction
- Modify: `tests/evals/regression-cases.jsonl` if expected resources need `references/no-comments.md` for full-review+simplify foreign PR

SKILL.md new row:

`| Strip source-comment alibis / no-comments PR #N | `references/no-comments.md` |`

Replace “Simplification is explicit-only; line count is never a goal or success metric.” with: no-comments and simplify run by default on full review, re-review, merge-ready/fix, and create-PR pre-open, unless the request opts out. Line count is never a goal. Bare full review still does not gain `push_code`.

README Safe simplification: default-on for those paths; opt-out examples; auto-apply on own PRs when `push_code` is already allowed; foreign report-only; line count never.

Examples to add:

```text
no-comments PR #42
full review PR #42 without simplify
full review PR #42 skip no-comments
```

- [ ] **Step 1: Extend README/SKILL contract assertions in simplify-review-contract or no-comments-contract.**
- [ ] **Step 2: FAIL, then patch docs.**
- [ ] **Step 3: `node scripts/policy-bundle.mjs --validate` must still pass (new workflow is in the SKILL.md route table and exists).**
- [ ] **Step 4: Commit** — skip unless the user asks.

---

### Task 8: Full verification

- [ ] **Step 1: Run** `npm test`
- [ ] **Step 2: Run** `node scripts/policy-bundle.mjs --validate`
- [ ] **Step 3: Run** `node scripts/workflow-brief.mjs no-comments` and `node scripts/workflow-brief.mjs full-review-pr`
- [ ] **Step 4: Run** `npm run evals:offline` if evals JSONL changed
- [ ] **Step 5: Fix any failures in-scope.**

Self-review vs spec: router, planner, workflow, agent, simplify default-on, opt-out, apply vs report, failure blocking, composition map, docs, tests A–F. No durable config. No pstack dependency.
