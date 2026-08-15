import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const root = "authority-host/windows/GitHubDeliveryAuthority";
const xaml = read(`${root}/ControlCenterWindow.xaml`);
const code = read(`${root}/ControlCenterWindow.xaml.cs`);

function visualState(name) {
  const marker = `<VisualState x:Name="${name}">`;
  const start = xaml.indexOf(marker);
  assert.ok(start >= 0, `${name} must exist`);
  const end = xaml.indexOf("</VisualState>", start);
  assert.ok(end > start, `${name} must close`);
  return xaml.slice(start, end + "</VisualState>".length);
}

function assertSetter(state, target, value) {
  assert.match(
    state,
    new RegExp(`Target="${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" Value="${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
  );
}

function assertCardPlacement(state, card, row, column, columnSpan, rowSpan = 1) {
  assertSetter(state, `${card}.(Grid.Row)`, String(row));
  assertSetter(state, `${card}.(Grid.Column)`, String(column));
  assertSetter(state, `${card}.(Grid.ColumnSpan)`, String(columnSpan));
  if (rowSpan !== 1) assertSetter(state, `${card}.(Grid.RowSpan)`, String(rowSpan));
}

test("Control Center switches at the approved 900 and 1360 responsive breakpoints", () => {
  const compact = visualState("NarrowDashboardState");
  const medium = visualState("MediumDashboardState");
  const wide = visualState("WideDashboardState");

  assert.match(compact, /<AdaptiveTrigger MinWindowWidth="0"\s*\/>/);
  assert.match(medium, /<AdaptiveTrigger MinWindowWidth="900"\s*\/>/);
  assert.match(wide, /<AdaptiveTrigger MinWindowWidth="1360"\s*\/>/);

  assertSetter(compact, "OverviewContent.Padding", "16,16,16,20");
  assertSetter(compact, "SettingsContent.Padding", "16,16,16,20");
  assertSetter(medium, "OverviewContent.Padding", "22,20,22,24");
  assertSetter(medium, "SettingsContent.Padding", "22,20,22,24");
  assertSetter(wide, "OverviewContent.Padding", "28,24,28,28");
  assertSetter(wide, "SettingsContent.Padding", "28,24,28,28");

  assertSetter(compact, "ActivityColumnsHeader.Visibility", "Collapsed");
  assertSetter(medium, "ActivityColumnsHeader.Visibility", "Visible");
  assertSetter(wide, "ActivityColumnsHeader.Visibility", "Visible");

  assert.match(xaml, /ExpandedModeThresholdWidth="1360"/);
});

test("Compact, Medium, and Wide states deliberately restructure dashboard cards", () => {
  const compact = visualState("NarrowDashboardState");
  const medium = visualState("MediumDashboardState");
  const wide = visualState("WideDashboardState");

  assertCardPlacement(compact, "ActivityCard", 0, 0, 2);
  assertCardPlacement(compact, "AllowlistCard", 1, 0, 2);
  assertCardPlacement(compact, "GrantCard", 2, 0, 2);
  assertCardPlacement(compact, "DiagnosticsCard", 3, 0, 2);
  assertCardPlacement(compact, "QuickSettingsCard", 4, 0, 2);

  assertCardPlacement(medium, "ActivityCard", 0, 0, 2);
  assertCardPlacement(medium, "AllowlistCard", 1, 0, 1);
  assertCardPlacement(medium, "GrantCard", 1, 1, 1);
  assertCardPlacement(medium, "DiagnosticsCard", 2, 0, 1);
  assertCardPlacement(medium, "QuickSettingsCard", 2, 1, 1);

  assertCardPlacement(wide, "ActivityCard", 0, 0, 1, 2);
  assertCardPlacement(wide, "AllowlistCard", 0, 1, 1);
  assertCardPlacement(wide, "GrantCard", 1, 1, 1);
  assertCardPlacement(wide, "DiagnosticsCard", 2, 0, 1);
  assertCardPlacement(wide, "QuickSettingsCard", 2, 1, 1);
});

test("summary geometry is static and is never overridden by responsive states", () => {
  for (const stateName of ["NarrowDashboardState", "MediumDashboardState", "WideDashboardState"]) {
    const state = visualState(stateName);
    assert.doesNotMatch(state, /Target="Summary(?:Column|Metric|SecondRow)/, `${stateName} must not own summary geometry`);
  }

  for (let column = 0; column < 6; column += 1) {
    assert.match(xaml, new RegExp(`<ColumnDefinition x:Name="SummaryColumn${column}" Width="\\*" \\/>`));
  }
});

test("Control Center enforces a best-effort 720 x 620 minimum and keeps 1080 x 760 startup size", () => {
  assert.match(code, /TrySetMinimumWindowSize\(720,\s*620\)/);
  assert.match(code, /_appWindow\.Presenter\s+is\s+OverlappedPresenter\s+presenter/);
  assert.match(code, /presenter\.PreferredMinimumWidth\s*=\s*width/);
  assert.match(code, /presenter\.PreferredMinimumHeight\s*=\s*height/);
  assert.match(code, /private void TrySetMinimumWindowSize\(int width, int height\)[\s\S]*?try[\s\S]*?catch/);
  assert.match(code, /TryResize\(1080,\s*760\)/);
});
