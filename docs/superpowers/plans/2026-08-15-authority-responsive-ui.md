# Delivery Authority Responsive UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Delivery Authority responsive from narrow desktop windows through large windows, preserve the confirmed XBF/root-PRI startup fix, and replace the default Windows executable/window icon with the existing peach Authority mark.

**Architecture:** Keep the current `NavigationView` shell and current information hierarchy. Make narrow behavior the safe default, then use XAML visual states to progressively enable medium and wide arrangements. Keep data/actions in `ControlCenterWindow.xaml.cs`; only add narrowly scoped window-icon plumbing there. Treat the application icon as a committed content asset that is embedded in the executable and copied through publish/install.

**Tech Stack:** C# 12 / .NET 8, WinUI 3, Microsoft Windows App SDK 2.3.1, XAML `NavigationView` + `VisualStateManager`, Node.js `node:test` contract tests, GitHub Actions Windows publish/install smoke.

## Global Constraints

- Preserve `EnableMsixTooling=true`, `ProjectPriFileName=resources.pri`, `CopyUnpackagedWinUiResourcesToPublish`, and the three-XBF/root-PRI publish invariants.
- Do not replace `NavigationView` or reintroduce custom fallback theme dictionaries/brushes.
- Keep the current visual language, labels, navigation destinations, state-store behavior, approval behavior, and protection-mode behavior.
- Narrow/medium navigation remains icon-only; full labels return only at wide desktop widths.
- Main dashboard must not require a horizontal scrollbar.
- App/window icon must reuse the existing peach Authority shield mark rather than introduce a new logo.
- Window-icon setup is best-effort and must never become a startup failure path.
- Keep `--xaml-self-test` constructing and closing the real `ControlCenterWindow`.

## File Map

- Modify: `tests/unit/windows-authority-winui.test.mjs` — responsive-layout and icon contracts.
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml` — adaptive shell, dashboard states, card/header/text layout, settings narrow safety.
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs` — best-effort runtime window icon setup only; retain existing data/action methods.
- Create: `authority-host/windows/GitHubDeliveryAuthority/Assets/DeliveryAuthority.ico` — approved peach Authority mark at multiple Windows icon sizes.
- Modify: `authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj` — executable icon and content-copy metadata; do not disturb WinUI publish targets.
- Modify: `.github/workflows/ci.yml` — assert the icon survives publish and release-install round trip.

---

### Task 1: Lock the responsive-layout contract and make the dashboard adaptive

**Files:**
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml`

**Interfaces:**
- Consumes: existing named controls used from code-behind (`AllowlistedCount`, `ActivityList`, `AllowlistList`, `GrantList`, `RevokeGrantButton`, `DiagnosticsUpdated`, protection/settings controls).
- Produces: XAML states named `NarrowDashboardState`, `MediumDashboardState`, `WideDashboardState`; named card containers `ActivityCard`, `AllowlistCard`, `GrantCard`, `DiagnosticsCard`, `QuickSettingsCard`; adaptive `NavigationView` shell.

- [ ] **Step 1: Add a failing responsive-shell/layout contract test**

Append this test to `tests/unit/windows-authority-winui.test.mjs`:

```js
test("control center adapts navigation and dashboard layout across narrow, medium, and wide windows", () => {
  const window = read(`${root}/ControlCenterWindow.xaml`);

  assert.match(window, /PaneDisplayMode="Auto"/);
  assert.match(window, /CompactModeThresholdWidth="0"/);
  assert.match(window, /ExpandedModeThresholdWidth="1360"/);

  for (const state of ["NarrowDashboardState", "MediumDashboardState", "WideDashboardState"]) {
    assert.match(window, new RegExp(`x:Name=\\"${state}\\"`));
  }

  for (const card of ["ActivityCard", "AllowlistCard", "GrantCard", "DiagnosticsCard", "QuickSettingsCard"]) {
    assert.match(window, new RegExp(`x:Name=\\"${card}\\"`));
  }

  assert.match(window, /MinWindowWidth="840"/);
  assert.match(window, /MinWindowWidth="1360"/);
  assert.doesNotMatch(window, /MaxWidth="1180"/);

  for (const header of ["ActivityHeaderGrid", "AllowlistHeaderGrid", "GrantHeaderGrid"]) {
    assert.match(
      window,
      new RegExp(`x:Name=\\"${header}\\"[\\s\\S]*?<ColumnDefinition Width=\\"\\*\\"[\\s\\S]*?<ColumnDefinition Width=\\"Auto\\"`),
    );
  }

  assert.match(window, /x:Name="ActivityColumnsHeader"/);
  assert.match(window, /Target="ActivityColumnsHeader\.Visibility" Value="Collapsed"/);

  assert.doesNotMatch(window, /<ColumnDefinition Width="170"\s*\/>/);
});
```

- [ ] **Step 2: Run the targeted test and verify it fails for the current fixed layout**

Run:

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: FAIL in the new responsive test because the current XAML still has `PaneDisplayMode="Left"`, no responsive states, fixed `MaxWidth="1180"`, and fixed 170px settings columns.

- [ ] **Step 3: Convert the navigation shell to native compact/expanded adaptive behavior**

Change the existing `NavigationView` opening tag to this shape while preserving all current menu items and `SelectionChanged`:

```xml
<NavigationView x:Name="Navigation"
                PaneDisplayMode="Auto"
                CompactModeThresholdWidth="0"
                ExpandedModeThresholdWidth="1360"
                CompactPaneLength="48"
                OpenPaneLength="172"
                IsBackButtonVisible="Collapsed"
                IsSettingsVisible="False"
                IsPaneToggleButtonVisible="False"
                SelectionChanged="Navigation_SelectionChanged">
