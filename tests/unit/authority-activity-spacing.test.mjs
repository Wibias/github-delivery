import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controlCenterPath = new URL(
  "../../authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml",
  import.meta.url,
);
const controlCenterCodePath = new URL(
  "../../authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs",
  import.meta.url,
);
const approvalWindowPath = new URL(
  "../../authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml",
  import.meta.url,
);
const approvalWindowCodePath = new URL(
  "../../authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml.cs",
  import.meta.url,
);

async function read(path) {
  return readFile(path, "utf8");
}

test("control center caps recent activity and applies proportional side gutters", async () => {
  const xaml = await read(controlCenterPath);
  const code = await read(controlCenterCodePath);

  assert.match(
    xaml,
    /x:Name="ActivityList"[^>]*MinHeight="280"[^>]*MaxHeight="420"[^>]*HorizontalContentAlignment="Stretch"[^>]*ScrollViewer\.VerticalScrollBarVisibility="Auto"[^>]*ScrollViewer\.HorizontalScrollBarVisibility="Disabled"/,
  );

  assert.match(code, /RootLayout\.Loaded\s*\+=/);
  assert.match(code, /RootLayout\.SizeChanged\s*\+=/);
  assert.match(code, /Math\.Clamp\(Math\.Round\(width \* 0\.05\),\s*28,\s*64\)/);
  assert.match(code, /OverviewContent\.Padding\s*=\s*padding/);
  assert.match(code, /SettingsContent\.Padding\s*=\s*padding/);
  assert.match(code, /width >= 1360[\s\S]*24d[\s\S]*28d/);
  assert.match(code, /width >= 900[\s\S]*20d[\s\S]*24d/);
});

test("approval window applies proportional side gutters while preserving vertical padding", async () => {
  const xaml = await read(approvalWindowPath);
  const code = await read(approvalWindowCodePath);

  assert.match(code, /RootLayout\.Loaded\s*\+=/);
  assert.match(code, /RootLayout\.SizeChanged\s*\+=/);
  assert.match(code, /Math\.Clamp\(Math\.Round\(width \* 0\.05\),\s*28,\s*56\)/);
  assert.match(code, /var vertical = width >= 680 \? 28d : 16d/);
  assert.match(code, /RootLayout\.Padding\s*=\s*new Thickness\(horizontal, vertical, horizontal, vertical\)/);

  assert.match(xaml, /x:Name="ActionScrollViewer"[^>]*MinHeight="110"[^>]*VerticalScrollBarVisibility="Auto"/);
  assert.doesNotMatch(xaml, /x:Name="ApprovalBodyScrollViewer"/);
});
