# PR Session Watch-and-Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5–60 minute PR session so Hello once can cover later exact-scope `push_code` and `merge_pr` on one PR, and route autonomous watch+merge onto that path.

**Architecture:** New host grant class `pr_session` mirrors branch leases (exact-scope one-time grants, skip only the Hello prompt) but binds repo+branch+PR and allows `push_code` plus `merge_pr`. Router selects `watch-pr.md` with `merge_pr` only when the user asked both to watch autonomously and to merge. Watch hands a ready PR to `merge-pr-driver.mjs`.

**Tech Stack:** Windows Authority host (C# / WinUI / SQLite), Node `node:test` source contracts, `scripts/lib/skill-router.mjs`, `references/watch-pr.md`.

## Global Constraints

- Branch from `origin/main`. Do not stack on docs-package branches.
- Branch leases stay `push_code` only (1–10 minutes).
- Session minutes must be exactly 5, 15, 30, or 60.
- Do not implement native stack merge.
- Do not default mutation mode to autonomous.
- Do not set `authorityMode` to `off`.
- Keep the approval window at seven grid rows; reuse the existing grant card.
- TDD: failing test before production code.

## File map

- Create: `authority-host/windows/GitHubDeliveryAuthority/PrSessionScope.cs`
- Modify: `MutationClassifier.cs`, `Models.cs`, `StateStore.cs`, `AuthorityService.cs`, `ApprovalCoordinator.cs`, `ApprovalWindow.xaml.cs`, `ControlCenterWindow.xaml.cs`, `SelfTest.cs`
- Modify: `scripts/lib/skill-router.mjs`
- Modify: `references/watch-pr.md`, `references/mutation-modes.md`
- Test: `tests/unit/skill-router.test.mjs`, `tests/unit/windows-authority-branch-grants-audit.test.mjs`, `tests/unit/authority-approval-hotfix.test.mjs`

---

### Task 1: Router — autonomous watch+merge

**Files:**
- Modify: `scripts/lib/skill-router.mjs`
- Test: `tests/unit/skill-router.test.mjs`

**Interfaces:**
- Produces: `isAutonomousWatchMergeRequest(text)` used before `isPrepareAndMergeRequest`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/skill-router.test.mjs` after the existing watch auto-fix test:

```javascript
test("autonomous watch plus merge stays on watch with merge authority", () => {
  for (const prompt of [
    "watch PR #32 autonomously and merge it",
    "watch and autonomously merge PR #32",
    "watch PR #32 and merge it autonomously",
  ]) {
    const route = routeShippingGithubPrompt(prompt);
    assert.equal(route.workflow, "references/watch-pr.md", prompt);
    assert.equal(route.mutationMode, "autonomous", prompt);
    assert.ok(route.explicitActions.includes("merge_pr"), prompt);
  }
});

test("autonomous watch auto-fix plus merge also grants push_code", () => {
  const route = routeShippingGithubPrompt("watch PR #32 auto-fix and merge it");
  assert.equal(route.workflow, "references/watch-pr.md");
  assert.equal(route.mutationMode, "autonomous");
  assert.ok(route.explicitActions.includes("merge_pr"));
  assert.ok(route.explicitActions.includes("push_code"));
});
```

Keep existing tests: `watch PR #32 autonomously` has no `merge_pr`; `watch PR #77 and merge it` stays prepare-and-merge.

- [ ] **Step 2: Run** `node --test tests/unit/skill-router.test.mjs`

Expected: FAIL — actual workflow `references/prepare-and-merge-pr.md`.

- [ ] **Step 3: Implement** in `scripts/lib/skill-router.mjs` before `isPrepareAndMergeRequest` is used in `routeShippingGithubPrompt`:

```javascript
function isAutonomousWatchWording(text) {
  return /\bautonomous(ly)?\b|\bauto[- ]?fix\b|\bfix and merge without asking\b/.test(text);
}

function isAutonomousWatchMergeRequest(text) {
  return WATCH_PR_REQUEST.test(text) && hasExplicitMergeIntent(text) && isAutonomousWatchWording(text);
}
```

At the start of the watch/prepare block (before `if (isPrepareAndMergeRequest(text))`):

```javascript
  if (isAutonomousWatchMergeRequest(text)) {
    const actions = ["merge_pr"];
    if (/\bauto[- ]?fix\b/.test(text) || FIX_REVIEW_REQUEST.test(text)) actions.unshift("push_code");
    return result("references/watch-pr.md", "autonomous", actions);
  }
```

Reuse `isAutonomousWatchWording` inside the existing `WATCH_PR_REQUEST` branch.

- [ ] **Step 4: Re-run** `node --test tests/unit/skill-router.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit** `fix: route autonomous watch-and-merge onto watch with merge authority`

---

### Task 2: Host session persistence and classifier

**Files:**
- Create: `authority-host/windows/GitHubDeliveryAuthority/PrSessionScope.cs`
- Modify: `MutationClassifier.cs`, `Models.cs`, `StateStore.cs`, `SelfTest.cs`
- Test: `tests/unit/windows-authority-branch-grants-audit.test.mjs`

**Interfaces:**
- `MutationClassifier.IsPrSessionEligible(JsonElement operation)` → true iff action is `push_code` or `merge_pr`.
- `PrSessionScope.Resolve(IReadOnlyList<JsonElement> operations)` → `PrSessionKey?` (`Repo` unused here; caller has repo) with `Branch` and `Pr`.
- `StateStore.CreatePrSession(string repo, string branch, int pr, long now, int minutes)` minutes ∈ {5,15,30,60}.
- `TryUseActivePrSession(repo, branch, pr, now, operationCount)`
- `ListActivePrSessions`, `RevokePrSession`, `RecordExpiredPrSessions`

Record:

```csharp
internal sealed record PrSessionRecord(
    string SessionId,
    string Repo,
    string Branch,
    int Pr,
    long CreatedAt,
    long ExpiresAt,
    long? RevokedAt);
```

- [ ] **Step 1: Write failing Node source tests** in `tests/unit/windows-authority-branch-grants-audit.test.mjs`:

```javascript
test("pr sessions cover push and merge only for one PR at five to sixty minutes", () => {
  const classifier = read(`${host}/MutationClassifier.cs`);
  const store = read(`${host}/StateStore.cs`);
  const selfTest = read(`${host}/SelfTest.cs`);
  assert.match(classifier, /IsPrSessionEligible/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS pr_sessions/);
  assert.match(store, /minutes is not 5, 15, 30, or 60/);
  assert.match(selfTest, /pr_session_scope/);
  assert.match(selfTest, /pr_session_expiry/);
  assert.match(selfTest, /pr_session_revocation/);
});
```

Keep the existing test that branch leases never cover another action class.

- [ ] **Step 2: Run** `node --test tests/unit/windows-authority-branch-grants-audit.test.mjs`

Expected: FAIL missing `IsPrSessionEligible` / `pr_sessions`.

- [ ] **Step 3: Implement store + classifier + SelfTest fixture** mirroring `BranchLeaseAndAuditFixture` with extra assertions: other PR number misses; `post_comment` is not eligible; 7 minutes throws `pr_session_minutes_invalid`.

`pr_sessions` columns: `session_id, repo, branch, pr, created_at, expires_at, revoked_at`.

- [ ] **Step 4: Re-run the Node test** — PASS.

- [ ] **Step 5: Commit** `feat: persist revocable PR sessions for push and merge`

---

### Task 3: Host authorize path and approval UI

**Files:**
- Modify: `AuthorityService.cs`, `ApprovalCoordinator.cs`, `ApprovalWindow.xaml.cs`, `Models.cs` (`ApprovalDecision.PrSessionMinutes`, `BatchApproval.Pr`)
- Test: `tests/unit/authority-approval-hotfix.test.mjs` plus the audit test for `approvalMethod = "pr_session"` and `branch_lease_action_not_eligible` remaining for ineligible leases.

**Behavior:**

1. `var session = PrSessionScope.Resolve(operations);`
2. `sessionEligible = session is not null && operations.All(IsPrSessionEligible)`
3. Try `TryUseActivePrSession` before Hello when sessionEligible.
4. Pass `approval.Pr = session?.Pr` into the window. When `Pr` is set, retitle the existing grant card in code-behind and replace duration items with 5/15/30/60. XAML file still contains 1–10 minute items.
5. On Hello success, if `decision.PrSessionMinutes` is set, `CreatePrSession`. Do not also create a branch lease.
6. Coordinator validates session minutes ∈ {5,15,30,60}.
7. `Status()` adds `activePrSessions`.
8. Control center lists sessions with branch leases; revoke by id; `RecordExpiredPrSessions` on refresh.

- [ ] **Step 1: Failing tests** asserting `approvalMethod = "pr_session"`, `PrSessionMinutes`, ComboBox retarget in `.xaml.cs` (`Tag="15"` etc. may live in code-behind, not XAML), and `ListActivePrSessions` in ControlCenter.

- [ ] **Step 2: Run tests** — FAIL.

- [ ] **Step 3: Implement authorize + UI + control center.**

- [ ] **Step 4: Tests PASS.** Existing 1–10 minute XAML assertions still PASS.

- [ ] **Step 5: Commit** `feat: skip Hello for an active PR session on push and merge`

---

### Task 4: Watch workflow

**Files:**
- Modify: `references/watch-pr.md`
- Modify: `references/mutation-modes.md` (one paragraph under trusted authority / branch leases)

- [ ] **Step 1: Write a docs contract test** if one already greps watch-pr for merge-driver, or add assertions in an existing watch/docs test. If none exists, add to `tests/unit/natural-language-merge.test.mjs` or a small `tests/unit/watch-pr-docs.test.mjs`:

```javascript
test("autonomous watch merge uses the merge driver and waits on unknown merge state", () => {
  const watch = readFileSync(new URL("../../references/watch-pr.md", import.meta.url), "utf8");
  assert.match(watch, /merge-pr-driver\.mjs/);
  assert.match(watch, /explicitActions/);
  assert.match(watch, /push_code/);
  assert.match(watch, /pr session|pr_session/i);
});
```

- [ ] **Step 2: FAIL then document:**

When routed `explicitActions` includes `merge_pr`, after ship-gate `ready` on the current head, run `node scripts/merge-pr-driver.mjs OWNER/REPO N --mode autonomous --settle --execute`. Never a generic `merge_pr` document. Attach `pr` to every `push_code` request in this run. `UNKNOWN` merge state waits. Human exact-text, native stack, or missing session/Hello is a hard stop.

- [ ] **Step 3: PASS and commit** `docs: hand autonomous watch merge to the merge driver`

---

## Demo (after merge and host rebuild)

Throwaway PR: `watch and autonomously merge PR #N`. Hello once with session 15 minutes. Confirm `approvalMethod: pr_session` on the merge receipt. Not part of this branch’s CI.