```

Keep every existing `NavigationViewItem` and icon. Add `ToolTipService.ToolTip` matching the item label to each item so the compact icon-only pane remains understandable.

Refactor `NavigationView.PaneFooter` so the current icon remains visible at compact widths and the text can be hidden by the dashboard visual states:

```xml
<NavigationView.PaneFooter>
    <Border x:Name="NavigationFooterBorder"
            Padding="8"
            Margin="6,8"
            HorizontalAlignment="Center"
            CornerRadius="8"
            Background="{ThemeResource CardBackgroundFillColorDefaultBrush}"
            BorderBrush="{ThemeResource CardStrokeColorDefaultBrush}"
            BorderThickness="1"
            ToolTipService.ToolTip="Protection mode">
        <StackPanel Orientation="Horizontal" Spacing="10">
            <FontIcon Glyph="&#xE83D;"
                      Foreground="{ThemeResource AccentTextFillColorPrimaryBrush}"
                      FontSize="18" />
            <StackPanel x:Name="NavigationFooterText" Visibility="Collapsed">
                <TextBlock Text="Protection mode" FontWeight="SemiBold" />
                <TextBlock x:Name="ProtectionModeSidebar"
                           Text="Loading…"
                           Style="{StaticResource CaptionTextBlockStyle}"
                           Opacity="0.72"
                           TextTrimming="CharacterEllipsis" />
            </StackPanel>
        </StackPanel>
    </Border>
</NavigationView.PaneFooter>
```

`WideDashboardState` will set `NavigationFooterText.Visibility=Visible`, restore `NavigationFooterBorder.Padding=12`, `Margin=8`, and set `HorizontalAlignment=Stretch`.

- [ ] **Step 4: Replace the fixed overview body with one named responsive grid**

Keep `OverviewPage` as the existing `ScrollViewer`, but replace its inner fixed two-column composition with one `Grid x:Name="OverviewContent"` containing all cards as direct grid children.

Use this row/column model:

```xml
<Grid x:Name="OverviewContent"
      Padding="16,20,16,24"
      MaxWidth="1440"
      HorizontalAlignment="Stretch"
      RowSpacing="16"
      ColumnSpacing="16">
    <Grid.RowDefinitions>
        <RowDefinition Height="Auto" /> <!-- header -->
        <RowDefinition Height="Auto" /> <!-- metrics -->
        <RowDefinition Height="Auto" /> <!-- activity / allowlist -->
        <RowDefinition Height="Auto" /> <!-- allowlist/grants depending state -->
        <RowDefinition Height="Auto" /> <!-- diagnostics/quick depending state -->
        <RowDefinition Height="Auto" /> <!-- narrow diagnostics -->
        <RowDefinition Height="Auto" /> <!-- narrow quick settings -->
    </Grid.RowDefinitions>
    <Grid.ColumnDefinitions>
        <ColumnDefinition Width="*" />
        <ColumnDefinition Width="*" />
    </Grid.ColumnDefinitions>
