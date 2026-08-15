# Delivery Authority responsive window contract implementation plan

Date: 2026-08-15

Design source: `docs/superpowers/specs/2026-08-15-authority-responsive-window-contract-design.md`

## Goal

Implement the approved three-state responsive window contract for the WinUI 3 Delivery Authority Control Center while preserving the existing startup/XBF/PRI, tray, start, autostart, allowlist, and lifecycle behavior.

Final behavior:

- minimum interactive window size: `720 x 620`;
- Compact: `720-899`;
- Medium: `900-1359`;
- Wide: `>=1360`;
- summary metrics use one static symmetric `3 + 2` base geometry at all widths;
- no responsive state owns summary placement;
- initial window preference remains `1080 x 760`.

## Task 1 — Replace obsolete responsive contracts with RED tests

Files:

- modify `tests/unit/windows-authority-winui.test.mjs`;
- modify `tests/unit/windows-authority-summary-layout.test.mjs` only if needed to harden the static-summary contract.

Test changes:

1. Replace the old `840` Medium threshold expectation with `900`.
2. Assert Narrow/Compact trigger `0`, Medium `900`, Wide `1360`.
3. Assert Compact card placement is one vertical stack.
4. Assert Medium is activity full-width + allowlist/grant two-column row + diagnostics/quick-settings two-column row.
5. Assert Wide is activity dominant-left spanning two rows + allowlist/grant stacked right + bottom diagnostics/quick-settings row.
6. Assert `16/22/28` Overview and Settings padding.
7. Assert activity columns are hidden only in Compact and visible in Medium/Wide.
8. Assert every responsive state contains no `SummaryColumn`, `SummaryMetric`, or `SummarySecondRow` setters.
9. Assert the base summary remains six equal columns with top `0/2/4` and bottom `1/3`, each spanning two columns.
10. Assert code-behind configures `OverlappedPresenter.PreferredMinimumWidth = 720` and `PreferredMinimumHeight = 620` in a best-effort helper.
11. Assert initial `TryResize(1080, 760)` remains.

Run the focused tests before production edits and confirm RED for the intended reasons: current Medium threshold is `840`, state-level summary setters still exist, and no presenter minimum-size configuration exists.

## Task 2 — Make summary geometry entirely static

File:

- `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml`

Changes:

1. Keep all six base summary columns at `Width="*"`.
2. Keep base metric placement:
   - metric 0: row 0 / col 0 / span 2;
   - metric 1: row 0 / col 2 / span 2;
   - metric 2: row 0 / col 4 / span 2;
   - metric 3: row 1 / col 1 / span 2;
   - metric 4: row 1 / col 3 / span 2.
3. Remove all `SummaryColumn*.Width`, `SummarySecondRow.Height`, and `SummaryMetric*` grid setters from Narrow, Medium, and Wide VisualStates.

Run summary + responsive focused tests. Summary contract must become GREEN independently of window state.

## Task 3 — Lock the responsive breakpoints and card compositions

File:

- `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml`

Changes:

1. Keep Narrow/Compact trigger at `MinWindowWidth="0"`.
2. Change Medium trigger from `840` to `900`.
3. Keep Wide trigger at `1360`.
4. Preserve padding:
   - Compact `16,16,16,20`;
   - Medium `22,20,22,24`;
   - Wide `28,24,28,28`.
5. Preserve/verify card placement exactly as the design specifies.
6. Preserve activity-header visibility: collapsed Compact, visible Medium/Wide.
7. Preserve `ExpandedModeThresholdWidth="1360"` and full-width content without `MaxWidth`.

Run focused responsive contracts again.

## Task 4 — Enforce the minimum interactive window size

File:

- `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs`

Changes:

1. Add a narrowly scoped `TrySetMinimumWindowSize(int width, int height)` helper.
2. Use `_appWindow.Presenter is OverlappedPresenter presenter`.
3. Set:
   - `presenter.PreferredMinimumWidth = 720`;
   - `presenter.PreferredMinimumHeight = 620`.
4. Call the helper after resolving `_appWindow`.
5. Wrap it in `try/catch` so presenter/minimum-size setup can never become a new startup failure path.
6. Keep `TryResize(1080, 760)` unchanged as the startup preference.

Run focused tests and the real Windows WinUI build/XAML smoke in CI.

## Task 5 — Regression verification

Run/require on the exact final product head:

- focused `windows-authority-summary-layout.test.mjs`;
- focused WinUI responsive contract tests;
- full repository checks;
- Architecture Contracts;
- Dependency Review;
- CodeQL;
- Windows Node 24 Authority shipping path including Release build, `--self-test`, `--xaml-self-test`, self-contained publish, XBF/root-PRI checks, release ZIP round-trip, install-release smoke, and installed `--xaml-self-test`.

Do not weaken or modify the critical `CopyUnpackagedWinUiResourcesToPublish` target.

## Task 6 — Fresh local-test preview

After all final-head gates are green, build a fresh self-contained `win-x64` preview ZIP from the exact final PR product SHA on a separate artifact-only branch/workflow.

The artifact workflow must:

- use `permissions: contents: read`;
- explicitly check out the final product SHA;
- restore locked dependencies;
- publish self-contained `win-x64`;
- run `--self-test`;
- run `--xaml-self-test`;
- package with the existing release-packaging script;
- upload the resulting ZIP.

Download and integrity-test the runnable inner ZIP before giving it to the user. Do not merge, tag, release, publish npm, or bump the version.