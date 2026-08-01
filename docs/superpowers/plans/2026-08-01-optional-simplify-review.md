# Optional Simplify Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit, behavior-preserving simplification workflow that can run standalone or as an optional phase of full PR review, followed by mandatory full re-review on the changed head.

**Architecture:** Add one authoritative workflow reference, `references/simplify-pr.md`. Route explicit simplify requests to it from `SKILL.md`, and compose it from `references/full-review-pr.md` only when the user explicitly requests simplification. Contract tests enforce opt-in activation, approval before mutation, behavior-preservation boundaries, automatic validation and full re-review, and a non-recursive final verdict.

**Tech Stack:** Markdown Agent Skill workflows, Node.js built-in test runner, repository contract tests.

## Global Constraints

- Reducing line count is never a goal by itself.
- Preserve behavior, APIs, errors, ordering, concurrency, output, UI, persistence, compatibility, security, and fail-closed semantics.
- Never weaken validation, error handling, tests, security checks, CI, authorization, evidence, or ship-gate authority.
- Apply simplifications only after explicit user approval.
- Automatically run focused validation, required repository gates, and the complete full-review workflow on the new head.
- Do not run a recursive second simplification pass during mandatory re-review.
- Report `nothing worth simplifying` instead of manufacturing edits.

---

### Task 1: Add blocking workflow contracts

**Files:**
- Modify: `tests/unit/final-roadmap-acceptance.test.mjs`

**Interfaces:**
- Consumes: repository Markdown files.
- Produces: a contract test that fails until routing and workflow text satisfy the design.

- [ ] **Step 1: Write the failing test**

Append a test that asserts:

```js
test("simplification is explicit, behavior-preserving, and followed by full re-review", () => {
  const skill = readFileSync(new URL("../../SKILL.md", import.meta.url), "utf8");
  const fullReview = readFileSync(new URL("../../references/full-review-pr.md", import.meta.url), "utf8");
  const simplifyUrl = new URL("../../references/simplify-pr.md", import.meta.url);

  assert.ok(existsSync(simplifyUrl), "expected simplify workflow");
  const simplify = readFileSync(simplifyUrl, "utf8");

  assert.match(skill, /references\/simplify-pr\.md/);
  assert.match(fullReview, /explicitly asks/i);
  assert.match(fullReview, /explicit approval/i);
  assert.match(fullReview, /complete full-review workflow/i);
  assert.match(fullReview, /post-simplification head/i);
  assert.match(fullReview, /no recursive simplification/i);
  assert.match(simplify, /line count is never/i);
  assert.match(simplify, /nothing worth simplifying/i);
  assert.match(simplify, /behavior/i);
  assert.match(simplify, /revert.*individually/i);
  assert.match(simplify, /validation/i);
  assert.match(simplify, /security/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/unit/final-roadmap-acceptance.test.mjs
```

Expected: FAIL because `references/simplify-pr.md` and the integration contract do not yet exist.

- [ ] **Step 3: Commit the red contract**

```bash
git add tests/unit/final-roadmap-acceptance.test.mjs
git commit -m "test: require optional simplify review contract"
```

---

### Task 2: Add the authoritative simplify workflow

**Files:**
- Create: `references/simplify-pr.md`

**Interfaces:**
- Consumes: an explicit simplify request, the currently reviewed PR comparison, repository standards, and available validation commands.
- Produces: candidate-only output before approval, bounded approved mutations, validation evidence, and a handoff to mandatory full re-review.

- [ ] **Step 1: Define activation and scope**

Document that the workflow activates only on explicit simplify/cleanup/deduplicate requests, remains off for normal full review, and examines only the PR diff plus directly necessary adjacent code.

- [ ] **Step 2: Define candidate criteria**

Require each candidate to include location, maintainability problem, proposed change, preserved invariants, risk, and focused validation. Allow proven dead-code removal, simpler control flow, redundant-wrapper removal, genuine deduplication, unnecessary-indirection removal, and native/repository-standard replacements when equivalence is clear.

- [ ] **Step 3: Define rejection boundaries**

Forbid behavior/API/error/order/concurrency/output/UI/persistence/compatibility changes; weaker validation, tests, security, CI, authorization, evidence, or fail-closed behavior; clever compression; speculative abstractions; broad unrelated refactors; and uncertain equivalence.

- [ ] **Step 4: Define approval and execution**

If no candidates exist, report `nothing worth simplifying` and return to the caller. Otherwise present the bounded list and require explicit approval. Apply only approved candidates. Failed candidates are reverted individually.

- [ ] **Step 5: Define validation and re-review**

Run candidate-focused tests first, then repository-required gates. After a changed head is pushed, automatically rerun the complete full-review workflow on the new head with simplification disabled. Do not ask a second continuation question and do not recursively simplify again.

- [ ] **Step 6: Run the focused contract test**

```bash
node --test tests/unit/final-roadmap-acceptance.test.mjs
```

Expected: still FAIL until routing and full-review composition are added.

- [ ] **Step 7: Commit**

```bash
git add references/simplify-pr.md
git commit -m "feat(review): add safe simplify workflow"
```

---

### Task 3: Compose simplify into routing and full review

**Files:**
- Modify: `SKILL.md`
- Modify: `references/full-review-pr.md`

**Interfaces:**
- Consumes: explicit simplify request language.
- Produces: standalone routing and an optional full-review phase that resumes automatically after approval.

- [ ] **Step 1: Add routing**

Add `simplify`, `cleanup`, `deduplicate`, and `full review + simplify` to the skill description and route table, pointing to `references/simplify-pr.md`. Add the file to the references index.

- [ ] **Step 2: Add a hard rule**

State that simplification is explicit-only, behavior preservation and lower cognitive load are the goals, line count is not a success metric, and it cannot weaken any review or ship gate.

- [ ] **Step 3: Add the optional full-review phase**

After the initial bug/security/spec/comment/base/CI work is clean but before the final verdict, run `references/simplify-pr.md` only when explicitly requested. Hold the verdict while candidates await approval. If approved changes are applied, validate and rerun the complete full-review workflow on the post-simplification head with simplification disabled. Publish the final verdict only from that head.

- [ ] **Step 4: Prevent loops and extra prompts**

State that approval automatically resumes application, validation, full re-review, and verdict. No second continuation prompt and no recursive simplification pass are allowed.

- [ ] **Step 5: Run focused and full validation**

```bash
node --test tests/unit/final-roadmap-acceptance.test.mjs
npm test
npm run check
```

Expected: all commands PASS.

- [ ] **Step 6: Commit**

```bash
git add SKILL.md references/full-review-pr.md
git commit -m "feat(review): integrate optional simplify pass"
```

---

### Task 4: Final verification and PR

**Files:**
- Verify all changed files.

**Interfaces:**
- Consumes: completed branch.
- Produces: reviewed draft PR with evidence.

- [ ] **Step 1: Inspect final diff**

Confirm the change is limited to the design/plan, one workflow reference, routing/full-review documentation, and one contract test.

- [ ] **Step 2: Run complete gates**

```bash
npm run check
```

Expected: PASS with no warnings or skipped required gates.

- [ ] **Step 3: Open a draft PR**

Use title:

```text
feat(review): add optional safe simplification pass
```

The PR body must explain opt-in activation, explicit approval, behavior-preserving constraints, automatic full re-review, non-recursion, TDD evidence, and validation.