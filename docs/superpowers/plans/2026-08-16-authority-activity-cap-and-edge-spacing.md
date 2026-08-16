# Authority Activity Cap and Edge Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap the Recent activity / Audit trail viewport at 420 px with internal scrolling and increase horizontal edge spacing by about 10% in the Control Center and approval window without changing their existing responsive behaviour.

**Architecture:** Keep the change declarative in the existing WinUI XAML. `ActivityList` gets an explicit 420 px maximum and automatic vertical scrolling. Existing responsive visual states keep their current breakpoints and vertical padding, while only their left/right padding values increase. No new runtime layout calculations or code-behind are introduced.

**Tech Stack:** C#/.NET 8, WinUI 3 XAML, Node.js `node:test`, GitHub Actions Windows build/publish workflow.

## Global Constraints

- `ActivityList` minimum height stays 280 px.
- `ActivityList` maximum height is exactly 420 px.
- `ActivityList` uses automatic vertical scrolling and disabled horizontal scrolling.
- Control Center horizontal padding becomes 18 px narrow, 24 px medium, and 31 px wide for both Overview and Settings.
- Approval horizontal padding becomes 18 px narrow and 31 px wide while existing vertical padding remains 16 px narrow and 28 px wide.
- Approval fixed-shell behaviour remains unchanged: no main-window scrolling, Proposed action is the only scrollable approval region, minimum window size remains 560 x 640 px, and Proposed action minimum viewport remains 110 px.
- Setup and allowlist `ContentDialog` surfaces are out of scope.
- Branch lease range remains 1 to 10 minutes.

---

### Task 1: Add source regression coverage for activity height and Control Center padding

**Files:**
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml`

**Interfaces:**
- Consumes: existing `ControlCenterWindow.xaml` responsive visual-state names and `ActivityList` element.
- Produces: a bounded `ActivityList` viewport and exact responsive padding contract.

- [ ] **Step 1: Write the failing regression test**

Extend `tests/unit/windows-authority-winui.test.mjs` with:

```js
test("control center caps recent activity and keeps responsive edge spacing", () => {
  const window = read(`${root}/ControlCenterWindow.xaml`);

  assert.match(
    window,
    /x:Name="ActivityList"[^>]*MinHeight="280"[^>]*MaxHeight="420"[^>]*ScrollViewer\.VerticalScrollBarVisibility="Auto"[^>]*ScrollViewer\.HorizontalScrollBarVisibility="Disabled"/,
  );

  for (const value of ["18,16,18,20", "24,20,24,24", "31,24,31,28"]) {
    const escaped = value.replaceAll(",", "\\,");
    assert.match(window, new RegExp(`Target="OverviewContent\\.Padding" Value="${escaped}"`));
    assert.match(window, new RegExp(`Target="SettingsContent\\.Padding" Value="${escaped}"`));
  }
});
```

- [ ] **Step 2: Run the source test and verify RED**

Run:

```powershell
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: FAIL because `ActivityList` has no `MaxHeight="420"`, no explicit automatic vertical-scroll property, and the responsive padding values are still 16/22/28 horizontally.

- [ ] **Step 3: Implement the minimal Control Center XAML change**

In `ControlCenterWindow.xaml`:

```xml
<Setter Target="OverviewContent.Padding" Value="18,16,18,20" />
<Setter Target="SettingsContent.Padding" Value="18,16,18,20" />
```

for the narrow state, then:

```xml
<Setter Target="OverviewContent.Padding" Value="24,20,24,24" />
<Setter Target="SettingsContent.Padding" Value="24,20,24,24" />
```

for medium, then:

```xml
<Setter Target="OverviewContent.Padding" Value="31,24,31,28" />
<Setter Target="SettingsContent.Padding" Value="31,24,31,28" />
```

for wide.

Update `ActivityList` to:

