# Authority Control Center + Tray Behavior Design

Date: 2026-08-15
Branch: `fix/authority-xaml-startup`
PR: #262

## Goal

Fix the remaining desktop UX issues in Delivery Authority without changing the established visual language or the already-proven unpackaged WinUI/XBF/PRI startup fix.

The Control Center should behave like a compact background utility:

- one real dashboard page (`Overview`),
- one real settings page (`Settings`),
- no dead navigation items,
- full use of available window width,
- the Delivery Authority icon everywhere, including the notification area,
- closing the window hides it to the notification area rather than terminating the service,
- explicit `Exit` from the notification-area menu terminates the process.

## Selected approach

Use the existing WinUI `NavigationView`, `ControlCenterWindow`, `AuthorityAppHost`, and native `TrayIcon` implementation. Do not introduce a new window manager, recreate the Control Center on every open, or replace the native tray integration.

This is the lowest-risk approach because it preserves the current app/service lifetime and only corrects the UI/navigation/tray behavior that is currently inconsistent.

## 1. Navigation

### Sidebar contents

The primary navigation contains exactly one page item:

- `Overview`

Remove these current items because they do not route to separate pages:

- `Activity`
- `Allowlist`
- `Temporary grants`
- `Diagnostics`

`Settings` moves to the bottom of the navigation pane and replaces the current non-interactive protection-mode footer.

Preferred implementation: use the `NavigationView` settings slot (`IsSettingsVisible="True"`) so Settings naturally stays at the bottom and behaves like a real navigation item. If the current WinUI API surface makes that unsuitable, use one bottom `NavigationViewItem` with equivalent behavior; do not retain the current decorative footer.

### Page behavior

- `Overview` shows `OverviewPage`.
- `Settings` shows `SettingsPage`.
- `Overview` is the selected/default page.
- Opening Settings must still refresh the displayed configuration/install metadata.
- Existing in-dashboard actions such as `OpenSettings_Click` must continue opening Settings.

The Protection Mode remains visible in the dashboard/settings content; only the dead sidebar footer representation is removed.

## 2. Use the full window width

Remove the dashboard's artificial content cap (`MaxWidth="1480"`).

Both Overview and Settings should stretch to the actual available content area. Retain responsive outer padding rather than a maximum content width:

- narrow: approximately 16 px horizontal padding,
- medium: approximately 22-24 px,
- wide: approximately 28-32 px.

No horizontal scrollbar should be needed during normal resizing.

### Wide layout

At wide widths, the dashboard keeps a multi-column composition but uses all remaining width after the navigation pane and outer padding.

The existing proportional relationship is acceptable (`activity` as the dominant column, allowlist/grants as the secondary column), but the columns must stretch rather than stop at a centered 1480 px container.

### Medium and narrow layouts

Keep the already-added adaptive reflow behavior:

- medium: activity full-width, secondary cards paired where readable,
- narrow: cards stack vertically and summary metrics reflow.

The change in this pass is removal of the hard maximum width, not a visual redesign of the cards.

## 3. Window close behavior

The normal window close action must hide the Control Center instead of terminating Delivery Authority.

This includes the title-bar X and equivalent normal close requests such as Alt+F4.

Implementation behavior:

1. Observe the `AppWindow.Closing` event for the existing `ControlCenterWindow`.
2. Unless the application is performing an explicit process exit, cancel the close request.
3. Hide the existing `AppWindow`.
4. Keep `AuthorityAppHost`, the named pipe, state store, tray icon, and background process alive.
5. `ShowControlCenter()` must unhide/reactivate the same existing window and refresh its state.

Do not destroy and recreate the Control Center on each tray activation.

### Explicit exit exception

A deliberate process exit must be able to bypass the hide-on-close behavior. `AuthorityAppHost.Exit()` remains the owner of actual application shutdown.

The design should use a small explicit flag/method on `ControlCenterWindow` (for example an `AllowCloseForExit`/`PrepareForExit` concept) or an equivalent clear mechanism so shutdown does not get trapped by the close interception.

## 4. Notification-area icon

The current tray implementation incorrectly calls the stock Windows `IDI_APPLICATION` icon through `LoadIconW(..., 32512)`.

Replace that with the committed application asset:

`Assets\DeliveryAuthority.ico`

The tray icon must therefore match:

- the executable icon,
- the WinUI window/title icon,
- the existing peach Delivery Authority visual identity.

### Native icon loading

Keep native `Shell_NotifyIcon`.

Load the `.ico` file as an `HICON` using an appropriate Win32 file-icon API (for example `LoadImageW` with `IMAGE_ICON` + `LR_LOADFROMFILE`) from `AppContext.BaseDirectory/Assets/DeliveryAuthority.ico`.

Requirements:

- fail clearly if the tray icon cannot be created rather than silently using the unrelated stock icon,
- retain the returned `HICON` for the tray lifetime,
- destroy the owned icon handle during `Dispose` after removing the notification icon,
- do not destroy shared/system-owned handles.

## 5. Notification-area menu and interactions

Right-click menu remains deliberately small:

- `Control Center`
- separator
- `Exit`

Behavior:

- `Control Center` refreshes, unhides, and activates the existing Control Center.
- `Exit` is the normal user-facing way to terminate Delivery Authority from the tray.
- double-clicking the tray icon continues to open the Control Center.

`Exit` must call the existing host-owned shutdown path so the tray, pipe server, store, and app are disposed in the correct order.

## 6. Scope boundaries

This pass must not:

- merge PR #262,
- create a release/tag/version bump,
- redesign the cards or visual theme,
- change protection-mode semantics,
- change approval behavior,
- replace the native tray implementation with WinForms,
- modify or weaken the XBF/`resources.pri` publish invariant,
- remove the existing `--xaml-self-test` coverage.

## 7. Regression coverage

Update/add contract tests to prove:

### Navigation

- only `Overview` remains in primary `NavigationView.MenuItems`,
- Settings is a real bottom navigation target,
- dead Activity/Allowlist/Grants/Diagnostics navigation items are absent,
- Overview remains the default selected page.

### Full-width layout

- Overview/Settings do not contain the dashboard `MaxWidth` cap,
- horizontal content remains stretch-aligned,
- existing narrow/medium/wide adaptive states remain present.

### Close-to-tray behavior

- `ControlCenterWindow` subscribes to an app-window close event,
- normal close is cancelled and hides the window,
- the explicit app-exit path can bypass the interception,
- `ShowControlCenter` restores the existing window.

### Tray icon and exit menu

- tray code no longer loads stock `IDI_APPLICATION`,
- tray code loads `Assets/DeliveryAuthority.ico`,
- tray-owned icon handle is destroyed on disposal,
- right-click menu includes Control Center and Exit,
- Exit dispatches the host shutdown callback.

## 8. Runtime verification

On Windows CI and the affected Windows 11 build:

1. `dotnet build` succeeds.
2. `--self-test` succeeds.
3. `--xaml-self-test` succeeds.
4. Self-contained publish still contains the three XBFs, root `resources.pri`, and `Assets\DeliveryAuthority.ico`.
5. Installed executable still passes XAML smoke.
6. Manual validation:
   - Overview is the only top sidebar item.
   - Settings sits at the bottom and opens correctly.
   - large windows use the available width.
   - X hides the window but process/tray remain alive.
   - tray double-click / Control Center restores the same window.
   - tray icon uses the peach Delivery Authority icon, not the Windows default icon.
   - tray `Exit` terminates the process and removes the notification icon.

## Acceptance criteria

The work is accepted when all of the above behavior is present, the full PR CI matrix is green on the final head, and the existing startup/resource packaging fix remains intact.