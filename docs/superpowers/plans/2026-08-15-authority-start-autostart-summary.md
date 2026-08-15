# Authority Start, Autostart, and Summary Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npx github-delivery start` visibly open the Control Center, synchronize CLI and Settings autostart controls against the same Windows Run-key contract, and center the two lower narrow-layout summary metrics.

**Architecture:** Reuse the existing Authority named-pipe protocol to tell the already-running WinUI host to show its Control Center. Keep autostart state in the existing per-user Windows Run value and expose matching read/set semantics in Node and C# rather than introducing a second persisted setting. Adjust only the summary grid geometry; preserve all existing packaging, close-to-tray, tray Exit, approval, and responsive behavior.

**Tech Stack:** Node.js 22/24/26, `node:test`, .NET 8 / C#, WinUI 3, Windows named pipes, HKCU Windows Registry, GitHub Actions Windows publish/XAML smoke.

## Global Constraints

- No new `open` CLI command.
- `npx github-delivery autostart` remains backward-compatible and enables autostart.
- Add `autostart on`, `autostart off`, and `autostart status`.
- Preserve the single-instance mutex and close-to-tray behavior.
- Preserve the unpackaged XBF/root-PRI publish fix and both self-tests.
- Do not add a config-file or SQLite copy of autostart state.
- No version bump, tag, release, merge, or npm publication.

---

### Task 1: Make `start` show the running Control Center

**Files:**
- Modify: `tests/unit/bootstrap-runtime-ux.test.mjs`
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/AuthorityService.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/AuthorityPipeServer.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/AuthorityAppHost.cs`
- Modify: `scripts/lib/authority-host-install.mjs`
- Modify: `scripts/github-delivery-cli.mjs`

**Interfaces:**
- `AuthorityService(..., Func<bool> showControlCenter)` adds `ShowControlCenter()` returning `{ status = "shown" }` or throwing `authority_control_center_show_failed`.
- Pipe method `showControlCenter` invokes `AuthorityService.ShowControlCenter()`.
- `startInstalledAuthorityHost()` returns `started`, `ready`, `shown`, `processStarted`, `exePath`, and `diagnosticsPath` when applicable.

- [ ] **Step 1: Write failing regressions**

Add tests proving an already-running host is probed before spawning, a fresh host is shown after readiness, and CLI success output states the executable path plus notification-area/right-click/Exit guidance. Add a WinUI contract assertion for the `showControlCenter` pipe route and dispatcher enqueue.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
node --test tests/unit/bootstrap-runtime-ux.test.mjs tests/unit/windows-authority-winui.test.mjs
```

Expected: failures for missing show command/start guidance.

- [ ] **Step 3: Implement the host show command**

Construct the Control Center before the service in `AuthorityAppHost.Start()`, pass a callback that dispatches onto the existing UI `DispatcherQueue`, and add:

```csharp
public object ShowControlCenter()
{
    if (!_showControlCenter()) throw new AuthorityException("authority_control_center_show_failed");
    return new { status = "shown" };
}
```

Route `"showControlCenter"` in `AuthorityPipeServer`.

- [ ] **Step 4: Make Node start probe-first and show-after-ready**

Before spawning, call the existing `status` pipe probe. If ready, call `showControlCenter` directly. Otherwise spawn, wait for ready as today, then call `showControlCenter`. Return failure rather than claiming success when the show request fails.

- [ ] **Step 5: Render explicit lifecycle guidance**

On success, print that the Control Center is open, print `exePath` when present, and explain that closing keeps Authority in the notification area and complete exit is notification-area icon -> right-click -> `Exit`.

- [ ] **Step 6: Run focused tests and commit GREEN**

```bash
node --test tests/unit/bootstrap-runtime-ux.test.mjs tests/unit/windows-authority-winui.test.mjs
```

Expected: PASS.

Commit message: `fix: make Authority start open the control center`.

---

### Task 2: Add shared autostart on/off/status semantics

**Files:**
- Modify: `tests/unit/bootstrap-runtime-ux.test.mjs`
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Modify: `scripts/lib/bootstrap-cli.mjs`
- Modify: `scripts/lib/bootstrap-command.mjs`
- Modify: `scripts/lib/bootstrap-maintenance.mjs`
- Modify: `scripts/lib/authority-host-install.mjs`
- Create: `authority-host/windows/GitHubDeliveryAuthority/AuthorityStartup.cs`