```xml
<ListView x:Name="ActivityList"
          SelectionMode="None"
          IsItemClickEnabled="False"
          MinHeight="280"
          MaxHeight="420"
          HorizontalContentAlignment="Stretch"
          ScrollViewer.VerticalScrollBarVisibility="Auto"
          ScrollViewer.HorizontalScrollBarVisibility="Disabled">
```

- [ ] **Step 4: Run the source test and verify GREEN**

Run:

```powershell
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/windows-authority-winui.test.mjs authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml
git commit -m "fix: cap authority audit activity viewport"
```

### Task 2: Add source regression coverage for approval side spacing

**Files:**
- Modify: `tests/unit/authority-approval-hotfix.test.mjs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml`

**Interfaces:**
- Consumes: existing `NarrowApprovalState`, `WideApprovalState`, `RootLayout`, and fixed-shell layout contract.
- Produces: explicit horizontal/vertical root padding values that add side space without increasing approval-shell height.

- [ ] **Step 1: Write the failing approval padding test**

Add to `tests/unit/authority-approval-hotfix.test.mjs`:

```js
test("approval window adds horizontal edge space without changing vertical padding", async () => {
  const xaml = await read(approvalWindowPath);

  assert.match(xaml, /Target="RootLayout\.Padding" Value="18,16,18,16"/);
  assert.match(xaml, /Target="RootLayout\.Padding" Value="31,28,31,28"/);
  assert.doesNotMatch(xaml, /Target="RootLayout\.Padding" Value="16"/);
  assert.doesNotMatch(xaml, /Target="RootLayout\.Padding" Value="28"/);
});
```

- [ ] **Step 2: Run the source test and verify RED**

Run:

```powershell
node --test tests/unit/authority-approval-hotfix.test.mjs
```

Expected: FAIL because the approval visual states still use uniform `16` and `28` padding.

- [ ] **Step 3: Implement the minimal approval XAML change**

Change only the responsive root-padding setters:

```xml
<Setter Target="RootLayout.Padding" Value="18,16,18,16" />
```

and:

```xml
<Setter Target="RootLayout.Padding" Value="31,28,31,28" />
```

Keep the fixed shell, row definitions, 110 px Proposed action minimum, and 560 x 640 minimum window size unchanged.

- [ ] **Step 4: Run the approval source test and verify GREEN**

Run:

```powershell
node --test tests/unit/authority-approval-hotfix.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/authority-approval-hotfix.test.mjs authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml
git commit -m "style: increase authority window edge spacing"
```

### Task 3: Verify the complete 0.8.1 test package

**Files:**
- Verify: `.github/workflows/authority-hotfix-test.yml`
- Verify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml`
- Verify: `authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml`
- Verify: `tests/unit/windows-authority-winui.test.mjs`
- Verify: `tests/unit/authority-approval-hotfix.test.mjs`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: one Windows x64 0.8.1 test ZIP built from the exact branch head.

- [ ] **Step 1: Run both targeted source regression suites**

```powershell
node --test tests/unit/windows-authority-winui.test.mjs tests/unit/authority-approval-hotfix.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 2: Run the branch-only Windows Authority workflow**

The workflow must execute:

```text
source regression tests
Restore and build
Authority self-test
XAML smoke test
self-contained win-x64 publish
published-binary self-test
published-binary XAML smoke test
ZIP integrity verification
artifact upload
```

Expected: every substantive step PASS.

- [ ] **Step 3: Inspect the exact branch diff**

Verify the change is limited to the approved spec plus test/plan documentation. In particular, confirm there is no new approval outer `ScrollViewer`, no change to minimum approval dimensions, and no change to security/lease semantics.

- [ ] **Step 4: Download and checksum the exact workflow artifact**

Download `github-delivery-authority-v0.8.1-test-win-x64`, extract the inner runnable ZIP if the artifact wrapper contains one, and compute SHA-256 for the runnable package.

- [ ] **Step 5: Hand the runnable ZIP to the user**

Report the exact branch head SHA, workflow result, artifact digest, runnable ZIP SHA-256, and the specific UI behaviours to validate locally.