```

Default element placement is the narrow layout:

- header: row 0, column span 2;
- metrics: row 1, column span 2;
- `ActivityCard`: row 2, column span 2;
- `AllowlistCard`: row 3, column span 2;
- `GrantCard`: row 4, column span 2;
- `DiagnosticsCard`: row 5, column span 2;
- `QuickSettingsCard`: row 6, column span 2.

Do not wrap allowlist/grants in a shared `StackPanel`; each card must be directly movable by visual-state setters.

- [ ] **Step 5: Add the three dashboard visual states**

Attach a `VisualStateGroup` to `OverviewContent`. Narrow is the default behavior; medium activates at 840px window width; wide activates at 1360px. These thresholds intentionally account for the 48px compact pane and 172px expanded pane so the effective content width lands close to the approved ~760/~1180 content breakpoints.

Use this state structure:

```xml
<VisualStateManager.VisualStateGroups>
    <VisualStateGroup x:Name="DashboardLayoutStates">
        <VisualState x:Name="NarrowDashboardState">
            <VisualState.StateTriggers>
                <AdaptiveTrigger MinWindowWidth="0" />
            </VisualState.StateTriggers>
            <VisualState.Setters>
                <Setter Target="ActivityColumnsHeader.Visibility" Value="Collapsed" />
                <Setter Target="NavigationFooterText.Visibility" Value="Collapsed" />
                <Setter Target="OverviewContent.Padding" Value="16,20,16,24" />
            </VisualState.Setters>
        </VisualState>

        <VisualState x:Name="MediumDashboardState">
            <VisualState.StateTriggers>
                <AdaptiveTrigger MinWindowWidth="840" />
            </VisualState.StateTriggers>
            <VisualState.Setters>
                <Setter Target="ActivityCard.(Grid.Row)" Value="2" />
                <Setter Target="ActivityCard.(Grid.Column)" Value="0" />
                <Setter Target="ActivityCard.(Grid.ColumnSpan)" Value="2" />

                <Setter Target="AllowlistCard.(Grid.Row)" Value="3" />
                <Setter Target="AllowlistCard.(Grid.Column)" Value="0" />
                <Setter Target="AllowlistCard.(Grid.ColumnSpan)" Value="1" />
                <Setter Target="GrantCard.(Grid.Row)" Value="3" />
                <Setter Target="GrantCard.(Grid.Column)" Value="1" />
                <Setter Target="GrantCard.(Grid.ColumnSpan)" Value="1" />

                <Setter Target="DiagnosticsCard.(Grid.Row)" Value="4" />
                <Setter Target="DiagnosticsCard.(Grid.Column)" Value="0" />
                <Setter Target="DiagnosticsCard.(Grid.ColumnSpan)" Value="1" />
                <Setter Target="QuickSettingsCard.(Grid.Row)" Value="4" />
                <Setter Target="QuickSettingsCard.(Grid.Column)" Value="1" />
                <Setter Target="QuickSettingsCard.(Grid.ColumnSpan)" Value="1" />

                <Setter Target="ActivityColumnsHeader.Visibility" Value="Visible" />
                <Setter Target="NavigationFooterText.Visibility" Value="Collapsed" />
                <Setter Target="OverviewContent.Padding" Value="20,22,20,26" />
            </VisualState.Setters>
        </VisualState>

        <VisualState x:Name="WideDashboardState">
            <VisualState.StateTriggers>
                <AdaptiveTrigger MinWindowWidth="1360" />
            </VisualState.StateTriggers>
            <VisualState.Setters>
                <Setter Target="ActivityCard.(Grid.Row)" Value="2" />
                <Setter Target="ActivityCard.(Grid.Column)" Value="0" />
                <Setter Target="ActivityCard.(Grid.ColumnSpan)" Value="1" />
                <Setter Target="ActivityCard.(Grid.RowSpan)" Value="2" />

                <Setter Target="AllowlistCard.(Grid.Row)" Value="2" />
                <Setter Target="AllowlistCard.(Grid.Column)" Value="1" />
                <Setter Target="AllowlistCard.(Grid.ColumnSpan)" Value="1" />
                <Setter Target="GrantCard.(Grid.Row)" Value="3" />
                <Setter Target="GrantCard.(Grid.Column)" Value="1" />
                <Setter Target="GrantCard.(Grid.ColumnSpan)" Value="1" />

                <Setter Target="DiagnosticsCard.(Grid.Row)" Value="4" />
                <Setter Target="DiagnosticsCard.(Grid.Column)" Value="0" />
                <Setter Target="DiagnosticsCard.(Grid.ColumnSpan)" Value="1" />
                <Setter Target="QuickSettingsCard.(Grid.Row)" Value="4" />
                <Setter Target="QuickSettingsCard.(Grid.Column)" Value="1" />
                <Setter Target="QuickSettingsCard.(Grid.ColumnSpan)" Value="1" />

                <Setter Target="ActivityColumnsHeader.Visibility" Value="Visible" />
                <Setter Target="NavigationFooterText.Visibility" Value="Visible" />
                <Setter Target="NavigationFooterBorder.Padding" Value="12" />
                <Setter Target="NavigationFooterBorder.Margin" Value="8" />
                <Setter Target="NavigationFooterBorder.HorizontalAlignment" Value="Stretch" />
                <Setter Target="OverviewContent.Padding" Value="28,24,28,28" />
            </VisualState.Setters>
        </VisualState>
    </VisualStateGroup>
