# Authority activity cap and edge spacing design

Date: 2026-08-16
Target: github-delivery 0.8.1 Windows Delivery Authority hotfix
Branch: `test/0.8.1-authority-hotfix`

## Goal

Keep the Control Center audit trail from growing indefinitely, and give the two top-level Authority windows slightly more horizontal breathing room without changing their existing responsive behaviour.

## Scope

This change covers the two top-level WinUI windows in the current Authority host:

- `ControlCenterWindow`
- `ApprovalWindow`

Code-driven `ContentDialog` surfaces such as setup and allowlist dialogs are not part of this spacing adjustment. Their density and sizing rules are independent from the top-level window edge spacing.

## Recent activity / Audit trail

The current `ActivityList` has `MinHeight="280"` but no maximum height. Its desired height therefore keeps increasing as more audit entries are rendered.

### Required behaviour

- Keep the existing minimum height of 280 px.
- Add a maximum height of 420 px to `ActivityList`.
- Keep horizontal scrolling disabled.
- Enable automatic vertical scrolling inside `ActivityList` once its content exceeds the available 420 px viewport.
- Do not make the entire Activity card or Control Center page taller just because additional audit rows exist.
- The Control Center page itself may continue to use its existing outer page scrolling for the dashboard as a whole.
- The activity list must remain usable at narrow, medium, and wide responsive states.

This produces the intended range:

- few audit rows: the list remains at least 280 px tall;
- more rows: the list can grow naturally up to 420 px;
- beyond 420 px: the list stops growing and scrolls internally.

## Horizontal edge spacing

The request for about 10% more side space is interpreted as approximately 10% more horizontal padding than the current responsive values. It is not 10% of the full window width. This avoids excessive dead space on large monitors and preserves the existing breakpoints.

Vertical padding is unchanged.

### Control Center

Apply the increase consistently to both Overview and Settings content:

| Responsive state | Current horizontal padding | New horizontal padding |
| --- | ---: | ---: |
| Narrow | 16 px | 18 px |
| Medium | 22 px | 24 px |
| Wide | 28 px | 31 px |

Existing top and bottom padding values stay unchanged.

Therefore the responsive values become:

- Narrow: `18,16,18,20`
- Medium: `24,20,24,24`
- Wide: `31,24,31,28`

The same values apply to `OverviewContent.Padding` and `SettingsContent.Padding`.

### Approval window

Increase only the left and right root padding. Keep the existing fixed-shell design, minimum window size, description-only scrolling, and vertical spacing unchanged.

| Responsive state | Current root padding | New root padding |
| --- | ---: | ---: |
| Narrow | 16 px | 18 px |
| Wide | 28 px | 31 px |

Because `RootLayout.Padding` is currently uniform, implementation should use explicit horizontal/vertical values so only the side spacing grows:

- Narrow: `18,16,18,16`
- Wide: `31,28,31,28`

This avoids accidentally adding extra vertical height to the approval shell.

## Non-goals

This change does not:

- change the 560 x 640 approval minimum window size;
- change the 110 px minimum Proposed action viewport;
- add main-window scrolling to the approval window;
- change audit retention or the number of audit rows loaded from SQLite;
- change the 1 to 10 minute branch lease range;
- change Windows Hello behaviour;
- redesign card padding, typography, navigation width, or dialog density.

## Testing

Add or extend source regression tests so they verify:

1. `ActivityList` keeps `MinHeight="280"`.
2. `ActivityList` has `MaxHeight="420"`.
3. `ActivityList` uses automatic vertical scrolling and disabled horizontal scrolling.
4. Control Center narrow, medium, and wide states use the new horizontal padding values for both Overview and Settings.
5. Approval narrow and wide states use the new explicit side-heavy padding values.
6. The approval fixed-shell contract remains intact, including description-only scrolling and the 560 x 640 minimum size.

The Windows Authority build, self-test, XAML smoke test, published-binary smoke test, and ZIP build must still pass before producing the next local test package.
