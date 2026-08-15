# Delivery Authority responsive UI design

Date: 2026-08-15

## Goal

Make the existing WinUI 3 Delivery Authority Control Center behave correctly across small, medium, and large desktop window sizes without redesigning its visual language or disturbing the confirmed unpackaged WinUI startup/resource fix.

The work also gives the executable and window a real application icon by reusing the existing peach Authority shield/swirl mark already shown in the UI.

## Current problems

The current `ControlCenterWindow.xaml` assumes a comfortable desktop width rather than adapting to the actual content area:

- the `NavigationView` is permanently open at `OpenPaneLength="172"`;
- the main body is fixed to a `2.15* / 1*` two-column composition;
- card headers place a title and right-aligned button in the same unconstrained grid, so they overlap when width is scarce;
- the activity heading row contains fixed-width `72`, `92`, and `90` columns plus proportional columns, which clips at narrow widths;
- the five summary metrics are forced into one row regardless of available width;
- the pane footer has no robust wrapping/trimming behavior;
- the main content is capped at `MaxWidth="1180"`, so larger windows do not use space proportionally;
- the constructor forces an initial `1080 x 760` size, but the UI does not remain usable once the user resizes away from that size.

The screenshots from the affected machine confirm these symptoms: narrow windows crush the right-side cards, overlap header text and buttons, clip list content, and cut navigation/footer labels.

## Non-goals

This is not a visual redesign. The following remain unchanged unless required for responsive behavior:

- dark/light theme behavior;
- card styling, corner radii, borders, and current theme resources;
- current information hierarchy and labels;
- current navigation destinations and actions;
- state-store behavior, approval logic, protection-mode logic, and installer behavior;
- the confirmed XBF and root `resources.pri` publish fix.

No speculative replacement of `NavigationView`, no custom fallback theme brushes, and no reintroduction of prior startup-diagnostic UI workarounds.

## Chosen approach

Use a hybrid adaptive WinUI layout:

1. Let `NavigationView` handle pane adaptation through its native display modes.
2. Use XAML `VisualStateManager` and named layout containers for dashboard breakpoints.
3. Keep code-behind focused on data/actions, adding only minimal window/icon setup when necessary.
4. Use one permanent compiled-window smoke path to protect startup/resource behavior after the UI changes.

This avoids a brittle all-code layout while also avoiding an excessively complicated XAML-only solution for every dynamic detail.

## Responsive shell

### Navigation behavior

Use `PaneDisplayMode="Auto"` rather than a permanently open left pane.

The selected behavior is:

- wide/comfortable widths: full navigation pane with icons and labels;
- narrow widths: compact icon-only pane remains visible;
- do not collapse all navigation behind a hamburger-only minimal pane for the target narrow desktop state.

The compact pane must preserve tooltips/accessibility names for icons so navigation remains understandable when labels are hidden.

The pane footer must also adapt. In expanded mode it may show the existing Authority mark plus `Protection mode` and the current mode. In compact mode it must reduce to an icon-first presentation without clipped text.

### Window sizing

Keep the current best-effort initial resize only as a startup preference, not as an assumption the layout depends on.

The user must be able to resize the window down to a narrow but usable desktop width without overlapping or clipped controls.

## Dashboard layout states

Breakpoints are based on the available content width after the navigation pane, not on a fixed screen resolution.

The implementation may tune exact thresholds during testing, but the initial targets are:

- **Wide:** approximately `>= 1180 px` content width
- **Medium:** approximately `760-1179 px` content width
- **Narrow:** approximately `< 760 px` content width

The acceptance behavior matters more than the exact threshold number.

### Wide state

Preserve the current overall composition:

- title/subtitle and READY badge in one header row;
- five summary metrics in one row;
- recent activity as the dominant left card;
- repository allowlist and temporary grants stacked on the right;
- diagnostics and quick settings side by side below;
- full navigation pane.

The dashboard should remain visually centered but may use more width than the current hard `1180 px` ceiling where that improves spacing.

### Medium state

Use the compact icon-only navigation pane.

Dashboard composition:

- title/subtitle and READY badge remain usable without overlap;
- five summary metrics remain one row if they fit with their defined minimums;
- recent activity spans the full content width;
- allowlist and temporary grants become a two-card row beneath activity;
- diagnostics and quick settings remain a two-card row;
- outer padding and inter-card spacing reduce modestly.

### Narrow state

Use the compact icon-only navigation pane.

Dashboard becomes a single vertical flow:

1. page header;
2. summary metrics;
3. recent activity;
4. repository allowlist;
5. active temporary grants;
6. diagnostics;
7. quick settings.

The summary metrics must not be crushed into five unusably narrow columns. They should reflow to a stable multi-row arrangement, initially targeted as `3 + 2`, while keeping icon, value, and label aligned.

Cards must stretch to available width and never retain stale two-column widths.

## Card header contract

Every card header with an action uses an explicit two-column layout:

- column 0: `*` for title;
- column 1: `Auto` for action button;
- minimum spacing between them;
- title either remains on one line with character ellipsis or wraps only where explicitly chosen;
- action buttons keep their intrinsic width and must never draw over the title.

This applies to at least:

- `Recent activity / Audit trail` + `View full activity`;
- `Repository allowlist` + `+ Add repository`;
- `Active temporary grants` + `Revoke selected`.

## Text and content behavior

### Navigation and footer

