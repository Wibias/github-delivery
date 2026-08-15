# Authority Control Center + Tray Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Delivery Authority behave like a real background utility: only Overview + Settings navigation, full-width responsive content, hide-to-tray on normal close, the real Delivery Authority icon in the notification area, and explicit Exit from the tray.

**Architecture:** Keep the existing WinUI `NavigationView`, single `ControlCenterWindow`, `AuthorityAppHost`, and native `Shell_NotifyIcon` implementation. The window owns its `AppWindow` close/hide/show behavior; the host owns explicit process exit; the tray remains a native adapter that loads the committed `.ico`, dispatches Control Center/Exit actions, and owns the resulting `HICON` lifetime.

**Tech Stack:** .NET 8, C#, WinUI 3 / Windows App SDK, Win32 P/Invoke, Node.js `node:test`, GitHub Actions Windows build/publish/install smoke coverage.

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

- `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml` — primary navigation and responsive/full-width layout.
- `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs` — navigation routing plus `AppWindow` show/hide/close interception.
- `authority-host/windows/GitHubDeliveryAuthority/AuthorityAppHost.cs` — host-owned explicit shutdown sequence.
- `authority-host/windows/GitHubDeliveryAuthority/ControlCenterXamlSelfTest.cs` — real-window smoke intentionally bypasses hide-to-tray before closing.
- `authority-host/windows/GitHubDeliveryAuthority/TrayIcon.cs` — native tray icon loading, menu behavior, startup error handoff, and `HICON` cleanup.
- `tests/unit/windows-authority-winui.test.mjs` — regression contracts for all behavior in this pass.
- `.github/workflows/ci.yml` — verify only; preserve the existing build/publish/install pipeline unchanged.

---

### Task 1: Remove dead navigation and make content full-width

**Files:**
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs`

**Interfaces:**
- Consumes: `Navigation_SelectionChanged`, `OpenSettings_Click`, `OverviewPage`, `SettingsPage`, existing responsive visual states.
- Produces: built-in bottom Settings navigation via `Navigation.SettingsItem` / `args.IsSettingsSelected`; Overview as the only primary item; full-width Overview and Settings content grids.

- [ ] **Step 1: Write the failing navigation/full-width contracts**

Replace stale sidebar expectations and add these focused assertions in `tests/unit/windows-authority-winui.test.mjs`:

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
  assert.match(window, /<Grid x:Name="OverviewContent"(?=[^>]*HorizontalAlignment="Stretch")(?![^>]*MaxWidth=)[^>]*>/);
  assert.match(window, /<Grid x:Name="SettingsContent"(?=[^>]*HorizontalAlignment="Stretch")(?![^>]*MaxWidth=)[^>]*>/);
  for (const state of ["NarrowDashboardState", "MediumDashboardState", "WideDashboardState"]) {
    assert.match(window, new RegExp(`x:Name=\\"${state}\\"`));
  }
});
```

Keep dashboard-content assertions for `Recent activity / Audit trail`, `Repository allowlist`, `Active temporary grants`, `Diagnostics`, and `Quick settings`; only their dead navigation entries disappear.

- [ ] **Step 2: Run the focused contract and verify RED**

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: FAIL because the current XAML still has dead menu entries, `IsSettingsVisible="False"`, a `PaneFooter`, and width caps.

- [ ] **Step 3: Implement the minimal XAML/navigation change**

