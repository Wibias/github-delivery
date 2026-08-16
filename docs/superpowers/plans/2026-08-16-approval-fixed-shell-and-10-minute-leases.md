# Approval Fixed Shell and 10-Minute Leases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 0.8.1 ApprovalWindow so the main window never scrolls, only the proposed-action text scrolls, and temporary exact-branch leases can be selected for 1 through 10 minutes.

**Architecture:** Replace the current outer body ScrollViewer with a seven-row fixed Grid shell whose action-content row is the only star-sized region. Keep ActionScrollViewer inside that row so it consumes the remaining height and owns all vertical scrolling. Extend the existing branch-lease duration contract consistently at the UI, ApprovalWindow validation, coordinator validation, and persistence validation boundaries without changing exact repo/branch matching or grant semantics.

**Tech Stack:** .NET 8, WinUI 3, Windows App SDK, C# 12, XAML, Microsoft.Data.Sqlite, Node.js built-in test runner, GitHub Actions `windows-latest`.

## Global Constraints

- Target release remains `0.8.1`.
- Minimum approval-window width is exactly `560 px`.
- Minimum approval-window height is exactly `640 px`.
- Minimum proposed-action viewport height is exactly `110 px`.
- The approval main window must never need a vertical ScrollViewer.
- `ActionScrollViewer` is the only vertically scrollable approval-content region.
- The temporary exact-branch lease range is `1` through `10` whole minutes inclusive.
- `1 minute` remains the default lease duration.
- Lease scope remains exact repository plus exact branch.
- Windows Hello, signed scope, redemption, and fail-closed mutation semantics must not be weakened.
- Do not add a PIN fallback or bypass Windows Hello.

---

## File Structure

- Modify `tests/unit/authority-approval-hotfix.test.mjs`: regression contract for fixed-shell XAML, exact minimum sizing, and 1-10 minute lease selector/validation.
- Modify `tests/unit/windows-authority-branch-grants-audit.test.mjs`: branch-lease persistence/coordinator upper-bound contract.
- Modify `authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml`: seven-row fixed shell and 1-10 minute ComboBox options.
- Modify `authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml.cs`: set 560x640 minimum size and accept selected lease values through 10.
- Modify `authority-host/windows/GitHubDeliveryAuthority/ApprovalCoordinator.cs`: reject lease durations outside 1-10.
- Modify `authority-host/windows/GitHubDeliveryAuthority/StateStore.cs`: persist lease durations only inside 1-10.
- Modify `authority-host/windows/README.md`: document the new 1-10 minute range.
- Modify `README.md` only where it still states the old 1-5 minute range.
- Keep `.github/workflows/authority-hotfix-test.yml` as the temporary Windows validation path for this test branch until the user confirms the build manually.

---

### Task 1: Lock the new approval layout and lease-duration contract with failing tests

**Files:**
- Modify: `tests/unit/authority-approval-hotfix.test.mjs`
- Modify: `tests/unit/windows-authority-branch-grants-audit.test.mjs`

**Interfaces:**
- Consumes: current XAML/source files as text.
- Produces: source-level regression tests that fail on the existing outer ScrollViewer, 480 px minimum height, 5-minute UI cap, and 5-minute validation cap.

- [ ] **Step 1: Replace the current outer-scroll assertion with fixed-shell assertions**

Use assertions equivalent to:

```js
assert.doesNotMatch(xaml, /x:Name="ApprovalBodyScrollViewer"/);
assert.match(
  xaml,
  /<Grid.RowDefinitions>[\s\S]*?<RowDefinition Height="Auto"\s*\/>[\s\S]*?<RowDefinition Height="Auto"\s*\/>[\s\S]*?<RowDefinition Height="Auto"\s*\/>[\s\S]*?<RowDefinition Height="\*"\s*\/>/,
);
assert.match(xaml, /x:Name="ActionScrollViewer"[\s\S]*MinHeight="110"[\s\S]*VerticalScrollBarVisibility="Auto"/);
assert.doesNotMatch(xaml, /x:Name="ActionScrollViewer"[^>]*MaxHeight=/);
```