**Interfaces:**
- Node: `readAuthorityHostStartup(...)` -> `{ enabled, exePath, registeredValue? }`.
- Node: `setAuthorityHostStartup({ enabled, ... })` -> `{ configured: enabled, enabled, changed, exePath }`.
- Existing `configureAuthorityHostStartup()` remains as a backward-compatible enable wrapper.
- CLI parser returns `autostartMode` as `"on" | "off" | "status"`, default `"on"`.
- C#: `AuthorityStartup.Read()` and `AuthorityStartup.Set(bool enabled)` use `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value `GitHubDeliveryAuthority`.

- [ ] **Step 1: Write failing parser/state/render tests**

Cover bare `autostart`, `autostart on`, `autostart off`, `autostart status`, invalid positional value, registry enable, disable, unchanged state, and status rendering.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
node --test tests/unit/bootstrap-runtime-ux.test.mjs tests/unit/windows-authority-winui.test.mjs
```

- [ ] **Step 3: Implement Node registry read/set**

Use the existing exact Run key/value. `status` never mutates. `off` deletes only the `GitHubDeliveryAuthority` value. `on` writes the quoted installed executable path exactly as the current implementation does.

- [ ] **Step 4: Implement CLI routing/rendering**

Bare command maps to `on`; status prints `Windows login auto-start is enabled.` or `...disabled.`; on/off print enabled/disabled outcomes without raw receipts.

- [ ] **Step 5: Add the C# registry helper**

Use `Microsoft.Win32.Registry.CurrentUser`; compare the stored value to the quoted current executable path and expose the same Run-key/value constants and enable/disable semantics.

- [ ] **Step 6: Run focused tests and commit GREEN**

Commit message: `feat: add Authority autostart state controls`.

---

### Task 3: Synchronize the Settings toggle with autostart state

**Files:**
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs`

**Interfaces:**
- XAML: `ToggleSwitch x:Name="AutostartToggle" Toggled="AutostartToggle_Toggled"`.
- Code-behind: `_refreshingAutostart` guard; `RefreshAutostart()`; `AutostartToggle_Toggled(...)`.

- [ ] **Step 1: Write failing WinUI contract test**

Assert the Settings page contains `Start Delivery Authority when I sign in`, the toggle is wired, refresh reads `AuthorityStartup.Read()`, toggle changes call `AuthorityStartup.Set(...)`, and failures restore observed state/status.

- [ ] **Step 2: Confirm RED**

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

- [ ] **Step 3: Implement Settings UI and synchronization**

Add a native Settings row with the toggle and status text. Refresh from the registry whenever Settings refreshes. Guard programmatic toggle changes so refresh does not rewrite the registry. On write failure, re-read/revert and surface the error.

- [ ] **Step 4: Confirm GREEN and commit**

Commit message: `feat: manage Authority autostart from settings`.

---

### Task 4: Center the lower two summary metrics on narrow layouts

**Files:**
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml`

**Interfaces:**
- Add `SummaryColumn5`.
- Narrow state: six equal columns; top metrics each span two columns at 0/2/4; lower metrics span two columns at 1/3.
- Medium/wide: columns 0-4 equal, column 5 width 0; all five metrics return to row 0, columns 0-4, span 1.

- [ ] **Step 1: Write failing geometry contract**

Assert narrow setters place metrics 0/1/2 at columns 0/2/4 with span 2 and metrics 3/4 at columns 1/3 with span 2. Assert medium/wide reset spans to 1 and hide column 5.

- [ ] **Step 2: Confirm RED**

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

- [ ] **Step 3: Implement only the grid geometry change**

Do not alter icons, labels, typography, card styling, breakpoints, or medium/wide visual ordering.

- [ ] **Step 4: Confirm GREEN and commit**

Commit message: `style: center narrow summary metrics`.

---

### Task 5: Final verification and preview artifact

**Files:**
- No production changes unless verification exposes a regression.

- [ ] **Step 1: Run the complete repository test/check surface**

```bash
npm run check
```

Expected: all checks pass.

- [ ] **Step 2: Verify exact-head GitHub workflows**

Require CI matrix, Architecture Contracts, Dependency Review, and CodeQL to pass on the exact final PR head.

- [ ] **Step 3: Verify Windows shipping boundary**

Require the Windows CI leg to restore/build the Authority host, run `--self-test`, run `--xaml-self-test`, publish self-contained win-x64, preserve `App.xbf`, `ApprovalWindow.xbf`, `ControlCenterWindow.xbf`, root `resources.pri`, and the Authority icon.

- [ ] **Step 4: Build a fresh preview from the exact final product head**

Use an artifact-only throwaway branch/workflow that checks out the exact product SHA, publishes win-x64 self-contained, runs both self-tests, packages the release ZIP, uploads it, then download the produced ZIP for the user. Do not modify PR #262 with the artifact workflow.
