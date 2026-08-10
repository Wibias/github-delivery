# Token-Efficient Mutation Entrypoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make routine brokered GitHub writes one-call and batch-capable while preserving exact-scope trusted authority, redemption, idempotency, freshness, and verification.

**Architecture:** Add a small document execution layer above the existing broker stack. It normalises single/batch inputs, refreshes exact PR heads, obtains one authority batch for only the operations that need grants, and then executes the existing mutation requests in order. The execution context also resolves installer-defined Windows authority defaults when a stale process lacks the installer-written environment variables.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing GitHub CLI/broker stack, Windows named-pipe authority host.

## Global Constraints

- No mutation safety gate may be removed or weakened.
- High-assurance writes still require exact-scope trusted grants and one-time redemption.
- Existing single-request callers keep the same input and output shape.
- Dry-run must never trigger Windows Hello.
- Explicit authority environment variables override discovered defaults.
- Batch execution is ordered and stops at the first failed operation.
- Do not add wildcard/session authority or retry consumed/ambiguous writes.

---

### Task 1: Mutation document contract

**Files:**
- Create: `scripts/lib/mutation-document-execution.mjs`
- Test: `tests/unit/mutation-document-execution.test.mjs`

**Interfaces:**
- Produces: `requestsFromMutationDocument(document)`, `executeMutationDocument(options)`.
- Consumes: existing `refreshExpectedHeads`, `authorizeBatchSync`, `attachAuthorityGrants`, `stampAuthorizedReviewVerdicts`, `mutationRequiresTrustedAuthority`, and `executeMutationWithAuthority`.

- [ ] **Step 1: Write failing tests for accepted document shapes**

Assert one object, an array, `{ operations: [...] }`, and `{ requests: [...] }` all preserve ordered mutation requests. Invalid/empty documents must throw `mutation_document_requests_required`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/unit/mutation-document-execution.test.mjs`
Expected: FAIL because `scripts/lib/mutation-document-execution.mjs` does not exist.

- [ ] **Step 3: Implement normalisation only**

Return cloned ordered requests plus whether the original input was singular. Do not mutate caller objects.

- [ ] **Step 4: Add failing tests for automatic authority batching**

Inject fake `requiresTrustedAuthority`, `refreshHeads`, `authorize`, `attach`, `stamp`, and `executeOne` functions. Assert dry-run never authorises; execution authorises only missing high-assurance grants; existing grants are preserved; refreshed values are passed to approval and execution.

- [ ] **Step 5: Implement automatic authority batching and ordered execution**

Use one batch approval for missing grants. Merge issued grants back by original request index. Execute in order. Return the existing single receipt for singular input and `{ batch: true, results: [...] }` for multi-request input.

- [ ] **Step 6: Add failure-order test**

Make operation 2 throw and assert operation 3 is never executed.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `node --test tests/unit/mutation-document-execution.test.mjs`
Expected: PASS.

### Task 2: Windows authority runtime defaults

**Files:**
- Modify: `scripts/lib/mutation-execution-context.mjs`
- Test: `tests/unit/mutation-execution-context.test.mjs`

**Interfaces:**
- Extend: `authorityVerifierConfiguration(options)` with injectable `platform`, `exists`, and path resolution for tests.
- Produce: `authorityRuntimeEnvironment(options)` or equivalent small helper used by execution.

- [ ] **Step 1: Add failing tests for stale-process recovery**

On injected `win32`, with `LOCALAPPDATA=C:\\Users\\me\\AppData\\Local`, no authority env values, and an existing standard trust store, assert the trust-store path and default pipe are resolved. Assert explicit env values win.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/unit/mutation-execution-context.test.mjs`
Expected: new assertions fail because defaults are not resolved.

- [ ] **Step 3: Implement minimal runtime discovery**

Use `%LOCALAPPDATA%/GitHubDeliveryAuthority/trust-store.json` only on Windows and only when the file exists. Use `DEFAULT_AUTHORITY_PIPE` on Windows when no explicit pipe exists. Keep non-Windows behavior unchanged.

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `node --test tests/unit/mutation-execution-context.test.mjs`
Expected: PASS.

### Task 3: One-call CLI

**Files:**
- Modify: `scripts/github-mutate.mjs`
- Modify: `package.json`
- Test: `tests/unit/mutation-document-execution.test.mjs`

**Interfaces:**
- `github-mutate.mjs` reads the JSON document once and delegates to `executeMutationDocument`.
- Existing `--request`, `--execute`, and `--audit` flags remain unchanged.

- [ ] **Step 1: Wire the CLI to the document executor**

The CLI must not call `executeMutationWithAuthority` directly. Audit output remains one JSON line per invocation. Single-request stdout stays backward compatible.

- [ ] **Step 2: Add syntax checking for the new module/test**

Extend `npm run check` with `node --check scripts/lib/mutation-document-execution.mjs` and the new test file.

- [ ] **Step 3: Syntax-check changed JavaScript**

Run: `node --check scripts/github-mutate.mjs && node --check scripts/lib/mutation-document-execution.mjs && node --check scripts/lib/mutation-execution-context.mjs`
Expected: exit 0.

### Task 4: Compact issue-to-PR execution contract

**Files:**
- Modify: `references/create-pr-for-issue.md`
- Modify: `references/policy/mutation.md`
- Modify: `SKILL.md`
- Create: `tests/unit/token-efficient-workflow-contract.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Workflow remains at the same routed path, preserving router compatibility.
- Policy states that routine callers invoke `github-mutate.mjs` once per mutation document and do not manually orchestrate authority internals.

- [ ] **Step 1: Write failing contract test**

Assert the workflow keeps required preflight, issue-thread, screenshot, implementation, pre-open gate, canonical publication, linkage, merge-ready, and no-merge requirements. Also assert it does not contain manual `github-authorize.mjs`, trust-store, named-pipe, grant-redemption, or inline mutation JSON choreography.

- [ ] **Step 2: Run focused contract test and verify RED**

Run: `node --test tests/unit/token-efficient-workflow-contract.test.mjs`
Expected: FAIL because the current workflow contains manual broker choreography.

- [ ] **Step 3: Rewrite the workflow as a compact state machine**

Keep policy-module declaration and all outcome gates. Replace request-shape tutorials with action names and the one-call mutation entrypoint.

- [ ] **Step 4: Update policy and entrypoint prose**

Document that `github-mutate.mjs --execute` owns authority acquisition/attachment/redemption setup for routine execution. Backend inspection is for actual entrypoint failure or explicit audit/debug work only.

- [ ] **Step 5: Add syntax checking for the contract test and run it GREEN**

Run: `node --test tests/unit/token-efficient-workflow-contract.test.mjs`
Expected: PASS.

### Task 5: Repository validation and PR

**Files:**
- No new production files beyond Tasks 1-4.

- [ ] **Step 1: Run focused tests**

Run:
`node --test tests/unit/mutation-document-execution.test.mjs tests/unit/mutation-execution-context.test.mjs tests/unit/token-efficient-workflow-contract.test.mjs`
Expected: PASS.

- [ ] **Step 2: Run repository validation**

Run: `npm run check`
Expected: PASS on supported Node versions.

- [ ] **Step 3: Review the final diff for authority weakening**

Confirm the change only moves orchestration above existing authority/broker code and does not bypass action registry, grant verification, redemption, idempotency, or post-write verification.

- [ ] **Step 4: Open a PR**

Use a concise PR body with before/after agent call counts, safety invariants, and test evidence.