Also assert the fixed controls and footer appear outside the `ActionScrollViewer` block by checking the action ScrollViewer closes before the Security and Branch Grant elements.

- [ ] **Step 2: Add exact minimum-size source assertions**

Read `ApprovalWindow.xaml.cs` and assert:

```js
assert.match(windowCode, /TrySetMinimumWindowSize\(560,\s*640\)/);
```

This must fail against the current `TrySetMinimumWindowSize(560, 480)` implementation.

- [ ] **Step 3: Add 1-through-10 ComboBox contract assertions**

Assert that all ten options exist and no `11 min` option exists:

```js
for (let minute = 1; minute <= 10; minute += 1) {
  assert.match(xaml, new RegExp(`Content="${minute} min"\\s+Tag="${minute}"`));
}
assert.doesNotMatch(xaml, /Content="11 min"/);
```

Keep `SelectedIndex="0"` as the default-selection assertion.

- [ ] **Step 4: Add validation-boundary assertions**

Read `ApprovalWindow.xaml.cs`, `ApprovalCoordinator.cs`, and `StateStore.cs`. Assert each uses an inclusive upper bound of 10 and no longer uses `> 5` / `<= 5` for branch-lease minutes.

For example:

```js
assert.match(windowCode, /minutes is >= 1 and <= 10/);
assert.match(coordinator, /minutes < 1 \|\| minutes > 10/);
assert.match(store, /minutes is < 1 or > 10/);
```

- [ ] **Step 5: Run the targeted Node tests and confirm RED**

Run:

```bash
node --test tests/unit/authority-approval-hotfix.test.mjs tests/unit/windows-authority-branch-grants-audit.test.mjs
```

Expected: FAIL because the branch still contains `ApprovalBodyScrollViewer`, `MaxHeight="340"`, minimum height `480`, only options 1-5, and 5-minute validation limits.

- [ ] **Step 6: Commit the red tests**

```bash
git add tests/unit/authority-approval-hotfix.test.mjs tests/unit/windows-authority-branch-grants-audit.test.mjs
git commit -m "test: lock approval fixed shell and ten minute leases"
```

---

### Task 2: Implement the fixed ApprovalWindow shell

**Files:**
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml.cs`

**Interfaces:**
- Consumes: existing `RepositoryText`, `ActionText`, `ActionScrollViewer`, `BranchGrantText`, `BranchGrantControls`, `BranchGrantDuration`, `BranchGrantToggle`, `ApproveButton`, and `CancelButton` names used by code/tests.
- Produces: the same named controls and event handlers, but with a fixed seven-row shell and only one vertical scroll region.

- [ ] **Step 1: Replace the root three-row shell and outer body ScrollViewer with seven rows**

The root layout must use:

```xml
<Grid.RowDefinitions>
    <RowDefinition Height="Auto" />
    <RowDefinition Height="Auto" />
    <RowDefinition Height="Auto" />
    <RowDefinition Height="*" />
    <RowDefinition Height="Auto" />
    <RowDefinition Height="Auto" />
    <RowDefinition Height="Auto" />
</Grid.RowDefinitions>
```

Place the controls as follows:

```text
row 0  HeaderPanel
row 1  repository card
row 2  Proposed action label
row 3  proposed-action Border containing ActionScrollViewer
row 4  Security card
row 5  branch-grant card
row 6  footer buttons
```

Delete `ApprovalBodyScrollViewer` completely. Do not introduce another ScrollViewer around rows 0-6.

- [ ] **Step 2: Make the action region consume remaining height**

Use a dedicated action Border in row 3 and configure the existing ScrollViewer as:

```xml
<ScrollViewer x:Name="ActionScrollViewer"
              MinHeight="110"
              VerticalScrollBarVisibility="Auto"
              HorizontalScrollBarVisibility="Disabled"
              HorizontalContentAlignment="Stretch">
    <TextBlock x:Name="ActionText"
               TextWrapping="Wrap"
               FontWeight="SemiBold"
               IsTextSelectionEnabled="True" />