Make the NavigationView header exactly follow this shape while preserving existing adaptive pane thresholds:

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
```

Delete `NavigationView.PaneFooter` completely. Remove these now-invalid visual-state setters wherever they occur:

```xml
<Setter Target="ProtectionFooterBorder.Padding" Value="7,8" />
<Setter Target="ProtectionFooterBorder.Margin" Value="4" />
<Setter Target="ProtectionModeSidebarText.Visibility" Value="Collapsed" />
<Setter Target="ProtectionFooterBorder.Padding" Value="12" />
<Setter Target="ProtectionFooterBorder.Margin" Value="8" />
<Setter Target="ProtectionModeSidebarText.Visibility" Value="Visible" />
```

Remove `MaxWidth` from `OverviewContent` and `SettingsContent`, and set both outer grids to `HorizontalAlignment="Stretch"`. Preserve current 16 / 22 / 28 responsive paddings and all card reflow setters.

In `ControlCenterWindow.xaml.cs`, replace tag-based Settings routing with:

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

Remove both `ProtectionModeSidebar.Text = display;` and `ProtectionModeSidebar.Text = "Configuration error";` because that footer control no longer exists. Keep `ProtectionModeText` and all Settings controls.

- [ ] **Step 4: Verify Task 1**

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

On Windows:

```powershell
$Project = 'authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj'
dotnet restore $Project --locked-mode
dotnet build $Project --configuration Release --no-restore
dotnet run --project $Project --configuration Release --no-build -- --xaml-self-test
```

Expected: contract passes, build succeeds, XAML smoke exits `0`.

- [ ] **Step 5: Commit Task 1**

```bash
git add tests/unit/windows-authority-winui.test.mjs authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs
git commit -m "fix: simplify Authority navigation and use full width"
```

---

### Task 2: Hide the Control Center on normal close and preserve explicit exit

**Files:**
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/AuthorityAppHost.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterXamlSelfTest.cs`

**Interfaces:**
- Consumes: current single `ControlCenterWindow`, `AppWindow.GetFromWindowId`, `AuthorityAppHost.Exit()`, real-window XAML smoke.
- Produces: cached `AppWindow _appWindow`; `PrepareForExit()`; `OnAppWindowClosing(...)`; `ShowControlCenter()` restores the same hidden AppWindow.

- [ ] **Step 1: Write the failing close-to-tray contract**

```js
test("normal Control Center close hides the existing AppWindow and explicit exit bypasses it", () => {
  const code = read(`${root}/ControlCenterWindow.xaml.cs`);
  const host = read(`${root}/AuthorityAppHost.cs`);
  const smoke = read(`${root}/ControlCenterXamlSelfTest.cs`);

  assert.match(code, /private readonly AppWindow _appWindow;/);
  assert.match(code, /private bool _allowClose;/);
  assert.match(code, /_appWindow\.Closing \+= OnAppWindowClosing/);
  assert.match(code, /private void OnAppWindowClosing\(AppWindow sender, AppWindowClosingEventArgs args\)/);
  assert.match(code, /args\.Cancel\s*=\s*true/);
  assert.match(code, /sender\.Hide\(\)/);
  assert.match(code, /public void PrepareForExit\(\)[\s\S]*?_allowClose\s*=\s*true/);
  assert.match(code, /public void ShowControlCenter\(\)[\s\S]*?_appWindow\.Show\(\)/);
  assert.match(host, /_controlCenter\?\.PrepareForExit\(\)/);
  assert.match(smoke, /window\.PrepareForExit\(\);[\s\S]*window\.Close\(\);/);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: FAIL because close interception and explicit bypass do not exist.

- [ ] **Step 3: Cache the AppWindow and implement hide/show**

Add fields:

```csharp
private readonly AppWindow _appWindow;
private bool _allowClose;
```

Construct/cache once:

```csharp
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

Update `TrySetWindowIcon()` to call `_appWindow.SetIcon(iconPath)` and `TryResize()` to call `_appWindow.Resize(new SizeInt32(width, height))`; keep both helpers best-effort via their existing `try/catch` boundaries.

Implement lifecycle methods:

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

Do not create a new `ControlCenterWindow` when restoring from tray.

- [ ] **Step 4: Wire explicit shutdown and XAML-smoke bypass**

In `AuthorityAppHost.Exit()`:

```csharp
private void Exit()
{
    _controlCenter?.PrepareForExit();
    Dispose();
    Application.Current.Exit();
}
```

In `ControlCenterXamlSelfTest.Run()`:

```csharp
var window = new ControlCenterWindow(store);
window.PrepareForExit();
window.Close();
return 0;
```

- [ ] **Step 5: Verify Task 2**

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

On Windows:

