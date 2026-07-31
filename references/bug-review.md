# Bug review

**Trigger:** own-bug axis on merge-ready / full-review / create-PR; or explicit “bug review on pr #N”.

## Goal

Find **real** correctness bugs, silent failures, resource leaks, and edge cases on the PR (or branch) diff. Prefer high-confidence findings over checklist theater. Fix Confirmed High/Critical in-PR on merge-ready paths.

Do **not** merge unless asked.

**Bar:** run **`scripts/bug-scope.mjs`** (PR) then this method. Skip deep review only when scope says `skipDeepBugReview: true` (and say why).

## Deep multi-agent / adversarial bug kits (explicit ask only)

**Default: skip. Hardcoded never-on-own.**

Do **not** auto-launch Claude pr-review-toolkit / ultrareview fleets, Codex `adversarial-review`, or similar multi-agent audit kits. Ordinary full-review / merge-ready is **not** permission.

When (and only when) the user asks (“deep bug review”, “run pr-review-toolkit”, “adversarial review”, etc.): run that kit, keep the same confidence gate, fold into chat.

## Mandatory method (do not skip)

### 0. Scope script (required for PRs)

```bash
node "<shipping-github>/scripts/bug-scope.mjs" OWNER/REPO N
```

- If `skipDeepBugReview: true` → record **n/a** in chat (and comment templates); stop the bug axis for this PR. Do **not** invent Bugbot.
- Else cover every `requiredLenses[]` in **one** complementary pass (below).
- `requireBugbot: "when_available"` → Cursor only (see adapter).
- `deepMultiAgentDefault` is always `false`.
- Follow `instructions[]` from the JSON.

Issue-only / no PR: if reviewing local branch for create-PR, treat logic file changes like deep; docs-only like skip.

### 1. Platform adapter

Checkout PR head first (shared **Subagent preflight**).

#### Cursor

1. Launch **exactly one** `bugbot` via `review-bugbot` (`Diff: branch changes`; PR base when not default).
2. Retry once on wrong invocation / empty diff (NL diff fallback per shared rules).
3. If Bugbot is unavailable after that → say so in chat; continue with complementary only. **Do not** fake a Bugbot report.
4. Then run **§2 Complementary** (additive — even if Bugbot found nothing).

#### Claude

1. **Never** launch Task `bugbot` / claim Bugbot ran.
2. Run **§2 Complementary** in-session **or** one `generalPurpose` subagent briefed: follow this file’s lenses on branch changes vs PR base; HIGH confidence only.

#### Codex

1. **Never** claim Cursor Bugbot ran.
2. If Codex CLI `/review` (or equivalent read-only review) is available this session: run **once**, then **§2 Complementary**.
3. Else: same as Claude (complementary only).

### 2. Complementary lenses (required when not skipDeep)

**One** structured pass (parent or one helper subagent) covering all of:

| Lens | What to prove |
|---|---|
| **silent_failures** | Empty/swallowed `catch`; ignored promises; missing error paths; fail-open that hides breakage |
| **resource_leaks** | Timers/listeners/handles/connections/streams not cleaned; missing `AbortSignal` / dispose on cancel |
| **edge_cases** | Null/empty/partial collections; off-by-one bounds; races/TOCTOU on shared state; partial failure mid-batch |

On Cursor this is **additive to Bugbot** (Bugbot leans precision and can under-index leaks / silent fails).

### 3. Validate findings (confidence)

| Level | Criteria | Action |
|---|---|---|
| **HIGH** | Concrete failure path + file evidence | **Confirmed** with severity |
| **MEDIUM** | Suspicious pattern; path unclear | **Needs verification** only |
| **LOW** | Style, rename, theoretical | Residual only — Do-Not-Flag as Confirmed |

#### Do Not Flag

- Pure style / formatting / rename-only
- Test-fixture noise unless tests are the product under review
- Pre-existing issues outside the diff unless the PR clearly worsens them
- Duplicate of an already-triaged Bugbot finding (merge, don’t double-count)

Severity: Critical / High / Medium / Low / Info (same practical meaning as security-review for ship decisions).

### 4. Fix / ship guidance

On **fix-pr-bots / full-review / create-PR**:

- Fix Confirmed **High/Critical** in this PR when feasible; skip 0.1% nits.
- Prefer a regression test for fixed High/Critical; if none, state why not.

## Steps (summary)

1. Scope script → skip or deep.
2. Platform adapter (Bugbot when Cursor).
3. Complementary lenses (if deep).
4. Confidence gate → triage → fix on merge-ready paths.
5. Chat: method used (Bugbot y/n/skip, complementary done/skip), confirmed, needs verification, residual.

## Done when

- `bug-scope.mjs` run for PRs (JSON summarized)
- If skipDeep: n/a recorded with why
- Else: complementary lenses completed; on Cursor Bugbot attempted (or unavailability stated)
- No fake Bugbot on Claude/Codex
- No deep multi-agent kit unless user asked
- Confidence discipline applied; necessary High/Critical fixed or explicit residual on merge-ready paths
