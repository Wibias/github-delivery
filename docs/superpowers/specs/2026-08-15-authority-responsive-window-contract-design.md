# Delivery Authority responsive window contract

Date: 2026-08-15

## Status and relationship to the earlier responsive spec

This is the authoritative follow-up for the Control Center's window-size contract. It supersedes the **Window sizing**, **Dashboard layout states**, summary-metric responsive behavior, and corresponding manual-size targets in `docs/superpowers/specs/2026-08-15-authority-responsive-ui-design.md`.

All unrelated requirements from that earlier spec remain in force, including the existing visual language, full-width dashboard behavior, icon work, XBF/root-PRI packaging invariants, tray behavior, allowlist behavior, and compiled-window smoke coverage.

## Goal

Make the WinUI 3 Delivery Authority Control Center genuinely responsive at explicit window-width thresholds, while preventing the user from resizing the window below the smallest layout that remains intentionally usable.

The window must adapt its dashboard composition instead of continuously squeezing the same arrangement into less space.

## Chosen approach

Use three deterministic desktop layout states driven by XAML `AdaptiveTrigger` thresholds, plus a native minimum resize contract exposed by the existing `OverlappedPresenter`.

The states are:

- **Compact:** `720-899` effective px window width
- **Medium:** `900-1359` effective px window width
- **Wide:** `>= 1360` effective px window width

The minimum supported window size is:

- **Width:** `720 px`
- **Height:** `620 px`

The current preferred startup size remains `1080 x 760`.

## Window minimum-size contract

The Control Center must not merely resize itself once at startup. Windows must prevent interactive resizing below the supported minimum.

After resolving the `AppWindow`, the window must obtain its `OverlappedPresenter` and set:

- `PreferredMinimumWidth = 720`
- `PreferredMinimumHeight = 620`

This is a hard user-resize floor, not a layout suggestion.

If the active presenter is unexpectedly not an `OverlappedPresenter`, startup must continue. Minimum-size setup is UI hardening and must not become a new application-start failure path.

Do not introduce a custom `WM_GETMINMAXINFO` subclass unless the Windows App SDK presenter contract proves insufficient during real-machine verification.

## Breakpoint contract

### Compact — `720-899 px`

This is the smallest supported state.

Shell:

- navigation remains compact/icon-first;
- outer content padding is `16 px`;
- no horizontal page scrollbar is required.

Dashboard cards are a single vertical sequence:

1. Recent activity / Audit trail
2. Repository allowlist
3. Active temporary grants
4. Diagnostics
5. Quick settings

Activity uses the compact presentation and hides the table-style activity column header.

The layout must favor wrapping/trimming over squeezing controls into overlapping geometry. Header actions remain reachable.

### Medium — `900-1359 px`

Shell:

- navigation remains compact/icon-first;
- outer content padding is `22 px`.

Dashboard composition:

1. Recent activity spans the full content width.
2. Repository allowlist and Active temporary grants form a two-column row below it.
3. Diagnostics and Quick settings form a two-column row below that.

The activity column header is visible.

### Wide — `>= 1360 px`

Shell:

- navigation may expand to show labels;
- outer content padding is `28 px`;
- the dashboard continues using the full available width and must not reintroduce a content `MaxWidth`.

Dashboard composition:

- Recent activity is the dominant left column and spans the first two dashboard rows.
- Repository allowlist is the upper-right card.
- Active temporary grants is the lower-right card.
- Diagnostics and Quick settings remain side-by-side beneath the main activity/allowlist/grant area.

The activity column header is visible.

## Summary metrics are intentionally non-responsive

The five Overview metrics use one fixed symmetric `3 + 2` geometry at **every** supported window size.

Use six equal grid columns:

- top metric 1: columns `0-1`
- top metric 2: columns `2-3`
- top metric 3: columns `4-5`
- lower metric 1: columns `1-2`
- lower metric 2: columns `3-4`

The lower row therefore sits horizontally between the three upper metrics.

This geometry belongs in the base XAML. Responsive visual states must not set summary column widths, rows, columns, row spans, or column spans. The summary must remain identical while the rest of the dashboard changes around it.

## Navigation threshold

Keep `NavigationView` adaptive, but align its full-pane expansion with the Wide state:

