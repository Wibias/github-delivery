import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const root = "authority-host/windows/GitHubDeliveryAuthority";

test("authority host is unpackaged self-contained WinUI 3, not WinForms", () => {
  const project = read(`${root}/GitHubDeliveryAuthority.csproj`);
  assert.match(project, /<UseWinUI>true<\/UseWinUI>/);
  assert.match(project, /<WindowsPackageType>None<\/WindowsPackageType>/);
  assert.match(project, /<WindowsAppSDKSelfContained>true<\/WindowsAppSDKSelfContained>/);
  assert.match(project, /<SelfContained>true<\/SelfContained>/);
  assert.match(project, /Microsoft\.WindowsAppSDK/);
  assert.doesNotMatch(project, /UseWindowsForms/);
});

test("installer preserves the self-contained deployment contract and CI publishes it", () => {
  const installer = read("authority-host/windows/install.ps1");
  const workflow = read(".github/workflows/ci.yml");
  assert.match(installer, /dotnet\.Source publish[\s\S]*--self-contained true/);
  assert.doesNotMatch(installer, /--self-contained false/);
  assert.match(workflow, /Publish Windows authority host/);
  assert.match(workflow, /dotnet publish[\s\S]*--self-contained true/);
});

test("control center implements the selected activity-first audit design in light/dark system theme", () => {
  const app = read(`${root}/App.xaml`);
  const window = read(`${root}/ControlCenterWindow.xaml`);
  assert.doesNotMatch(app, /RequestedTheme=/);
  for (const phrase of [
    "Audit dashboard",
    "Monitor activity, approvals, and policy enforcement.",
    "Recent activity / Audit trail",
    "Repository allowlist",
    "Active temporary grants",
    "Diagnostics",
    "Quick settings",
    "READY",
  ]) assert.match(window, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const nav of ["Overview", "Activity", "Allowlist", "Temporary grants", "Diagnostics", "Settings"]) {
    assert.match(window, new RegExp(`Content=\\"${nav}\\"`));
  }
});

test("approval UI uses the refined design without GitHub or Windows brand logos", () => {
  const window = read(`${root}/ApprovalWindow.xaml`);
  assert.match(window, /Approve GitHub mutation/);
  assert.match(window, /Approve with Windows Hello/);
  assert.match(window, /Only this branch/);
  assert.doesNotMatch(window, /Octocat|GitHubLogo|WindowsLogo/);
});

test("tray integration uses native Shell_NotifyIcon rather than WinForms NotifyIcon", () => {
  const tray = read(`${root}/TrayIcon.cs`);
  const program = read(`${root}/Program.cs`);
  assert.match(tray, /Shell_NotifyIcon/);
  assert.doesNotMatch(tray, /System\.Windows\.Forms|NotifyIcon\s/);
  assert.doesNotMatch(program, /System\.Windows\.Forms|Application\.Run/);
});
