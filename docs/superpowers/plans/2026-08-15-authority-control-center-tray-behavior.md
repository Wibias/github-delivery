# Authority Control Center + Tray Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Delivery Authority behave like a real background utility: only Overview + Settings navigation, full-width responsive content, hide-to-tray on normal close, the real Delivery Authority icon in the notification area, and explicit Exit from the tray.

**Architecture:** Keep the existing WinUI `NavigationView`, single `ControlCenterWindow`, `AuthorityAppHost`, and native `Shell_NotifyIcon` implementation. The window owns its `AppWindow` close/hide/show behavior; the host owns explicit process exit; the tray remains a small native adapter that loads the committed `.ico`, dispatches Control Center/Exit actions, and owns the resulting `HICON` lifetime.

**Tech Stack:** .NET 8, C#, WinUI 3 / Windows App SDK, native Win32 P/Invoke for the notification-area icon/menu, Node.js `node:test` contract tests, GitHub Actions Windows build/publish/install smoke coverage.

## Global Constraints

- Work only on `fix/authority-xaml-startup` / PR #262.
- Do not merge PR #262.
- Do not create a tag, release, npm publication, or version bump.
- Do not redesign cards or change the established visual theme.
- Do not change protection-mode or approval semantics.
- Keep the native tray implementation; do not introduce WinForms.
- Do not modify or weaken the XBF / root `resources.pri` publish invariant.
- Preserve `--self-test` and real-window `--xaml-self-test` coverage.
- `Assets\DeliveryAuthority.ico` remains the single application/window/tray icon asset.
- Normal X / Alt+F4 hides the existing Control Center; only explicit tray Exit terminates the app.

## File Structure

- `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml` — primary navigation structure and responsive/full-width dashboard layout.
- `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs` — NavigationView routing plus `AppWindow` show/hide/close interception.
- `authority-host/windows/GitHubDeliveryAuthority/AuthorityAppHost.cs` — host-owned explicit shutdown sequence and close-bypass handoff.
- `authority-host/windows/GitHubDeliveryAuthority/ControlCenterXamlSelfTest.cs` — real-window smoke must intentionally bypass hide-to-tray before closing.
- `authority-host/windows/GitHubDeliveryAuthority/TrayIcon.cs` — notification-area `.ico` loading, native menu, startup error handoff, and owned `HICON` cleanup.
- `tests/unit/windows-authority-winui.test.mjs` — static regression contracts for navigation, full-width layout, hide-to-tray lifecycle, tray icon, and Exit.
- `.github/workflows/ci.yml` — no expected semantic change; final verification must use its existing Windows build/publish/install path.

---

### Task 1: Remove dead navigation and make the dashboard truly full-width

**Files:**
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs`

**Interfaces:**
- Consumes: existing `Navigation_SelectionChanged`, `OpenSettings_Click`, `OverviewPage`, `SettingsPage`, and responsive visual states.
- Produces: `NavigationView` whose primary menu contains only Overview and whose built-in Settings item is the bottom navigation target; `Navigation_SelectionChanged` routes via `args.IsSettingsSelected`; `OpenSettings_Click` assigns `Navigation.SelectedItem = Navigation.SettingsItem`.

- [ ] **Step 1: Replace the stale navigation/full-width contract with a failing contract**

In `tests/unit/windows-authority-winui.test.mjs`, update the dashboard/navigation tests so they require the actual desired shape:

```js
test("control center exposes only Overview plus the built-in bottom Settings target", () => {
  const window = read(`${root}/ControlCenterWindow.xaml`);
  const code = read(`${root}/ControlCenterWindow.xaml.cs`);

  assert.match(window, /IsSettingsVisible="True"/);
  assert.match(window, /<NavigationViewItem Content="Overview" Tag="overview" IsSelected="True"/);
  for (const deadItem of ["Activity", "Allowlist", "Temporary grants", "Diagnostics"]) {
    assert.doesNotMatch(window, new RegExp(`<NavigationViewItem Content=\\"${deadItem}\\"`));
  }
  assert.doesNotMatch(window, /<NavigationView\.PaneFooter>/);
  assert.match(code, /args\.IsSettingsSelected/);
  assert.match(code, /Navigation\.SelectedItem\s*=\s*Navigation\.SettingsItem/);
});

