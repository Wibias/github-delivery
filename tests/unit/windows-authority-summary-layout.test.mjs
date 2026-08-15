import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const window = readFileSync(
  new URL("../../authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml", import.meta.url),
  "utf8",
);

function visualState(name) {
  const marker = `<VisualState x:Name="${name}">`;
  const start = window.indexOf(marker);
  assert.ok(start >= 0, `${name} must exist`);
  const end = window.indexOf("</VisualState>", start);
  assert.ok(end > start, `${name} must have a closing VisualState tag`);
  return window.slice(start, end + "</VisualState>".length);
}

function assertSymmetricSummary(stateName) {
  const state = visualState(stateName);

  for (let column = 0; column < 6; column += 1) {
    assert.match(
      state,
      new RegExp(`Target="SummaryColumn${column}\\.Width" Value="\\*"`),
      `${stateName} must keep all six equal summary columns`,
    );
  }

  assert.match(
    state,
    /Target="SummarySecondRow\.Height" Value="Auto"/,
    `${stateName} must keep the second metric row visible`,
  );

  for (const [metric, row, column] of [
    [0, 0, 0],
    [1, 0, 2],
    [2, 0, 4],
    [3, 1, 1],
    [4, 1, 3],
  ]) {
    assert.match(
      state,
      new RegExp(`Target="SummaryMetric${metric}\\.\\(Grid\\.Row\\)" Value="${row}"`),
      `${stateName} must place SummaryMetric${metric} on row ${row}`,
    );
    assert.match(
      state,
      new RegExp(`Target="SummaryMetric${metric}\\.\\(Grid\\.Column\\)" Value="${column}"`),
      `${stateName} must place SummaryMetric${metric} on column ${column}`,
    );
    assert.match(
      state,
      new RegExp(`Target="SummaryMetric${metric}\\.\\(Grid\\.ColumnSpan\\)" Value="2"`),
      `${stateName} must span SummaryMetric${metric} across two sixths`,
    );
  }
}

test("summary metrics preserve the symmetric 3+2 layout at every responsive width", () => {
  for (const stateName of ["NarrowDashboardState", "MediumDashboardState", "WideDashboardState"]) {
    assertSymmetricSummary(stateName);
  }
});