</VisualStateManager.VisualStateGroups>
```

When implementing, ensure `ActivityCard.Grid.RowSpan` defaults to `1`; otherwise returning from wide to medium/narrow can retain an invalid two-row span.

- [ ] **Step 6: Make the five summary metrics reflow to 3+2 in narrow mode**

Replace the existing one-row five-column metrics grid with a two-row, five-column named grid. Keep each existing count `x:Name` unchanged.

Default narrow placement:

- repositories: row 0 col 0
- active grants: row 0 col 1
- approved: row 0 col 2
- denied: row 1 col 0
- expired: row 1 col 1

Name the last two column definitions `SummaryColumn3` and `SummaryColumn4`, the second row `SummarySecondRow`, and the denied/expired metric containers `DeniedMetric`/`ExpiredMetric`.

In medium and wide states add setters that:

```xml
<Setter Target="SummaryColumn3.Width" Value="*" />
<Setter Target="SummaryColumn4.Width" Value="*" />
<Setter Target="SummarySecondRow.Height" Value="0" />
<Setter Target="DeniedMetric.(Grid.Row)" Value="0" />
<Setter Target="DeniedMetric.(Grid.Column)" Value="3" />
<Setter Target="ExpiredMetric.(Grid.Row)" Value="0" />
<Setter Target="ExpiredMetric.(Grid.Column)" Value="4" />
```

Default narrow values are `SummaryColumn3.Width="0"`, `SummaryColumn4.Width="0"`, `SummarySecondRow.Height="Auto"`, and denied/expired in row 1.

- [ ] **Step 7: Replace overlap-prone card headers with explicit title/action columns**

For activity, allowlist, and grants, use the same structure with the approved existing title/button text:

```xml
<Grid x:Name="ActivityHeaderGrid" ColumnSpacing="12">
    <Grid.ColumnDefinitions>
        <ColumnDefinition Width="*" />
        <ColumnDefinition Width="Auto" />
    </Grid.ColumnDefinitions>
    <TextBlock Grid.Column="0"
               Text="Recent activity / Audit trail"
               FontWeight="SemiBold"
               TextTrimming="CharacterEllipsis" />
    <Button Grid.Column="1"
            Content="View full activity"
            HorizontalAlignment="Right"
            Style="{StaticResource AccentButtonStyle}"
            Padding="9,3"
            IsEnabled="False" />