test("control center uses all available content width while preserving adaptive states", () => {
  const window = read(`${root}/ControlCenterWindow.xaml`);
  assert.match(window, /x:Name="OverviewContent"[\s\S]*?HorizontalAlignment="Stretch"/);
  assert.match(window, /x:Name="SettingsContent"[\s\S]*?HorizontalAlignment="Stretch"/);
  assert.doesNotMatch(window, /x:Name="OverviewContent"[\s\S]{0,250}MaxWidth=/);
  assert.doesNotMatch(window, /x:Name="SettingsContent"[\s\S]{0,250}MaxWidth=/);
  for (const state of ["NarrowDashboardState", "MediumDashboardState", "WideDashboardState"]) {
    assert.match(window, new RegExp(`x:Name=\\"${state}\\"`));
  }
});
```

Also change the earlier activity-first design test so it no longer expects the removed sidebar items. It should continue asserting the dashboard card text (`Recent activity / Audit trail`, `Repository allowlist`, `Active temporary grants`, `Diagnostics`, `Quick settings`) because those cards remain on Overview.

- [ ] **Step 2: Run the focused Node contract and verify RED**

Run:

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: FAIL because the current XAML still has five dead primary navigation entries, `IsSettingsVisible="False"`, the decorative pane footer, and content `MaxWidth` values.

- [ ] **Step 3: Make the minimal XAML/navigation implementation**

In `ControlCenterWindow.xaml`:

```xml
<NavigationView x:Name="Navigation"
                PaneDisplayMode="Auto"
                CompactModeThresholdWidth="0"
                ExpandedModeThresholdWidth="1360"
                CompactPaneLength="48"
                OpenPaneLength="172"
                IsBackButtonVisible="Collapsed"
                IsSettingsVisible="True"
                IsPaneToggleButtonVisible="False"
                SelectionChanged="Navigation_SelectionChanged">
    <NavigationView.MenuItems>
        <NavigationViewItem Content="Overview"
                            Tag="overview"
                            IsSelected="True"
                            ToolTipService.ToolTip="Overview">
            <NavigationViewItem.Icon>
                <SymbolIcon Symbol="Home" />
            </NavigationViewItem.Icon>
        </NavigationViewItem>
    </NavigationView.MenuItems>
    ...
</NavigationView>
```

Delete `NavigationView.PaneFooter` entirely. Remove `MaxWidth` from both `OverviewContent` and `SettingsContent`; set/retain `HorizontalAlignment="Stretch"` so the outer grids consume the full content area. Keep the existing narrow/medium/wide padding setters and card reflow unchanged.

In `ControlCenterWindow.xaml.cs`, route Settings using the standard selection flag rather than tag emulation:

```csharp
private void Navigation_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
{
    var showSettings = args.IsSettingsSelected;
    SettingsPage.Visibility = showSettings ? Visibility.Visible : Visibility.Collapsed;
    OverviewPage.Visibility = showSettings ? Visibility.Collapsed : Visibility.Visible;
    if (showSettings) Refresh();
}

private void OpenSettings_Click(object sender, RoutedEventArgs e)
{
    Navigation.SelectedItem = Navigation.SettingsItem;
}
```

Remove references that only existed for the deleted pane footer, including `ProtectionModeSidebarText` visual-state setters and `ProtectionModeSidebar.Text = ...` assignments. Keep the actual dashboard/settings Protection Mode controls.

- [ ] **Step 4: Run focused tests and Windows XAML smoke**

Run:

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: PASS.

On Windows also run:

```powershell
$Project = 'authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj'
dotnet restore $Project --locked-mode
dotnet build $Project --configuration Release --no-restore
dotnet run --project $Project --configuration Release --no-build -- --xaml-self-test
```

Expected: build succeeds and XAML self-test exits `0`.

- [ ] **Step 5: Commit Task 1**

```bash
git add tests/unit/windows-authority-winui.test.mjs \
  authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml \
  authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs
git commit -m "fix: simplify Authority navigation and use full width"
```

---

### Task 2: Convert normal window close into hide-to-tray without breaking explicit exit or XAML smoke

**Files:**
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/AuthorityAppHost.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterXamlSelfTest.cs`

