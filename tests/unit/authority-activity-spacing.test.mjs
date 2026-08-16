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

test("control center caps recent activity and uses visible responsive side gutters", async () => {
  const xaml = await read(controlCenterPath);

  assert.match(
    xaml,
    /x:Name="ActivityList"[^>]*MinHeight="280"[^>]*MaxHeight="420"[^>]*HorizontalContentAlignment="Stretch"[^>]*ScrollViewer\.VerticalScrollBarVisibility="Auto"[^>]*ScrollViewer\.HorizontalScrollBarVisibility="Disabled"/,
  );

  for (const value of ["28,16,28,20", "44,20,44,24", "64,24,64,28"]) {
    assert.match(xaml, new RegExp(`Target="OverviewContent\\.Padding" Value="${value}"`));
    assert.match(xaml, new RegExp(`Target="SettingsContent\\.Padding" Value="${value}"`));
  }

  for (const oldValue of ["18,16,18,20", "24,20,24,24", "31,24,31,28"]) {
    assert.doesNotMatch(xaml, new RegExp(`Target="OverviewContent\\.Padding" Value="${oldValue}"`));
  }
});

test("approval window uses visible responsive side gutters without changing vertical padding", async () => {
  const xaml = await read(approvalWindowPath);

  assert.match(xaml, /Target="RootLayout\.Padding" Value="28,16,28,16"/);
  assert.match(xaml, /Target="RootLayout\.Padding" Value="40,28,40,28"/);
  assert.match(xaml, /x:Name="ExtraWideApprovalState"[\s\S]*?<AdaptiveTrigger MinWindowWidth="1120"[\s\S]*?Target="RootLayout\.Padding" Value="56,28,56,28"/);

  for (const oldValue of ["18,16,18,16", "31,28,31,28"]) {
    assert.doesNotMatch(xaml, new RegExp(`Target="RootLayout\\.Padding" Value="${oldValue}"`));
  }

  assert.match(xaml, /x:Name="ActionScrollViewer"[^>]*MinHeight="110"[^>]*VerticalScrollBarVisibility="Auto"/);
  assert.doesNotMatch(xaml, /x:Name="ApprovalBodyScrollViewer"/);
});
