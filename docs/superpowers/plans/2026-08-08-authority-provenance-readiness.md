# Trusted Authority Provenance Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real Ed25519 host-issued authority-grant verification path while preserving compatibility and making caller-asserted authority explicit.

**Architecture:** `scripts/lib/authority-grant.mjs` owns token parsing, signature verification, schema/scope/time/mode/body binding, and provenance classification. `github-mutation-broker.mjs` consumes only the verifier result and exposes it in mutation-plan receipts; an opt-in trusted-only setting fails closed before a GitHub command is planned. No private signing key or durable replay store exists in this repository.

**Tech Stack:** Node.js 22/24 ESM, `node:crypto` Ed25519 verification, Node test runner.

## Global Constraints

- Token format is `gd1.<base64url-json-payload>.<base64url-ed25519-signature>`.
- Audience is exactly `github-delivery`.
- No private signing-key support may be added.
- No caller-controlled field may manufacture `trusted_grant` provenance.
- Compatibility mode keeps existing caller assertions working but classifies them as `caller_asserted`.
- Trusted-only mode rejects absent or invalid grants before mutation command planning/execution.
- Exact-text grants bind `exactTextSha256`.
- Replay protection is explicitly limited to short TTL/resource/head binding; no durable nonce-consumption claim.

---

### Task 1: Authority grant verifier

**Files:**
- Create: `scripts/lib/authority-grant.mjs`
- Create: `tests/unit/authority-grant.test.mjs`

**Interfaces:**
- Produces: `verifyAuthorityGrant({ token, publicKey, request, now, maxTtlSeconds, clockSkewSeconds })` returning `{ provenance, verified, claims, reason }` and throwing only for programmer/configuration misuse.
- Produces: `classifyAuthority({ request, token, publicKey, requireTrusted, now })` returning a normalized authority receipt or throwing `trusted_authority_required:<reason>` when enforcement requires trust.

- [ ] **Step 1: Write failing tests** for valid generated Ed25519 grants plus malformed token, bad signature, wrong audience/repo/action/resource/head, expired/not-yet-valid/overlong TTL, overpowered mutation mode, and exact-text hash mismatch.
- [ ] **Step 2: Commit the tests only** and confirm repository CI fails because `scripts/lib/authority-grant.mjs` is missing / exports are unavailable.
- [ ] **Step 3: Implement the verifier** with strict base64url token parsing, exact signed bytes, `crypto.verify(null, ...)`, version/schema checks, bounded mode ordering, time checks, and request-scope comparisons.
- [ ] **Step 4: Re-run focused CI** and confirm the authority-grant tests pass.

### Task 2: Broker integration and trusted-only enforcement

**Files:**
- Modify: `scripts/lib/github-mutation-broker.mjs`
- Modify: `tests/unit/github-mutation-broker.test.mjs`
- Modify: `scripts/github-mutate.mjs`

**Interfaces:**
- Broker consumes optional request field `authorityGrant` and verifier configuration supplied through execution options/environment.
- Mutation-plan receipt adds `authority` with provenance `caller_asserted` or `trusted_grant`.
- CLI reads `GITHUB_DELIVERY_AUTHORITY_PUBLIC_KEY` and `GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1` only; request payload cannot enable trusted status.

- [ ] **Step 1: Add failing broker tests** proving caller flags alone produce `caller_asserted`, a fake `trusted` request field has no effect, valid grants produce `trusted_grant`, grant-without-key fails verification, and trusted-only mode blocks before command planning.
- [ ] **Step 2: Confirm RED** on the branch CI.
- [ ] **Step 3: Integrate authority classification** before `authorizeMutation()`/command planning, bound effective mode/explicit/exact-text inputs to verified claims, and expose a redacted authority receipt without token/signature/private material.
- [ ] **Step 4: Update CLI configuration plumbing** without adding private-key support.
- [ ] **Step 5: Confirm GREEN** for focused broker + authority tests.

### Task 3: Documentation and repository contract

**Files:**
- Modify: `references/github-mutation-broker.md`
- Modify: `docs/repository-security.md`
- Modify: `package.json`
- Modify: `tests/unit/mutation-policy.test.mjs` only if existing assertions need the new provenance terminology.

**Interfaces:**
- Documentation states caller assertions are policy inputs, not independently authenticated user consent.
- `npm test` and `npm run check` include the new test/source file.

- [ ] **Step 1: Add/update documentation assertions where needed.**
- [ ] **Step 2: Add the new unit test to `package.json` test command and new source/test files to syntax checks.**
- [ ] **Step 3: Run full repository CI and CodeQL on the final PR head.**
- [ ] **Step 4: Update PR #91 body from design-only to implementation summary with exact verification evidence.**