</Grid>
```

Create equivalent named grids `AllowlistHeaderGrid` and `GrantHeaderGrid`. Do not use two children with only `HorizontalAlignment="Right"` inside an unconstrained one-cell grid.

- [ ] **Step 8: Make activity/list/diagnostics/quick-settings content narrow-safe**

Name the existing pseudo-table header `ActivityColumnsHeader`. Keep its current columns for medium/wide, but narrow state hides it.

Give `ActivityList` an item template that wraps string rows instead of allowing horizontal clipping:

```xml
<ListView x:Name="ActivityList"
          SelectionMode="None"
          IsItemClickEnabled="False"
          MinHeight="280"
          ScrollViewer.HorizontalScrollBarVisibility="Disabled">
    <ListView.ItemTemplate>
        <DataTemplate>
            <TextBlock Text="{Binding}"
                       TextWrapping="WrapWholeWords"
                       Margin="0,4" />
        </DataTemplate>
    </ListView.ItemTemplate>
</ListView>
```

Add `TextTrimming="CharacterEllipsis"` or wrapping where repository/branch text can grow.

Replace diagnostics inner horizontal `StackPanel` with a three-column grid (`Auto,* ,Auto`) so `DiagnosticsUpdated` has a real right column instead of trying to right-align inside a horizontal stack.

Replace the quick-settings `Protection mode` row with `*,Auto` columns so `ProtectionModeText` cannot overlap the label.

- [ ] **Step 9: Remove the settings page's fixed 170px dependency and reduce narrow padding**

For each installation row, replace:

```xml
<ColumnDefinition Width="170" />
```

with:

```xml
<ColumnDefinition Width="Auto" />
<ColumnDefinition Width="*" />
```

Give the label a right margin such as `Margin="0,0,24,0"`; keep `HostSourceText` trimmed and `ConfigPathText` wrapped.

Name the settings content grid `SettingsContent` and add a settings visual-state group that uses `Padding="16,20,16,24"` by default, `20,22,20,26` from 840px, and `28,24,28,28` from 1360px.

- [ ] **Step 10: Run the targeted contract test and WinUI XAML smoke**

Run:

```bash
node --test tests/unit/windows-authority-winui.test.mjs
dotnet restore authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj --locked-mode
dotnet build authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj --configuration Release --no-restore
dotnet run --project authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj --configuration Release --no-build -- --xaml-self-test
```

Expected: all commands exit `0`.

- [ ] **Step 11: Commit the responsive layout**

```bash
git add tests/unit/windows-authority-winui.test.mjs \
  authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml
git commit -m "fix: make Authority dashboard responsive"
```

---

### Task 2: Add the real multi-resolution Authority application icon

**Files:**
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Create: `authority-host/windows/GitHubDeliveryAuthority/Assets/DeliveryAuthority.ico`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs`

**Interfaces:**
- Produces: `Assets/DeliveryAuthority.ico`; `ApplicationIcon` points to it; runtime `AppWindow.SetIcon` loads the same fully-qualified asset path.
- Consumes: existing `AppWindow`/window-handle code already used by `TryResize`.

- [ ] **Step 1: Add binary ICO helpers and a failing icon contract**

At the top of `tests/unit/windows-authority-winui.test.mjs`, keep `readFileSync` and add:

```js
function readBytes(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url));
}

function readIcoSizes(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0, "ICO reserved field must be 0");
  assert.equal(buffer.readUInt16LE(2), 1, "ICO type must be icon");
  const count = buffer.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const width = buffer[offset] === 0 ? 256 : buffer[offset];
    const height = buffer[offset + 1] === 0 ? 256 : buffer[offset + 1];
    assert.equal(width, height, `ICO frame ${index} must be square`);
    sizes.push(width);
  }
  return [...new Set(sizes)].sort((left, right) => left - right);
}
```

Append:

```js
test("authority host embeds and ships the approved multi-resolution application icon", () => {
  const project = read(`${root}/GitHubDeliveryAuthority.csproj`);
  const code = read(`${root}/ControlCenterWindow.xaml.cs`);
  const icon = readBytes(`${root}/Assets/DeliveryAuthority.ico`);

  assert.match(project, /<ApplicationIcon>Assets\\DeliveryAuthority\.ico<\/ApplicationIcon>/);
  assert.match(project, /<Content Include="Assets\\DeliveryAuthority\.ico">[\s\S]*CopyToOutputDirectory[\s\S]*CopyToPublishDirectory/);
  assert.match(code, /AppContext\.BaseDirectory/);
  assert.match(code, /DeliveryAuthority\.ico/);
  assert.match(code, /\.SetIcon\(/);

  assert.deepEqual(readIcoSizes(icon), [16, 20, 24, 32, 40, 48, 64, 128, 256]);
});
```