</ScrollViewer>
```

Remove `MaxHeight="340"`. The star row, not a hard-coded maximum, controls the viewport height.

- [ ] **Step 3: Preserve narrow/wide branch-control states**

Keep the existing `NarrowApprovalState` and `WideApprovalState` setters for `BranchGrantText` and `BranchGrantControls`. The branch card remains in row 5 and its internal two-row Grid continues to allow controls to move below the text below 680 px width.

- [ ] **Step 4: Set the exact minimum window size**

In `ApprovalWindow.xaml.cs`, replace:

```csharp
TrySetMinimumWindowSize(560, 480);
```

with:

```csharp
TrySetMinimumWindowSize(560, 640);
```

Keep the initial resize at `820 x 760` unless Windows XAML validation demonstrates that the default shell needs a different initial size. Do not lower either minimum.

- [ ] **Step 5: Update the minimum-sizing fallback comment**

The catch comment must no longer claim that outer scrolling keeps controls reachable. Use a truthful best-effort statement such as:

```csharp
// Minimum sizing is best effort. The fixed shell expects the configured minimum dimensions.
```

- [ ] **Step 6: Run the approval hotfix test**

```bash
node --test tests/unit/authority-approval-hotfix.test.mjs
```

Expected: layout and minimum-size assertions PASS; lease-duration assertions may still fail until Task 3.

- [ ] **Step 7: Commit the fixed-shell implementation**

```bash
git add authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml.cs
git commit -m "fix: keep approval shell fixed around action scroll"
```

---

### Task 3: Extend exact-branch leases from 5 to 10 minutes

**Files:**
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ApprovalCoordinator.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/StateStore.cs`
- Test: `tests/unit/authority-approval-hotfix.test.mjs`
- Test: `tests/unit/windows-authority-branch-grants-audit.test.mjs`

**Interfaces:**
- Consumes: `ApprovalDecision.BranchLeaseMinutes`, `StateStore.CreateBranchLease(string repo, string branch, long now, int minutes)`.
- Produces: the same interfaces with a widened valid range of 1-10 inclusive. No storage schema change is required.

- [ ] **Step 1: Add ComboBox options 6 through 10**

The completed list must be exactly:

```xml
<ComboBoxItem Content="1 min" Tag="1" />
<ComboBoxItem Content="2 min" Tag="2" />
<ComboBoxItem Content="3 min" Tag="3" />
<ComboBoxItem Content="4 min" Tag="4" />
<ComboBoxItem Content="5 min" Tag="5" />
<ComboBoxItem Content="6 min" Tag="6" />
<ComboBoxItem Content="7 min" Tag="7" />
<ComboBoxItem Content="8 min" Tag="8" />
<ComboBoxItem Content="9 min" Tag="9" />
<ComboBoxItem Content="10 min" Tag="10" />
```

Keep `SelectedIndex="0"`.

- [ ] **Step 2: Widen ApprovalWindow selection validation**

Change:

```csharp
minutes is >= 1 and <= 5
```

to:

```csharp
minutes is >= 1 and <= 10
```

- [ ] **Step 3: Widen coordinator validation**

Change:

```csharp
if (decision.BranchLeaseMinutes is int minutes && (minutes < 1 || minutes > 5))
```

to:

```csharp
if (decision.BranchLeaseMinutes is int minutes && (minutes < 1 || minutes > 10))
```

- [ ] **Step 4: Widen persistence validation**

In `StateStore.CreateBranchLease`, change:

```csharp
if (minutes is < 1 or > 5) throw new AuthorityException("branch_lease_minutes_invalid");
```

to:

```csharp
if (minutes is < 1 or > 10) throw new AuthorityException("branch_lease_minutes_invalid");
```

Do not change the exact repo/branch SQL lookup, expiry calculation, audit event format, or lease-replacement behaviour.

- [ ] **Step 5: Run both targeted test files**