- `ExpandedModeThresholdWidth = 1360`
- widths below `1360` use the compact icon-first pane
- widths at or above `1360` may use the expanded pane

The pane must not consume extra content width in Compact or Medium merely because there is technically room for labels.

## Settings page

Settings shares the same shell thresholds and outer padding:

- Compact: `16 px`
- Medium: `22 px`
- Wide: `28 px`

The existing settings content remains vertically scrollable and must fit within the `720 px` minimum-width window without requiring a horizontal scrollbar.

The existing Authority protection and auto-start controls are unchanged functionally.

## Startup and lifecycle constraints

This work must preserve all current lifecycle behavior:

- `npx github-delivery start` ensures the Authority is running and opens the Control Center visibly;
- closing the Control Center hides it to the notification area;
- tray `Exit` performs the real application exit;
- auto-start CLI and Settings toggle remain synchronized;
- existing single-instance behavior remains unchanged.

The initial `TryResize(1080, 760)` remains a best-effort startup preference. It does not replace the minimum-size contract.

## Files and responsibilities

### `ControlCenterWindow.xaml`

Owns:

- `720/900/1360` responsive state semantics through the existing VisualState group;
- Compact/Medium/Wide dashboard card placement;
- `16/22/28` adaptive page padding;
- activity-header visibility by state;
- fixed six-column symmetric summary geometry;
- navigation expansion threshold.

### `ControlCenterWindow.xaml.cs`

Owns:

- initial `1080 x 760` resize preference;
- best-effort `OverlappedPresenter` minimum-size configuration (`720 x 620`);
- existing lifecycle/data/action behavior.

Do not move dashboard composition into code-behind.

## Error handling

Responsive setup must never regress startup reliability.

- XAML state changes must remain compile-time validated by the existing WinUI build/XAML smoke path.
- Minimum presenter sizing must be best effort and must not throw out of the window constructor.
- No change may weaken the confirmed unpackaged XBF or root `resources.pri` publish requirements.

## Testing contract

### Static contract tests

Tests must verify:

1. the responsive thresholds are exactly `0`, `900`, and `1360` for Compact/Narrow, Medium, and Wide states;
2. Compact is single-column for all five dashboard cards;
3. Medium uses full-width activity plus two two-card rows;
4. Wide uses dominant-left activity plus stacked right-side allowlist/grant cards;
5. outer padding is `16`, `22`, and `28` for the three states;
6. activity column headers are hidden only in Compact;
7. the summary base grid has six equal columns and the fixed `0/2/4` top plus `1/3` lower positioning;
8. responsive states contain no summary-geometry setters;
9. the window configures `PreferredMinimumWidth` to `720` and `PreferredMinimumHeight` to `620` through an `OverlappedPresenter` without turning failures into startup failures;
10. the preferred initial size remains `1080 x 760`.

### Runtime/build smoke

The existing Windows shipping job must remain green through:

- Release build;
- `--self-test`;
- `--xaml-self-test`;
- self-contained publish;
- XBF/root-PRI assertions;
- release ZIP round trip;
- install-release smoke;
- installed `--xaml-self-test`.

### Manual acceptance sizes

Verify representative widths at or immediately around each boundary:

- `720 px`
- `899 px`
- `900 px`
- `1359 px`
- `1360 px`
- a large desktop width above `1600 px`

Acceptance at every supported size:

- window cannot be dragged below `720 x 620`;
- no horizontal main-page scrollbar;
- no title/action overlap;
- no card is clipped outside the visible content area;
- card arrangement changes at `900` and `1360` as specified;
- the summary remains the same symmetric `3 + 2` layout at every size;
- resizing back and forth across breakpoints leaves no stale rows, columns, spans, or visibility states.

## Success criteria

The responsive-window work is complete when:

1. `720 x 620` is the enforced minimum resize size;
2. Compact, Medium, and Wide layouts switch deterministically at `900` and `1360` effective px;
3. the dashboard visibly restructures rather than merely shrinking;
4. the five summary metrics remain fixed in the symmetric `3 + 2` arrangement at all sizes;
5. the application remains full-width at large sizes with no `MaxWidth` regression;
6. existing tray/start/autostart behavior is unchanged;
7. all static contracts and WinUI publish/install/XAML smoke tests pass.