- [ ] **Step 2: Run the targeted test and verify it fails because the icon asset/integration does not exist yet**

Run:

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: FAIL because `Assets/DeliveryAuthority.ico` is missing and `ApplicationIcon`/runtime icon code are absent.

- [ ] **Step 3: Create the approved Authority `.ico` asset**

Create `authority-host/windows/GitHubDeliveryAuthority/Assets/DeliveryAuthority.ico` from the already-approved peach shield mark shown in the app/screenshots. Do not invent a different emblem, add lettering, add a colored square background, or change to a generic GitHub/Windows logo.

The `.ico` directory must contain exactly these required square sizes at minimum:

```text
16, 20, 24, 32, 40, 48, 64, 128, 256
```

Use transparency around the shield mark. At 16-24px, simplify only internal anti-aliasing/detail as needed for legibility; the silhouette and peach color identity must remain the same.

- [ ] **Step 4: Embed the icon in the executable and copy it for runtime `AppWindow.SetIcon`**

In the main `PropertyGroup` of `GitHubDeliveryAuthority.csproj`, add without changing the existing WinUI/PRI properties:

```xml
<ApplicationIcon>Assets\DeliveryAuthority.ico</ApplicationIcon>
```

Add a separate item group:

```xml
<ItemGroup>
  <Content Include="Assets\DeliveryAuthority.ico">
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    <CopyToPublishDirectory>PreserveNewest</CopyToPublishDirectory>
  </Content>
</ItemGroup>
```

Do not modify or remove the existing `CopyUnpackagedWinUiResourcesToPublish` target.

- [ ] **Step 5: Set the runtime window icon best-effort from the same asset**

In `ControlCenterWindow` constructor, immediately after `_store = store;`, call:

```csharp
TrySetWindowIcon();
```

Add this helper near `TryResize`:

```csharp
private void TrySetWindowIcon()
{
    try
    {
        var iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "DeliveryAuthority.ico");
        if (!File.Exists(iconPath)) return;

        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
        AppWindow.GetFromWindowId(windowId)?.SetIcon(iconPath);
    }
    catch
    {
        // The custom icon is cosmetic and must never block Authority startup.
    }
}
```

Do not make icon loading part of `--xaml-self-test` pass/fail semantics; missing/invalid runtime icon should fall back to Windows default rather than crash startup.

- [ ] **Step 6: Run icon contracts, build, and XAML smoke**

Run:

```bash
node --test tests/unit/windows-authority-winui.test.mjs
dotnet build authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj --configuration Release --no-restore
dotnet run --project authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj --configuration Release --no-build -- --xaml-self-test
```

Expected: all exit `0`.

- [ ] **Step 7: Commit the icon integration**

```bash
git add tests/unit/windows-authority-winui.test.mjs \
  authority-host/windows/GitHubDeliveryAuthority/Assets/DeliveryAuthority.ico \
  authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj \
  authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs
git commit -m "feat: add Authority application icon"
```

---

### Task 3: Protect icon packaging and run the full startup/publish/install regression suite

**Files:**
- Modify: `.github/workflows/ci.yml`
- Verify only: `tests/unit/authority-startup-diagnostics-contract.test.mjs`
- Verify only: `scripts/prepare-authority-host-runtime-smoke.mjs`
- Verify only: `authority-host/windows/install-release.ps1`

**Interfaces:**
- Consumes: `Assets/DeliveryAuthority.ico` copied to build/publish output by Task 2.
- Produces: CI failure if the icon disappears from self-contained publish or installed release layout.

- [ ] **Step 1: Add a failing static workflow contract for icon publish/install assertions**

Extend the icon test from Task 2 with workflow checks:

```js
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /DeliveryAuthority\.ico/);
  assert.match(workflow, /Published authority host is missing the application icon/);
  assert.match(workflow, /Installed Authority application icon is missing/);
```

Run:

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: FAIL until CI contains both assertions.

- [ ] **Step 2: Assert the icon in the self-contained publish directory**