```powershell
$Project = 'authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj'
dotnet build $Project --configuration Release --no-restore
dotnet run --project $Project --configuration Release --no-build -- --self-test
dotnet run --project $Project --configuration Release --no-build -- --xaml-self-test
```

Expected: all pass; XAML smoke exits `0` rather than leaving a hidden smoke-test window alive.

- [ ] **Step 6: Commit Task 2**

```bash
git add tests/unit/windows-authority-winui.test.mjs authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs authority-host/windows/GitHubDeliveryAuthority/AuthorityAppHost.cs authority-host/windows/GitHubDeliveryAuthority/ControlCenterXamlSelfTest.cs
git commit -m "fix: hide Authority control center to tray on close"
```

---

### Task 3: Replace the stock tray icon and harden native tray lifetime

**Files:**
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/TrayIcon.cs`

**Interfaces:**
- Consumes: `Assets\DeliveryAuthority.ico`, `Shell_NotifyIconW`, `_showControlCenter`, `_exit`, current tray thread/window.
- Produces: owned `_trayIcon`; file-based `LoadImageW`; `DestroyIcon` cleanup; `_startupError` handoff; menu with Control Center, separator, Exit.

- [ ] **Step 1: Write the failing native tray contract**

```js
test("tray uses the committed Authority icon and exposes Control Center plus explicit Exit", () => {
  const tray = read(`${root}/TrayIcon.cs`);

  assert.doesNotMatch(tray, /LoadIconW/);
  assert.match(tray, /Path\.Combine\(AppContext\.BaseDirectory, "Assets", "DeliveryAuthority\.ico"\)/);
  assert.match(tray, /LoadImageW/);
  assert.match(tray, /LR_LOADFROMFILE/);
  assert.match(tray, /private IntPtr _trayIcon;/);
  assert.match(tray, /DestroyIcon\(_trayIcon\)/);
  assert.match(tray, /private Exception\? _startupError;/);
  assert.match(tray, /AppendMenuW\(menu, MF_STRING, MenuControlCenter, "Control Center"\)/);
  assert.match(tray, /AppendMenuW\(menu, MF_SEPARATOR/);
  assert.match(tray, /AppendMenuW\(menu, MF_STRING, MenuExit, "Exit"\)/);
  assert.match(tray, /selected == MenuExit[\s\S]*Dispatch\(_exit\)/);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: FAIL because current tray code still uses stock `IDI_APPLICATION` and does not own/destroy a file-loaded icon.

- [ ] **Step 3: Add exact native constants, fields, and P/Invoke**

Add:

```csharp
private const uint IMAGE_ICON = 1;
private const uint LR_LOADFROMFILE = 0x00000010;
private const uint LR_DEFAULTSIZE = 0x00000040;
private const uint MF_SEPARATOR = 0x00000800;

private IntPtr _trayIcon;
private Exception? _startupError;
private bool _notificationIconAdded;
```

Replace the `LoadIconW` declaration with:

```csharp
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
private static extern IntPtr LoadImageW(IntPtr instance, string name, uint type, int cx, int cy, uint load);

[DllImport("user32.dll", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
private static extern bool DestroyIcon(IntPtr icon);
```

- [ ] **Step 4: Split tray setup into focused methods and always release constructor readiness**

Use this exact top-level control flow:

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

private void RunCore()
{
    try
    {
        RegisterTrayWindow();
        AddNotificationIcon();
        _ready.Set();
        RunMessageLoop();
    }
    finally
    {
        if (_notificationIconAdded)
        {
            Shell_NotifyIconW(NIM_DELETE, ref _data);
            _notificationIconAdded = false;
        }

        if (_trayIcon != IntPtr.Zero)
        {
            DestroyIcon(_trayIcon);
            _trayIcon = IntPtr.Zero;
        }
    }
}
```

`RegisterTrayWindow()` contains the current `_wndProc`, class registration, and `CreateWindowExW` logic. `RunMessageLoop()` contains the current `GetMessageW` / `TranslateMessage` / `DispatchMessageW` loop. Do not change message semantics.

After `_ready.Wait()` in the constructor:

```csharp
if (_startupError is not null)
    throw new InvalidOperationException("tray_initialization_failed", _startupError);
```

- [ ] **Step 5: Load `DeliveryAuthority.ico` and add it to the notification area**

Implement:

```csharp
private void AddNotificationIcon()
{
    var iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "DeliveryAuthority.ico");
    _trayIcon = LoadImageW(IntPtr.Zero, iconPath, IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE);
    if (_trayIcon == IntPtr.Zero)
        throw new InvalidOperationException($"tray_icon_load_failed:{Marshal.GetLastWin32Error()}");

    _data = new NOTIFYICONDATA
    {
        cbSize = (uint)Marshal.SizeOf<NOTIFYICONDATA>(),
        hWnd = _window,
        uID = 1,
        uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP,
        uCallbackMessage = WM_TRAY,
        hIcon = _trayIcon,
        szTip = "Delivery Authority",
    };

    if (!Shell_NotifyIconW(NIM_ADD, ref _data))
        throw new InvalidOperationException("tray_icon_creation_failed");

    _notificationIconAdded = true;
}
```

There is no stock-icon fallback.

- [ ] **Step 6: Keep the tray menu minimal and explicit**

In `ShowMenu()`:

```csharp
AppendMenuW(menu, MF_STRING, MenuControlCenter, "Control Center");
AppendMenuW(menu, MF_SEPARATOR, 0, string.Empty);
AppendMenuW(menu, MF_STRING, MenuExit, "Exit");
```

Keep double-click -> `_showControlCenter`, Control Center -> `_showControlCenter`, Exit -> `_exit`.

- [ ] **Step 7: Verify Task 3**

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

- [ ] **Step 8: Commit Task 3**

```bash
git add tests/unit/windows-authority-winui.test.mjs authority-host/windows/GitHubDeliveryAuthority/TrayIcon.cs
git commit -m "fix: use Authority icon and explicit exit in tray"
```

---

### Task 4: Final shipping-path regression and manual acceptance

**Files:**
- Verify only: `.github/workflows/ci.yml`
- Verify only: `authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj`
- Verify: all files modified in Tasks 1-3.

**Interfaces:**
- Consumes: all preceding task outputs.
- Produces: final exact-head evidence without altering the proven publish/resource pipeline.

- [ ] **Step 1: Run repository checks**

```bash
npm run check
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run Windows build/self-test/XAML gates**

```powershell
$Project = 'authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj'
dotnet restore $Project --locked-mode
dotnet build $Project --configuration Release --no-restore
dotnet run --project $Project --configuration Release --no-build -- --self-test
dotnet run --project $Project --configuration Release --no-build -- --xaml-self-test
```

Expected: all exit `0`.

- [ ] **Step 3: Publish and assert the startup/resource/icon payload**

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

Expected: required resources exist and published XAML smoke exits `0`.

- [ ] **Step 4: Manual Windows acceptance**

In one normal process lifetime verify:

1. Overview is the only top sidebar item; Settings is at the bottom.
2. Overview is selected initially; Settings and the in-dashboard Settings button route correctly.
3. 1920/2560-wide windows use the available content width with responsive outer padding and no centered dead zone.
4. Narrow/medium card reflow still works with no horizontal scrollbar.
5. Tray uses the peach Delivery Authority icon, not stock Windows `IDI_APPLICATION`.
6. X hides the Control Center while the process/tray remain alive.
7. Alt+F4 behaves the same as X.
8. Tray double-click restores the same window.
9. Tray right-click -> Control Center restores the same window.
10. Tray right-click -> Exit removes the tray icon and terminates the process.

- [ ] **Step 5: Push final head and verify exact-head PR workflows**

Push to `fix/authority-xaml-startup`. Wait for CI, Architecture Contracts, Dependency Review, and CodeQL for the exact final SHA. Verify all 9 Node 22/24/26 x Windows/macOS/Linux CI jobs and the Windows Node 24 publish/install smoke path are green.

Do not merge after green. Report final SHA and workflow evidence to the user.
