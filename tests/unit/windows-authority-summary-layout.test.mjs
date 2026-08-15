import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const window = readFileSync(
  new URL("../../authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml", import.meta.url),
  "utf8",
);

function element(name) {
  const marker = `x:Name="${name}"`;
  const markerIndex = window.indexOf(marker);
  assert.ok(markerIndex >= 0, `${name} must exist`);
  const start = window.lastIndexOf("<", markerIndex);
  const end = window.indexOf(">", markerIndex);
  assert.ok(start >= 0 && end > markerIndex, `${name} must have a valid opening tag`);
  return window.slice(start, end + 1);
}

test("summary metrics use one static symmetric 3+2 layout at every window width", () => {
  for (let column = 0; column < 6; column += 1) {
    assert.match(
      window,
      new RegExp(`<ColumnDefinition x:Name="SummaryColumn${column}" Width="\\*" \\/>`),
      `SummaryColumn${column} must be an equal-width base column`,
    );
  }

  const expected = [
    ["SummaryMetric0", 0, 0],
    ["SummaryMetric1", 0, 2],
    ["SummaryMetric2", 0, 4],
    ["SummaryMetric3", 1, 1],
    ["SummaryMetric4", 1, 3],
  ];

  for (const [metric, row, column] of expected) {
    const tag = element(metric);
    assert.match(tag, new RegExp(`Grid\\.Row="${row}"`), `${metric} must stay on row ${row}`);
    assert.match(tag, new RegExp(`Grid\\.Column="${column}"`), `${metric} must stay on column ${column}`);
    assert.match(tag, /Grid\.ColumnSpan="2"/, `${metric} must span two sixths`);
  }

  assert.doesNotMatch(
    window,
    /Target="Summary(?:Column\d+\.Width|SecondRow\.Height|Metric\d+\.\(Grid\.(?:Row|Column|ColumnSpan)\))"/,
    "responsive states must not override the summary geometry",
  );
});