In `.github/workflows/ci.yml`, inside the existing `Publish Windows authority host` PowerShell block, immediately after the `resources.pri` assertion, add:

```powershell
$ApplicationIcon = Join-Path $PublishDir 'Assets\DeliveryAuthority.ico'
if (-not (Test-Path $ApplicationIcon -PathType Leaf)) {
  throw 'Published authority host is missing the application icon: Assets\DeliveryAuthority.ico'
}
```

Do not weaken or reorder the existing XBF or `resources.pri` assertions.

- [ ] **Step 3: Assert the icon survives release ZIP + installer round trip**

After `$InstalledExecutable` is validated, add:

```powershell
$InstalledApplicationIcon = Join-Path $InstallDir "app\v$Version\Assets\DeliveryAuthority.ico"
if (-not (Test-Path $InstalledApplicationIcon -PathType Leaf)) {
  throw 'Installed Authority application icon is missing.'
}
```

Keep the installed executable `--xaml-self-test` immediately afterward.

- [ ] **Step 4: Run the focused unit contracts**

Run:

```bash
node --test \
  tests/unit/windows-authority-winui.test.mjs \
  tests/unit/authority-startup-diagnostics-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run repository checks**

Run:

```bash
npm run check
```

Expected: exit `0`.

- [ ] **Step 6: Run Windows build and both Authority smoke paths locally on Windows**

Run:

```powershell
$Project = 'authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj'
dotnet restore $Project --locked-mode
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

dotnet build $Project --configuration Release --no-restore
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

dotnet run --project $Project --configuration Release --no-build -- --self-test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

dotnet run --project $Project --configuration Release --no-build -- --xaml-self-test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Expected: every command exits `0`.

- [ ] **Step 7: Commit the packaging regression guard**

```bash
git add .github/workflows/ci.yml tests/unit/windows-authority-winui.test.mjs
git commit -m "ci: verify Authority icon packaging"
```

- [ ] **Step 8: Push and require fresh PR-head workflow success before claiming completion**

Verify the resulting PR head has successful runs for:

```text
CI
Architecture Contracts
Dependency Review
CodeQL
```

For the Windows Node 24 CI job, inspect the individual steps and require success for:

```text
Run checks
Verify architecture contracts
Validate Windows authority installer syntax
Restore Windows authority host in locked mode
Build Windows authority host
Run Windows authority host self-test
Run Windows authority host XAML smoke test
Publish Windows authority host
```

Do not use an earlier green run from the pre-responsive head as evidence.

- [ ] **Step 9: Perform manual responsive/icon acceptance on the actual Windows app**

Open the built/published Authority app and resize through these representative widths:

```text
~1400px+
1080px
850-900px
630-700px
```

At each size verify:

```text
no title/button overlap
no clipped card bodies
no main-dashboard horizontal scrollbar
navigation labels visible only when expanded
compact navigation icons remain fully visible
protection footer is not partially clipped
metrics are one row at medium/wide and 3+2 at narrow
activity header disappears at narrow while rows remain understandable
allowlist/grants stack correctly at narrow
settings installation values do not clip against a fixed label column
resizing back and forth restores the correct layout
```

Also verify the same peach Authority mark appears for:

```text
GitHubDeliveryAuthority.exe in Explorer
running window/title-bar identity
taskbar entry
```

If the icon or responsive layout is wrong on the affected Windows build, fix that before merge; do not paper over it by changing the XBF/PRI startup fix.

---

## Plan Self-Review

- **Spec coverage:** shell adaptation, wide/medium/narrow composition, summary 3+2 reflow, header overlap prevention, list/text safety, settings narrow safety, executable/window icon, publish/install asset survival, XAML smoke preservation, and manual representative-size checks are all mapped to tasks.
- **Placeholder scan:** no `TBD`, `TODO`, deferred implementation, or unspecified error-handling steps remain.
- **Type/name consistency:** the plan consistently uses `Assets/DeliveryAuthority.ico`, `NarrowDashboardState`, `MediumDashboardState`, `WideDashboardState`, the five named card containers, and `TrySetWindowIcon()`.
- **Scope:** responsive Control Center behavior and app identity are small, cohesive desktop-UI changes on the same WinUI host; no unrelated refactor is included.
