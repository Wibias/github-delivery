import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

test("unpackaged publish carries compiled XAML and a root PRI resource index", () => {
  const project = read(`${root}/GitHubDeliveryAuthority.csproj`);
  const workflow = read(".github/workflows/ci.yml");

  assert.match(project, /<EnableMsixTooling>true<\/EnableMsixTooling>/);
  assert.match(project, /<ProjectPriFileName>resources\.pri<\/ProjectPriFileName>/);
  assert.match(project, /CopyUnpackagedWinUiResourcesToPublish/);
  assert.match(project, /AfterTargets="Publish"/);
  assert.match(project, /XamlGeneratedOutputPath\)\*\.xbf/);
  assert.doesNotMatch(project, /XamlGeneratedOutputPath\)\*\*\\\*\.xbf/);
  assert.match(project, /ProjectPriFullPath/);
  assert.match(project, /resources\.pri/);
  assert.match(project, /DestinationFiles=/);
  assert.match(workflow, /App\.xbf/);
  assert.match(workflow, /ControlCenterWindow\.xbf/);
  assert.match(workflow, /resources\.pri/);
});

test("custom WinUI entry point preserves generated XAML process initialization", () => {
  const program = read(`${root}/Program.cs`);
  assert.match(program, /DllImport\("Microsoft\.ui\.xaml\.dll"\)[\s\S]*XamlCheckProcessRequirements/);

  const processCheck = program.indexOf("XamlCheckProcessRequirements();");
  const comWrappers = program.indexOf("WinRT.ComWrappersSupport.InitializeComWrappers();");
  const applicationStart = program.indexOf("Application.Start(");

  assert.ok(processCheck >= 0, "custom Main must call XamlCheckProcessRequirements");
  assert.ok(processCheck < comWrappers, "XAML process requirements must be checked before COM wrappers initialize");
  assert.ok(comWrappers < applicationStart, "COM wrappers must initialize before Application.Start");
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
  assert.match(window, /Content="Overview"/);
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
  assert.match(window, /SelectionChanged="Navigation_SelectionChanged"/);
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

test("control center exposes only Overview plus the built-in bottom Settings target", () => {
  const window = read(`${root}/ControlCenterWindow.xaml`);
  const code = read(`${root}/ControlCenterWindow.xaml.cs`);

  assert.match(window, /IsSettingsVisible="True"/);
  assert.match(window, /<NavigationViewItem Content="Overview" Tag="overview" IsSelected="True"/);
  for (const deadItem of ["Activity", "Allowlist", "Temporary grants", "Diagnostics"]) {
    assert.doesNotMatch(window, new RegExp(`<NavigationViewItem Content=\\"${deadItem}\\"`));
  }
  assert.doesNotMatch(window, /<NavigationView\.PaneFooter>/);
  assert.match(code, /args\.IsSettingsSelected/);
  assert.match(code, /Navigation\.SelectedItem\s*=\s*Navigation\.SettingsItem/);
});

test("control center uses all available content width while preserving adaptive states", () => {
  const window = read(`${root}/ControlCenterWindow.xaml`);

  assert.match(window, /PaneDisplayMode="Auto"/);
  assert.match(window, /CompactModeThresholdWidth="0"/);
  assert.match(window, /ExpandedModeThresholdWidth="1360"/);
  assert.match(window, /<Grid x:Name="OverviewContent"(?=[^>]*HorizontalAlignment="Stretch")(?![^>]*MaxWidth=)[^>]*>/);
  assert.match(window, /<Grid x:Name="SettingsContent"(?=[^>]*HorizontalAlignment="Stretch")(?![^>]*MaxWidth=)[^>]*>/);

  for (const state of ["NarrowDashboardState", "MediumDashboardState", "WideDashboardState"]) {
    assert.match(window, new RegExp(`x:Name=\\"${state}\\"`));
  }

  for (const card of ["ActivityCard", "AllowlistCard", "GrantCard", "DiagnosticsCard", "QuickSettingsCard"]) {
    assert.match(window, new RegExp(`x:Name=\\"${card}\\"`));
  }

  assert.match(window, /MinWindowWidth="840"/);
  assert.match(window, /MinWindowWidth="1360"/);

  for (const header of ["ActivityHeaderGrid", "AllowlistHeaderGrid", "GrantHeaderGrid"]) {
    assert.match(
      window,
      new RegExp(`x:Name=\\"${header}\\"[\\s\\S]*?<ColumnDefinition Width=\\"\\*\\"[\\s\\S]*?<ColumnDefinition Width=\\"Auto\\"`),
    );
  }

  assert.match(window, /x:Name="ActivityColumnsHeader"/);
  assert.match(window, /Target="ActivityColumnsHeader\.Visibility" Value="Collapsed"/);
  assert.doesNotMatch(window, /<ColumnDefinition Width="170"\s*\/>/);
});

test("authority executable and Control Center use the committed Authority icon", () => {
  const project = read(`${root}/GitHubDeliveryAuthority.csproj`);
  const code = read(`${root}/ControlCenterWindow.xaml.cs`);
  const icon = new URL(`../../${root}/Assets/DeliveryAuthority.ico`, import.meta.url);

  assert.equal(existsSync(icon), true, "DeliveryAuthority.ico must be committed under Assets");
  assert.match(project, /<ApplicationIcon>Assets\\DeliveryAuthority\.ico<\/ApplicationIcon>/);
  assert.match(project, /<Content Include="Assets\\DeliveryAuthority\.ico">[\s\S]*?<CopyToOutputDirectory>PreserveNewest<\/CopyToOutputDirectory>[\s\S]*?<CopyToPublishDirectory>PreserveNewest<\/CopyToPublishDirectory>/);
  assert.match(code, /TrySetWindowIcon\(\);/);
  assert.match(code, /Path\.Combine\(AppContext\.BaseDirectory,\s*"Assets",\s*"DeliveryAuthority\.ico"\)/);
  assert.match(code, /appWindow\.SetIcon\(iconPath\)/);
  assert.match(code, /private void TrySetWindowIcon\(\)[\s\S]*?try[\s\S]*?catch/);
});