- expanded navigation labels remain fully readable;
- compact navigation relies on icons plus accessible labels/tooltips;
- the protection-mode footer may wrap in expanded mode, but compact mode must not show partially clipped words.

### Dashboard headings and labels

- page title and primary card titles remain readable;
- nonessential one-line labels may use `TextTrimming="CharacterEllipsis"`;
- descriptive body copy uses wrapping rather than clipping;
- no text may render underneath another control.

### Activity content

The current fixed-width pseudo-table header is not allowed to remain rigid in narrow mode.

Wide/medium may retain a multi-column presentation if it fits. Narrow mode must simplify the activity presentation rather than preserve columns that cannot fit. Acceptable implementation forms include stacked per-item text or a reduced set of visible columns, as long as the event remains understandable and no content overlaps.

The empty-state row must remain legible at every breakpoint.

### Allowlist and grants

Long repository and branch names must trim or wrap predictably rather than widening or clipping the card.

The action buttons remain reachable and visually separated from titles.

## Settings page

The settings page already wraps most descriptive text and is less structurally fragile than the dashboard, but it must follow the same shell behavior.

Required improvements:

- use the same responsive navigation pane behavior;
- reduce horizontal page padding on narrow widths;
- installation detail rows must not depend on a permanent `170 px` label column at narrow widths;
- long source commit/config path values must trim or wrap cleanly;
- protection-mode radio descriptions must remain readable without horizontal clipping.

## Application icon

Reuse the existing peach Authority shield/swirl mark as the program identity.

Create a proper multi-resolution Windows `.ico` containing at least:

- 16x16
- 20x20
- 24x24
- 32x32
- 40x40
- 48x48
- 64x64
- 128x128
- 256x256

The visual must preserve the same peach mark used in the current UI and remain recognizable at 16-24 px sizes. It should not introduce a new logo system.

Integration requirements:

- set the project `ApplicationIcon` to the `.ico` file so the executable carries the icon;
- set the WinUI `AppWindow` icon from the same asset so title bar/taskbar/window identity is consistent;
- ensure the icon asset is present in build and self-contained publish output where runtime loading requires it.

## Code structure

### `ControlCenterWindow.xaml`

Owns:

- adaptive navigation settings;
- named dashboard containers;
- responsive visual states;
- card header grids;
- responsive text behavior;
- wide/medium/narrow layout composition.

### `ControlCenterWindow.xaml.cs`

Keeps:

- data refresh;
- navigation selection handling;
- grant revoke logic;
- settings persistence;
- installation metadata reading.

May add only narrowly scoped UI plumbing such as:

- app/window icon setup;
- a small helper if WinUI requires code to expose the current content width or trigger a layout state that cannot be expressed reliably in XAML.

Do not move dashboard composition wholesale into code-behind.

### `GitHubDeliveryAuthority.csproj`

Adds the application icon declaration and any required asset-copy metadata while preserving:

- `EnableMsixTooling`;
- `ProjectPriFileName=resources.pri`;
- `CopyUnpackagedWinUiResourcesToPublish`;
- all XBF/root-PRI publish invariants.

## Error handling

Responsive layout must not create new startup-failure paths.

Icon setup is non-critical UI decoration. If the runtime window-icon call cannot be performed, the application must continue starting rather than failing the Control Center.

The executable-embedded application icon is a build-time invariant and should be verified by project/asset tests where practical.

## Testing

### Static/unit contracts

Add or update tests to verify that:

- `NavigationView` is configured for adaptive/compact behavior rather than permanently forcing the full pane;
- responsive visual states/breakpoint definitions exist;
- dashboard/card headers use constrained title/action columns;
- narrow-state layout does not keep the wide two-column body arrangement;
- settings installation rows have a narrow-safe layout;
- the project declares the Authority `.ico` application icon;
- the existing XBF/root-PRI publish contract remains unchanged.

Avoid brittle tests that merely snapshot arbitrary whitespace or every XAML property.

### WinUI smoke coverage

The existing `--xaml-self-test` must continue to instantiate and close the real compiled `ControlCenterWindow` successfully.

CI must continue exercising it from:

- build output;
- self-contained publish output;
- installed release-smoke output.

### Manual responsive acceptance

Verify at representative sizes, including roughly:

- large desktop: around 1400 px+ window width;
- current default: around 1080 px;
- medium: around 850-900 px;
- narrow: around 630-700 px.

At every size:

- no title/button overlap;
- no clipped navigation labels in expanded mode;
- no partially visible labels in compact mode;
- no card content rendered outside its card;
- no horizontal scrollbar required for the main dashboard;
- summary metrics remain readable;
- activity information remains understandable;
- settings page remains usable;
- resizing back and forth does not leave cards in the wrong position or width.

### Icon acceptance

Verify that the same Authority mark appears in:

- the executable in Explorer;
- the window/title-bar identity;
- the taskbar when the app is running.

The 16-24 px variants must remain visually recognizable and not look like a generic Windows default app icon.

## Success criteria

The work is complete when:

1. the Control Center remains visually consistent with the current design;
2. the narrow-window failure shown in the supplied screenshot is eliminated;
3. wide windows use space without stretched or awkwardly isolated content;
4. navigation automatically becomes icon-only at narrow widths;
5. no text, icon, or action button overlaps another control;
6. no core dashboard card is clipped or pushed outside the visible content width;
7. the peach Authority mark is the real executable/window icon;
8. the affected-machine `--xaml-self-test` and all existing publish/install smoke tests still pass;
9. the XBF and `resources.pri` packaging fix remains intact.
