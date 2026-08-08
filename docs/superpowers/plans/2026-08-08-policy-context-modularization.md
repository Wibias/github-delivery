# Policy/Context Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic mandatory policy load with a small universal kernel, canonical domain modules, explicit workflow dependencies, and deterministic architecture validation without weakening existing safety behavior.

**Architecture:** Keep existing workflow filenames and natural-language routes stable. Introduce `references/policy-kernel.md` plus focused `references/policy/*.md` modules with canonical `GD-*` rule IDs, declare policy dependencies near the top of each routed workflow, and resolve/validate them through `scripts/lib/policy-bundle.mjs` + `scripts/policy-bundle.mjs`. `shared-rules.md` becomes a compatibility index rather than mandatory context; `SKILL.md` shrinks to routing/composition/loading instructions and minimal universal invariants.

**Tech Stack:** Markdown contracts, Node.js 22/24 ESM, Node test runner, existing distribution/evaluation tooling.

## Global Constraints

- Existing workflow paths and natural-language routing remain stable.
- Existing executable scripts remain authoritative for machine gates.
- Existing safety semantics must not be weakened to hit size targets.
- `SKILL.md` must shrink by at least 60% from the 32,855-byte baseline.
- Universal payload (`SKILL.md` + kernel) must shrink by at least 60% from the current `SKILL.md` + monolithic `shared-rules.md` baseline.
- Every canonical `GD-*` rule ID has exactly one definition.
- No routed workflow may require monolithic `shared-rules.md` after migration.
- Distribution/install packaging must include the new policy graph.

---

### Task 1: Policy resolver and architecture tests

**Files:**
- Create: `scripts/lib/policy-bundle.mjs`
- Create: `scripts/policy-bundle.mjs`
- Create: `tests/unit/policy-bundle.test.mjs`
- Create: `tests/unit/policy-architecture.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `resolvePolicyBundle({ root, workflow })` returning deterministic `{ workflow, workflowPath, kernelPath, modules, conditionalModules, ruleIds, bytes }`.
- Produces: architecture helpers that parse declarations/rule definitions and report duplicate/malformed IDs, missing modules/rules/routes, cycles, orphans, forbidden shared-rules dependencies, and size-budget failures.

- [ ] **Step 1: Write failing tests** for deterministic resolution, missing module/rule errors, duplicate IDs, malformed IDs, route existence, cycle detection, orphan detection, shared-rules prohibition, and size budgets.
- [ ] **Step 2: Commit tests only** and confirm CI fails for missing resolver/module architecture.
- [ ] **Step 3: Implement parser/resolver/validator** without dynamically interpreting policy prose.
- [ ] **Step 4: Confirm focused resolver tests pass.**

### Task 2: Canonical kernel and policy modules

**Files:**
- Create: `references/policy-kernel.md`
- Create: `references/policy/mutation.md`
- Create: `references/policy/evidence.md`
- Create: `references/policy/git.md`
- Create: `references/policy/ci.md`
- Create: `references/policy/reviews.md`
- Create: `references/policy/issues.md`
- Create: `references/policy/stacks.md`
- Create: `references/policy/releases.md`
- Create: `references/policy/publication.md`

**Interfaces:**
- Policy files use headings `### GD-<DOMAIN>-NNN — <name>` for canonical definitions.
- Optional module dependencies use `Policy dependencies:` declarations only when genuinely required.

- [ ] **Step 1: Extract universal invariants** into a small kernel with `GD-CORE-*` IDs.
- [ ] **Step 2: Extract cross-workflow mutation/evidence/git/CI/review/issue/stack/release/publication rules** into their narrowest module, preserving stricter existing behavior where wording differs.
- [ ] **Step 3: Run architecture tests** to prove IDs are unique and modules are reachable.

### Task 3: Workflow dependency declarations and compatibility index

**Files:**
- Modify: routed `references/*.md` workflow files from the `SKILL.md` route table.
- Modify: `references/shared-rules.md`

**Interfaces:**
- Each workflow begins with a machine-readable block:
  `Policy modules:` followed by `- policy-kernel`, `- <module>`, and optional `- <module> (when <observable condition>)`.
- `shared-rules.md` becomes an index pointing to canonical modules and is not listed as mandatory context.

- [ ] **Step 1: Add precise module declarations** to each routed workflow based on its actual operations.
- [ ] **Step 2: Replace repeated cross-workflow rule prose with canonical `GD-*` references where safe, retaining workflow-specific sequencing.**
- [ ] **Step 3: Reduce `shared-rules.md` to compatibility/index text pointing to the policy graph.**
- [ ] **Step 4: Run architecture + existing documentation/route tests.**

### Task 4: Shrink `SKILL.md` and preserve routing contracts

**Files:**
- Modify: `SKILL.md`
- Modify: route/documentation tests only where they assert moved canonical policy text by location rather than behavior.

**Interfaces:**
- `SKILL.md` contains frontmatter, route table, composition rules, policy-loading contract, minimal `GD-CORE-*` references, and assertion anchors required by router tests.

- [ ] **Step 1: Rewrite `SKILL.md`** to remove duplicated policy manual content while preserving route rows and composition behavior.
- [ ] **Step 2: Ensure size-budget tests prove at least 60% reduction.**
- [ ] **Step 3: Migrate location-sensitive assertions to canonical policy files without dropping behavioral coverage.**

### Task 5: Packaging and full verification

**Files:**
- Modify: `scripts/lib/distribution.mjs` / installer manifests only if the existing recursive packaging does not already include new policy files.
- Modify: `package.json` test/check commands.

**Interfaces:**
- Built/installed skill resolves the same policy graph as repository source.

- [ ] **Step 1: Run distribution and installer tests** and patch packaging only if they reveal omissions.
- [ ] **Step 2: Run router/eval/mutation/ship-gate/review/stack/release/documentation tests affected by policy moves.**
- [ ] **Step 3: Run `npm run check` and final repository CI/CodeQL.**
- [ ] **Step 4: Record baseline/final byte counts in architecture-test output and update PR #92 body with exact results.**