**Interfaces:**
- Consumes: `AppWindow.GetFromWindowId`, existing single `ControlCenterWindow`, host `Exit()`, and XAML smoke construction.
- Produces: cached `AppWindow _appWindow`; `PrepareForExit()` close bypass; `ShowControlCenter()` calling `_appWindow.Show()`; close handler `OnAppWindowClosing(AppWindow sender, AppWindowClosingEventArgs args)`; host calls `PrepareForExit()` before process shutdown.

- [ ] **Step 1: Add failing lifecycle contracts**

Append focused static contracts:

```js
test("normal Control Center close hides the existing AppWindow and explicit exit bypasses it", () => {
  const code = read(`${root}/ControlCenterWindow.xaml.cs`);
  const host = read(`${root}/AuthorityAppHost.cs`);
  const smoke = read(`${root}/ControlCenterXamlSelfTest.cs`);

  assert.match(code, /private readonly AppWindow _appWindow;/);
  assert.match(code, /_appWindow\.Closing \+= OnAppWindowClosing/);
  assert.match(code, /private bool _allowClose;/);
  assert.match(code, /private void OnAppWindowClosing\(AppWindow sender, AppWindowClosingEventArgs args\)/);
  assert.match(code, /args\.Cancel\s*=\s*true/);
  assert.match(code, /sender\.Hide\(\)/);
  assert.match(code, /public void PrepareForExit\(\)[\s\S]*?_allowClose\s*=\s*true/);
  assert.match(code, /ShowControlCenter\(\)[\s\S]*?_appWindow\.Show\(\)/);
  assert.match(host, /_controlCenter\?\.PrepareForExit\(\)/);
  assert.match(smoke, /window\.PrepareForExit\(\);[\s\S]*window\.Close\(\);/);
});
```

- [ ] **Step 2: Run the focused contract and verify RED**

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: FAIL because no close interception or explicit close bypass exists yet.

- [ ] **Step 3: Cache the AppWindow and implement hide/show semantics**

Refactor `ControlCenterWindow` to resolve `AppWindow` once after `InitializeComponent()`:

```csharp
private readonly AppWindow _appWindow;
private bool _allowClose;

public ControlCenterWindow(StateStore store)
{
    InitializeComponent();
    _appWindow = ResolveAppWindow();
    TrySetWindowIcon();
    _appWindow.Closing += OnAppWindowClosing;
    _store = store;
    Activated += (_, _) => Refresh();
    TryResize(1080, 760);
}

private AppWindow ResolveAppWindow()
{
    var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
    var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
    return AppWindow.GetFromWindowId(windowId)
        ?? throw new InvalidOperationException("control_center_app_window_unavailable");
}
```

Use the cached object for icon and resize helpers rather than repeatedly resolving the HWND.

Implement normal-close interception:

```csharp
private void OnAppWindowClosing(AppWindow sender, AppWindowClosingEventArgs args)
{
    if (_allowClose) return;
    args.Cancel = true;
    sender.Hide();
}

public void PrepareForExit()
{
    _allowClose = true;
}

public void ShowControlCenter()
{
    Refresh();
    _appWindow.Show();
}
```

`AppWindow.Show()` is sufficient to show and activate the existing hidden window; do not construct a replacement window.

- [ ] **Step 4: Wire the explicit host exit and smoke-test close bypass**

In `AuthorityAppHost.Exit()`:

```csharp
private void Exit()
{
    _controlCenter?.PrepareForExit();
    Dispose();
    Application.Current.Exit();
}
```

In `ControlCenterXamlSelfTest.Run()`, deliberately bypass hide-to-tray before closing the temporary real window:

```csharp
var window = new ControlCenterWindow(store);
window.PrepareForExit();
window.Close();
return 0;
```

This prevents the permanent XAML smoke from accidentally leaving a hidden window alive.

- [ ] **Step 5: Run contract + Windows real-window tests**

Run:

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

Then on Windows:

```powershell
$Project = 'authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj'
dotnet build $Project --configuration Release --no-restore
dotnet run --project $Project --configuration Release --no-build -- --self-test
dotnet run --project $Project --configuration Release --no-build -- --xaml-self-test
```

Expected: all pass; XAML smoke exits `0` despite the new close interception.

- [ ] **Step 6: Commit Task 2**

