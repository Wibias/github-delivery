# Bootstrap Runtime UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make npm bootstrap commands human-readable and live during updates, and make Windows Authority startup claims reflect real runtime readiness with durable crash diagnostics.

**Architecture:** Keep machine-readable receipts internal by default and render user-facing summaries at the CLI boundary. Thread a small progress callback through the update path instead of coupling installer internals to stdout. Treat the Authority named-pipe `status` response as the stable readiness boundary; log host startup exceptions locally so a failed process has actionable evidence.

**Tech Stack:** Node.js ESM CLI/tests, Windows named pipes, .NET 8 / WinUI 3 Authority host, GitHub Actions Windows CI.

## Global Constraints

- `doctor --json` remains the explicit raw machine-readable mode.
- `update` stays dry-run by default; `--apply` remains required for mutation.
- No release, tag, version bump, or gate weakening in this change.
- Authority startup must not report success until the host answers `status` with `status: ready`.
- Startup diagnostics must live under `%LOCALAPPDATA%\\GitHubDeliveryAuthority` and must not expose secrets beyond the local exception text already produced by the host.

---

### Task 1: Pin the user-facing CLI contract

**Files:**
- Create: `tests/unit/bootstrap-runtime-ux.test.mjs`
- Modify: `scripts/github-delivery-cli.mjs`

- [ ] Add failing tests proving `update` and `autostart` render human summaries without raw JSON.
- [ ] Add a failing test proving `update --apply` receives staged progress before the final result.
- [ ] Implement update/autostart routing and concise update progress/final rendering.
- [ ] Run the focused Node tests and then the repository check.

### Task 2: Make Authority start readiness-based

**Files:**
- Modify: `tests/unit/authority-host-install.test.mjs`
- Modify: `scripts/lib/authority-host-install.mjs`
- Modify: `scripts/lib/bootstrap-maintenance.mjs`

- [ ] Add failing tests where spawn succeeds but readiness never arrives, and where a `status: ready` probe succeeds.
- [ ] Poll the existing Authority `status` named-pipe contract after spawn; return failure with a diagnostics path when the child exits or readiness times out.
- [ ] Await the readiness result from explicit `start` and setup/guided callers.
- [ ] Run focused tests and repository check.

### Task 3: Preserve startup crash evidence

**Files:**
- Create: `authority-host/windows/GitHubDeliveryAuthority/StartupDiagnostics.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/Program.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/App.xaml.cs`
- Modify: `.github/workflows/ci.yml`
- Create: `tests/unit/authority-startup-diagnostics-contract.test.mjs`

- [ ] Add a failing contract test requiring Program/App exception wiring and a local `startup-error.log`.
- [ ] Add best-effort diagnostic logging for top-level, AppDomain, and WinUI unhandled startup failures without marking exceptions handled.
- [ ] Clear stale startup diagnostics at a new launch so reported evidence belongs to the latest attempt.
- [ ] Execute the published self-contained Authority EXE with `--self-test` in Windows CI after publish, not only the build output.
- [ ] Run Node tests, .NET build/self-test, and full CI.

### Task 4: Final verification

- [ ] Confirm the PR changes only the planned bootstrap/runtime files.
- [ ] Confirm Node 22/24/26 CI, Windows Authority checks, architecture contracts, Dependency Review, and CodeQL are green.
- [ ] Keep the PR open for human merge; do not tag or release.