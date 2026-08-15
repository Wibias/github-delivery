# Authority start, autostart, and summary alignment design

## Scope

This pass makes three small user-facing improvements to the Windows Delivery Authority Control Center without changing the established close-to-tray lifecycle, startup packaging fix, release behavior, or approval semantics.

1. `npx github-delivery start` must make the Control Center visible, not merely ensure the tray process is running.
2. Autostart must be controllable from both the CLI and the Control Center Settings page through one shared Windows startup-state implementation.
3. The five overview summary metrics must keep the top three where they are while horizontally centering the lower two in the unused space between the top-row columns.

## Start command behavior

`npx github-delivery start` becomes the user-facing "show me the Authority UI" command while retaining its existing responsibility to ensure the Authority process is running and ready.

- If no Authority process is running, start it, wait for readiness, then make the Control Center visible.
- If the Authority process is already running in the notification area, do not start a second process. Ask the existing instance to show/activate the Control Center.
- Preserve the existing single-instance mutex and close-to-tray behavior.
- The CLI success output must explain that closing the window keeps Authority running in the notification area and that the process can be stopped completely with notification-area icon -> right-click -> `Exit`.
- The output should also include the installed executable/location when available, so the user can see where Authority lives.

The preferred implementation is to reuse the existing Authority IPC boundary rather than add a second coordination mechanism. A small host command such as `show_control_center` is dispatched by the running Authority instance onto the WinUI dispatcher and calls the existing `ShowControlCenter()` path. The Node bootstrap client calls that command after readiness is established. This works for both freshly started and already-running instances.

## Autostart state and CLI

Autostart remains the existing per-user `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run` registration named `GitHubDeliveryAuthority`. There must be exactly one implementation of how that registration is inspected and changed.

CLI behavior:

- `npx github-delivery autostart` keeps backward-compatible behavior and enables autostart.
- `npx github-delivery autostart on` enables it.
- `npx github-delivery autostart off` disables it.
- `npx github-delivery autostart status` reports enabled/disabled without changing it.

The startup helper should expose explicit read/set operations instead of the current enable-only helper. Both the CLI and WinUI Settings page use those same semantics.

## Settings UI

Add a native Settings-row control for "Start Delivery Authority when I sign in".

- On opening/refreshing Settings, read the current registration and set the toggle accordingly.
- Changing the toggle applies the new startup state immediately through the same startup-state implementation used by the CLI.
- Show a short status message for success/failure.
- Do not create a separate config file or duplicate the startup state in SQLite/UserConfig.

Because the Control Center executable cannot import Node code, the shared source of truth is the same Windows Run-key contract: identical key/value name, identical executable-path validation, and matching enable/disable/status semantics in both implementations. Tests pin that contract so the two surfaces cannot drift.

## Overview metric alignment

Keep the existing five metrics and visual treatment. Only change the narrow-layout geometry for the lower row:

- top row stays: Repositories / Active Grants / Approved Today in the current three equal columns;
- bottom row stays at the same vertical position;
- Denied Today and Expired Today are centered horizontally beneath the gaps between the top-row metrics instead of occupying the first two columns;
- medium/wide single-row behavior remains unchanged.

Use additional grid columns/column spans or equivalent native XAML layout; do not add cards, decorative separators, gradients, or other redesign elements.

## Error handling

- `start`: if Authority becomes ready but the show command fails, return a specific start/open failure rather than claiming the window was shown.
- `autostart`: registry query failures surface as status/error; unsupported platforms remain explicit and unchanged.
- Settings toggle: if applying the registry change fails, revert the toggle to the observed state and display the error.

## Verification

Add regression coverage before production changes for:

- `start` requesting Control Center visibility for both newly started and already-running Authority instances;
- CLI success guidance mentioning notification area, right-click `Exit`, and installation/executable path when available;
- `autostart`, `autostart on`, `autostart off`, and `autostart status` parsing/rendering;
- shared Run-key/value contract and enable/disable/status behavior;
- Settings UI wiring and refresh synchronization;
- lower summary-row centering while preserving top-three and medium/wide layouts.

Final verification must include the normal repository checks plus Windows Authority build, `--self-test`, `--xaml-self-test`, self-contained publish, and a fresh win-x64 preview ZIP built from the exact final PR head.

## Out of scope

- No new `open` CLI command.
- No change to close-to-tray behavior.
- No version bump, tag, release, merge, or npm publication.
- No redesign beyond the requested summary alignment and autostart Settings row.