```bash
git add tests/unit/windows-authority-winui.test.mjs \
  authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs \
  authority-host/windows/GitHubDeliveryAuthority/AuthorityAppHost.cs \
  authority-host/windows/GitHubDeliveryAuthority/ControlCenterXamlSelfTest.cs
git commit -m "fix: hide Authority control center to tray on close"
```

---

### Task 3: Use DeliveryAuthority.ico in the native notification area and make tray startup failure explicit

**Files:**
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/TrayIcon.cs`

**Interfaces:**
- Consumes: committed `Assets\DeliveryAuthority.ico`, `Shell_NotifyIconW`, `_showControlCenter`, `_exit`, existing tray thread.
- Produces: owned `_trayIcon` `HICON`; `LoadImageW(... LR_LOADFROMFILE | LR_DEFAULTSIZE)` file load; `DestroyIcon` cleanup; `_startupError` handoff so constructor cannot deadlock on native setup failure; right-click menu `Control Center`, separator, `Exit`.

- [ ] **Step 1: Add failing tray contracts**

Extend the tray test:

```js
test("tray uses the committed Authority icon and exposes Control Center plus explicit Exit", () => {
  const tray = read(`${root}/TrayIcon.cs`);

  assert.doesNotMatch(tray, /LoadIconW\(IntPtr\.Zero, new IntPtr\(32512\)\)/);
  assert.match(tray, /Path\.Combine\(AppContext\.BaseDirectory, "Assets", "DeliveryAuthority\.ico"\)/);
  assert.match(tray, /LoadImageW/);
  assert.match(tray, /LR_LOADFROMFILE/);
  assert.match(tray, /private IntPtr _trayIcon;/);
  assert.match(tray, /DestroyIcon\(_trayIcon\)/);
  assert.match(tray, /AppendMenuW\(menu, MF_STRING, MenuControlCenter, "Control Center"\)/);
  assert.match(tray, /AppendMenuW\(menu, MF_SEPARATOR/);
  assert.match(tray, /AppendMenuW\(menu, MF_STRING, MenuExit, "Exit"\)/);
  assert.match(tray, /selected == MenuExit[\s\S]*Dispatch\(_exit\)/);
  assert.match(tray, /private Exception\? _startupError;/);
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: FAIL because current tray code still loads stock `IDI_APPLICATION` and has no owned icon cleanup/startup-error handoff.

- [ ] **Step 3: Implement native file-icon loading and ownership**

Add constants/field:

```csharp
private const uint IMAGE_ICON = 1;
private const uint LR_LOADFROMFILE = 0x00000010;
private const uint LR_DEFAULTSIZE = 0x00000040;
private const uint MF_SEPARATOR = 0x00000800;

private IntPtr _trayIcon;
private Exception? _startupError;
```

Add P/Invoke declarations:

```csharp
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
private static extern IntPtr LoadImageW(IntPtr instance, string name, uint type, int cx, int cy, uint load);

[DllImport("user32.dll", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
private static extern bool DestroyIcon(IntPtr icon);
```

Load the committed file before `Shell_NotifyIconW(NIM_ADD, ...)`:

```csharp
var iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "DeliveryAuthority.ico");
_trayIcon = LoadImageW(IntPtr.Zero, iconPath, IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE);
if (_trayIcon == IntPtr.Zero)
    throw new InvalidOperationException($"tray_icon_load_failed:{Marshal.GetLastWin32Error()}");

_data = new NOTIFYICONDATA
{
    ...
    hIcon = _trayIcon,
    szTip = "Delivery Authority",
};
```

Do not fall back to a stock icon.

- [ ] **Step 4: Make tray-thread startup failure observable instead of hanging `_ready.Wait()`**

Wrap the native setup/message loop so `_ready` is always signaled:

```csharp
private void Run()
{
    try
    {
        RunCore();
    }
    catch (Exception error)
    {
        _startupError = error;
        _ready.Set();
    }
}
```

Move the current registration/window/icon/message-loop body to `RunCore()` and signal `_ready.Set()` immediately after successful `NIM_ADD`. In the constructor, after `_ready.Wait()`:

```csharp
if (_startupError is not null)
    throw new InvalidOperationException("tray_initialization_failed", _startupError);
```

Ensure `RunCore()` removes the notification icon in `finally` when it had been added, and destroys `_trayIcon` exactly once when owned.

- [ ] **Step 5: Add the menu separator without changing callbacks**

`ShowMenu()` should be:

```csharp
AppendMenuW(menu, MF_STRING, MenuControlCenter, "Control Center");
AppendMenuW(menu, MF_SEPARATOR, 0, string.Empty);
AppendMenuW(menu, MF_STRING, MenuExit, "Exit");
```

Keep double-click -> `_showControlCenter`, Control Center -> `_showControlCenter`, Exit -> `_exit`.

- [ ] **Step 6: Run focused tests and Windows build/XAML smoke**

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

On Windows:

```powershell
$Project = 'authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj'
dotnet build $Project --configuration Release --no-restore
dotnet run --project $Project --configuration Release --no-build -- --xaml-self-test
```

Expected: PASS / exit `0`.

- [ ] **Step 7: Commit Task 3**

```bash
git add tests/unit/windows-authority-winui.test.mjs \
  authority-host/windows/GitHubDeliveryAuthority/TrayIcon.cs
git commit -m "fix: use Authority icon and explicit exit in tray"
```

---

### Task 4: Final shipping-path regression and manual desktop acceptance

**Files:**
- Verify only: `.github/workflows/ci.yml`
- Verify only: `authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj`
- Verify all Task 1-3 files.

**Interfaces:**
- Consumes: all preceding task outputs.
- Produces: final evidence that the feature works without changing the proven XBF/PRI/icon publish pipeline.

- [ ] **Step 1: Run repository checks**

```bash
npm run check
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run the same Windows build/self-test/XAML gates used by CI**

```powershell
$Project = 'authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj'
dotnet restore $Project --locked-mode
dotnet build $Project --configuration Release --no-restore
dotnet run --project $Project --configuration Release --no-build -- --self-test
dotnet run --project $Project --configuration Release --no-build -- --xaml-self-test
```

Expected: all exit `0`.

- [ ] **Step 3: Publish and assert the startup/resource/icon payload remains intact**

```powershell
$Project = 'authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj'
$PublishDir = Join-Path $env:TEMP 'github-delivery-authority-tray-final'
Remove-Item $PublishDir -Recurse -Force -ErrorAction SilentlyContinue
dotnet publish $Project --configuration Release --runtime win-x64 --self-contained true --no-restore --output $PublishDir

foreach ($File in @(
  'App.xbf',
  'ApprovalWindow.xbf',
  'ControlCenterWindow.xbf',
  'resources.pri',
  'GitHubDeliveryAuthority.exe',
  'Assets\DeliveryAuthority.ico'
)) {
  if (-not (Test-Path (Join-Path $PublishDir $File) -PathType Leaf)) {
    throw "Missing publish invariant: $File"
  }
}

& (Join-Path $PublishDir 'GitHubDeliveryAuthority.exe') --xaml-self-test
if ($LASTEXITCODE -ne 0) { throw "Published XAML smoke failed: $LASTEXITCODE" }
```

Expected: all six required files exist and published XAML smoke exits `0`.

- [ ] **Step 4: Manual runtime acceptance on Windows**

Launch the published executable normally and verify all of the following in one process lifetime:

1. Sidebar shows only Overview at the top and Settings at the bottom.
2. Overview is selected initially; Settings opens and the in-dashboard Settings action routes to it.
3. At 1920/2560-wide windows, content stretches to available width with only responsive outer padding; no centered max-width dead zone remains.
4. At the existing narrow/medium test widths, adaptive card reflow still works and there is no horizontal scrollbar.
5. Notification-area icon is the peach Delivery Authority icon, not stock Windows `IDI_APPLICATION`.
6. Title-bar X hides the window; the process, pipe, and tray remain alive.
7. Alt+F4 behaves the same as X.
8. Tray double-click restores the same Control Center window.
9. Tray right-click -> Control Center restores the same window.
10. Tray right-click -> Exit removes the notification icon and terminates the process.

- [ ] **Step 5: Push final head and wait for every PR workflow**

Push the completed commits to `fix/authority-xaml-startup`. Wait for CI, Architecture Contracts, Dependency Review, and CodeQL on the exact final SHA. In CI, explicitly verify all 9 Node 22/24/26 x Windows/macOS/Linux jobs and the Windows Node 24 publish/install smoke path are green.

Do not merge after green; report the final SHA and workflow evidence back to the user.
