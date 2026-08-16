import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controlCenterPath = new URL(
  "../../authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml",
  import.meta.url,
);
const approvalWindowPath = new URL(
  "../../authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml",
  import.meta.url,
);

async function read(path) {
  return readFile(path, "utf8");
}

test("control center caps recent activity and keeps responsive edge spacing", async () => {
  const xaml = await read(controlCenterPath);

  assert.match(
    xaml,
    /x:Name="ActivityList"[^>]*MinHeight="280"[^>]*MaxHeight="420"[^>]*HorizontalContentAlignment="Stretch"[^>]*ScrollViewer\.VerticalScrollBarVisibility="Auto"[^>]*ScrollViewer\.HorizontalScrollBarVisibility="Disabled"/,
  );

  for (const value of ["18,16,18,20", "24,20,24,24", "31,24,31,28"]) {
    assert.match(xaml, new RegExp(`Target="OverviewContent\\.Padding" Value="${value}"`));
    assert.match(xaml, new RegExp(`Target="SettingsContent\\.Padding" Value="${value}"`));
  }
});

test("approval window adds horizontal edge space without changing vertical padding", async () => {
  const xaml = await read(approvalWindowPath);

  assert.match(xaml, /Target="RootLayout\.Padding" Value="18,16,18,16"/);
  assert.match(xaml, /Target="RootLayout\.Padding" Value="31,28,31,28"/);
  assert.doesNotMatch(xaml, /Target="RootLayout\.Padding" Value="16"/);
  assert.doesNotMatch(xaml, /Target="RootLayout\.Padding" Value="28"/);

  assert.match(xaml, /x:Name="ActionScrollViewer"[^>]*MinHeight="110"[^>]*VerticalScrollBarVisibility="Auto"/);
  assert.doesNotMatch(xaml, /x:Name="ApprovalBodyScrollViewer"/);
});
