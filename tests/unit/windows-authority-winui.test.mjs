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

test("source installer preserves self-contained deployment and delegates to the release installer", () => {
  const installer = read("authority-host/windows/install.ps1");
  const releaseInstaller = read("authority-host/windows/install-release.ps1");
  const workflow = read(".github/workflows/ci.yml");
  assert.match(installer, /dotnet\.Source publish[\s\S]*--self-contained true/);
  assert.match(installer, /install-release\.ps1/);
  assert.doesNotMatch(installer, /--self-contained false/);
  assert.match(releaseInstaller, /authority-host-version\.json/);
  assert.match(releaseInstaller, /authority-host-install\.json/);
  assert.match(releaseInstaller, /Join-Path \$InstallDir 'app'/);
  assert.match(releaseInstaller, /Join-Path \$appRoot \('v' \+ \$ExpectedVersion\)/);
  assert.match(releaseInstaller, /authority\.db/);
  assert.match(releaseInstaller, /trust-store\.json/);
  assert.doesNotMatch(releaseInstaller, /dotnet publish|dotnet\.Source publish/);
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
  assert.match(window, /<ListView x:Name="NavigationList"/);
  for (const nav of ["Overview", "Activity", "Allowlist", "Temporary grants", "Diagnostics", "Settings"]) {
    assert.match(window, new RegExp(`Text=\\"${nav}\\"`));
  }
});

test("control center owns startup-safe local brushes instead of affected WinUI Fluent brush keys", () => {
  const window = read(`${root}/ControlCenterWindow.xaml`);
  const selfTest = read(`${root}/ControlCenterXamlSelfTest.cs`);

  assert.match(window, /<Grid[^>]*Background="\{ThemeResource ApplicationPageBackgroundThemeBrush\}"[^>]*>\s*<Grid\.Resources>/);
  assert.doesNotMatch(window, /<Window\.Resources>/);
  for (const key of [
    "AuthorityCardBackgroundBrush",
    "AuthorityCardStrokeBrush",
    "AuthorityAccentBrush",
    "AuthoritySuccessBackgroundBrush",
    "AuthoritySuccessBrush",
    "AuthorityCriticalBrush",
    "AuthorityCautionBrush",
  ]) {
    assert.match(window, new RegExp(`x:Key=\\"${key}\\"`));
    assert.match(window, new RegExp(`\\{StaticResource ${key}\\}`));
  }

  for (const affectedKey of [
    "CardBackgroundFillColorDefaultBrush",
    "CardStrokeColorDefaultBrush",
    "AccentTextFillColorPrimaryBrush",
    "SystemFillColorSuccessBackgroundBrush",
    "SystemFillColorSuccessBrush",
    "SystemFillColorCriticalBrush",
    "SystemFillColorCautionBrush",
  ]) {
    assert.doesNotMatch(window, new RegExp(affectedKey));
  }

  assert.match(selfTest, /Local\.StaticResource/);
});

test("settings page exposes and persists exactly the three authority protection modes", () => {
  const window = read(`${root}/ControlCenterWindow.xaml`);
  const code = read(`${root}/ControlCenterWindow.xaml.cs`);
  const store = read(`${root}/UserConfigStore.cs`);

  for (const phrase of [
    "Sensitive actions (Recommended)",
    "Every GitHub write",
    "No Windows Hello prompts.",
    "Delivery Authority",
    "Source commit",
    "Config file",
  ]) assert.match(window, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(window, /SelectionChanged="NavigationList_SelectionChanged"/);
  assert.match(window, /Click="ApplyProtectionMode_Click"/);
  assert.match(code, /UserConfigStore\.WriteAuthorityMode\(mode\)/);
  assert.match(code, /authority-host-version\.json/);
  assert.match(store, /WriteAuthorityMode\(string mode\)/);
  for (const mode of ["off", "high-assurance", "all"]) assert.match(store, new RegExp(`\\"${mode}\\"`));
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