```bash
node --test tests/unit/authority-approval-hotfix.test.mjs tests/unit/windows-authority-branch-grants-audit.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the lease-range implementation**

```bash
git add authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml.cs authority-host/windows/GitHubDeliveryAuthority/ApprovalCoordinator.cs authority-host/windows/GitHubDeliveryAuthority/StateStore.cs tests/unit/authority-approval-hotfix.test.mjs tests/unit/windows-authority-branch-grants-audit.test.mjs
git commit -m "feat: allow ten minute branch approval leases"
```

---

### Task 4: Update user-facing branch-lease documentation

**Files:**
- Modify: `authority-host/windows/README.md`
- Modify: `README.md` if it contains the same old range.

**Interfaces:**
- Consumes: final 1-10 minute implementation contract.
- Produces: documentation that no longer claims a 1-5 minute limit.

- [ ] **Step 1: Replace user-facing 1-5 minute wording**

For the Authority README, change:

```text
Only this branch for 1 to 5 minutes
```

or equivalent wording to:

```text
Only this branch for 1 to 10 minutes
```

Keep the explanation that the lease reduces repeated OS prompts only and does not bypass exact-effect grants, redemption, head freshness, mutation mode, direct instruction, idempotency, or exact-text rules.

- [ ] **Step 2: Search the repository for stale 5-minute branch-lease documentation**

Run:

```bash
git grep -n -E '1( |-)to( |-)5 minutes|1.?5 minute|5-minute.*branch|branch.*5 minute'
```

Update only references describing the configurable branch-lease maximum. Do not alter unrelated 5-minute timeouts.

- [ ] **Step 3: Run documentation/static unit tests**

```bash
npm test
```

Expected: PASS, apart from any known external CI-only issue that cannot occur in local Node tests.

- [ ] **Step 4: Commit documentation**

```bash
git add authority-host/windows/README.md README.md
git commit -m "docs: document ten minute branch leases"
```

If `README.md` requires no change, omit it from `git add`.

---

### Task 5: Build and verify the Windows 0.8.1 test ZIP

**Files:**
- Verify: `.github/workflows/authority-hotfix-test.yml`
- Verify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterXamlSelfTest.cs`
- Artifact: `github-delivery-authority-v0.8.1-test-win-x64.zip`

**Interfaces:**
- Consumes: completed branch source.
- Produces: a self-contained win-x64 test ZIP for manual validation on the user's Windows machine.

- [ ] **Step 1: Run the complete Node test suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Trigger/use the dedicated Windows hotfix workflow**

The workflow must execute, in order:

```text
restore locked dependencies
Release build
--self-test
--xaml-self-test
self-contained win-x64 publish
published EXE --self-test
published EXE --xaml-self-test
ZIP publish directory
upload artifact
```

Expected: every substantive step succeeds.

- [ ] **Step 3: Confirm the XAML smoke test still instantiates a very large ApprovalWindow**

Do not weaken or remove the existing large-body `ApprovalWindow` construction in `ControlCenterXamlSelfTest.cs`.

- [ ] **Step 4: Download and inspect the workflow artifact**

Confirm the runnable inner ZIP contains at least:

```text
GitHubDeliveryAuthority.exe
ApprovalWindow.xbf
resources.pri
authority-host-version.json
```

Record its SHA-256 before handing it to the user.

- [ ] **Step 5: Manual acceptance on Windows**

After fully exiting any installed Authority instance, launch the test EXE and verify:

```text
1. no main-window vertical scrollbar at normal or minimum size
2. long Proposed action text scrolls internally
3. taller window gives Proposed action more viewport height
4. window cannot shrink below 560x640
5. security, branch controls, Approve, and Cancel remain visible
6. dropdown offers 1 through 10 minutes
7. selecting 10 minutes creates/reuses an exact-branch lease without another Hello prompt during the lease
8. Windows Hello approval still succeeds and mutations remain fail-closed on denial/error
```

Do not merge or create a release/tag from this test branch until manual acceptance is confirmed.
