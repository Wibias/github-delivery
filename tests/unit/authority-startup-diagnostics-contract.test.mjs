import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const programUrl = new URL("../../authority-host/windows/GitHubDeliveryAuthority/Program.cs", import.meta.url);
const appUrl = new URL("../../authority-host/windows/GitHubDeliveryAuthority/App.xaml.cs", import.meta.url);
const diagnosticsUrl = new URL("../../authority-host/windows/GitHubDeliveryAuthority/StartupDiagnostics.cs", import.meta.url);
const xamlSelfTestUrl = new URL("../../authority-host/windows/GitHubDeliveryAuthority/ControlCenterXamlSelfTest.cs", import.meta.url);
const releaseSmokeUrl = new URL("../../scripts/prepare-authority-host-runtime-smoke.mjs", import.meta.url);
const installerUrl = new URL("../../authority-host/windows/install-release.ps1", import.meta.url);
const ciUrl = new URL("../../.github/workflows/ci.yml", import.meta.url);

test("Authority normal startup preserves local crash diagnostics", () => {
  assert.equal(existsSync(diagnosticsUrl), true, "StartupDiagnostics.cs must exist");
  if (!existsSync(diagnosticsUrl)) return;

  const diagnostics = readFileSync(diagnosticsUrl, "utf8");
  const program = readFileSync(programUrl, "utf8");
  const app = readFileSync(appUrl, "utf8");

  assert.match(diagnostics, /startup-error\.log/);
  assert.match(diagnostics, /LocalApplicationData|AppPaths\.RootDirectory/);
  assert.match(diagnostics, /Exception/);
  assert.match(diagnostics, /HRESULT/);
  assert.match(diagnostics, /WriteMessage/);
  assert.match(program, /AppDomain\.CurrentDomain\.UnhandledException/);
  assert.match(program, /StartupDiagnostics\.Clear/);
  assert.match(program, /StartupDiagnostics\.Write/);
  assert.match(app, /UnhandledException/);
  assert.match(app, /StartupDiagnostics\.Write\(args\.Exception,[^\n]+args\.Message\)/);
  assert.doesNotMatch(app, /Handled\s*=\s*true/);
});

test("Authority has a runtime Control Center XAML smoke path", () => {
  assert.equal(existsSync(xamlSelfTestUrl), true, "ControlCenterXamlSelfTest.cs must exist");
  if (!existsSync(xamlSelfTestUrl)) return;

  const program = readFileSync(programUrl, "utf8");
  const app = readFileSync(appUrl, "utf8");
  const selfTest = readFileSync(xamlSelfTestUrl, "utf8");

  assert.match(program, /--xaml-self-test/);
  assert.match(app, /ControlCenterXamlSelfTest\.Run/);
  assert.match(selfTest, /new StateStore/);
  assert.match(selfTest, /new ControlCenterWindow\(store\)/);
  assert.match(selfTest, /window\.Close\(\)/);
});

test("Authority XAML smoke path records framework resource and runtime-module probes", () => {
  const selfTest = readFileSync(xamlSelfTestUrl, "utf8");

  assert.match(selfTest, /XamlReader\.Load/);
  assert.match(selfTest, /NavigationView/);
  assert.match(selfTest, /ApplicationPageBackgroundThemeBrush/);
  assert.match(selfTest, /CardBackgroundFillColorDefaultBrush/);
  assert.match(selfTest, /CaptionTextBlockStyle/);
  assert.match(selfTest, /AccentButtonStyle/);
  assert.match(selfTest, /Process\.GetCurrentProcess/);
  assert.match(selfTest, /Microsoft\./);
  assert.match(selfTest, /RuntimeInformation\.OSDescription/);
  assert.match(selfTest, /CurrentUICulture/);
  assert.match(selfTest, /StartupDiagnostics\.WriteMessage/);
});

test("Windows CI exercises Control Center XAML after publish, release packaging, and installation", () => {
  assert.equal(existsSync(releaseSmokeUrl), true, "release runtime smoke helper must exist");
  const ci = readFileSync(ciUrl, "utf8");
  const installer = readFileSync(installerUrl, "utf8");
  const releaseSmoke = readFileSync(releaseSmokeUrl, "utf8");

  assert.match(ci, /Run Windows authority host XAML smoke test[\s\S]*--xaml-self-test/);
  assert.match(ci, /Publish Windows authority host[\s\S]*GitHubDeliveryAuthority\.exe[\s\S]*--self-test[\s\S]*--xaml-self-test/);
  assert.match(ci, /prepare-authority-host-runtime-smoke\.mjs/);
  assert.match(ci, /install-release\.ps1[\s\S]*-SkipStart/);
  assert.match(ci, /InstalledExecutable[\s\S]*--xaml-self-test/);
  assert.match(installer, /\[switch\]\$SkipStart/);
  assert.match(installer, /if \(-not \$SkipStart\)[\s\S]*Start-Process \$installedExe/);
  assert.match(releaseSmoke, /buildAuthorityHostRelease/);
  assert.match(releaseSmoke, /extractVerifiedAuthorityHostZip/);
});

test("Windows CI retains the instrumented published Authority host for affected-machine diagnosis", () => {
  const ci = readFileSync(ciUrl, "utf8");
  assert.match(ci, /Upload instrumented Authority diagnostic build/);
  assert.match(ci, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.match(ci, /github-delivery-authority-diagnostic-\$\{\{ github\.sha \}\}/);
  assert.match(ci, /github-delivery-authority-publish/);
});
