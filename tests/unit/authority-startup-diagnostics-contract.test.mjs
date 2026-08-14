import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const programUrl = new URL("../../authority-host/windows/GitHubDeliveryAuthority/Program.cs", import.meta.url);
const appUrl = new URL("../../authority-host/windows/GitHubDeliveryAuthority/App.xaml.cs", import.meta.url);
const diagnosticsUrl = new URL("../../authority-host/windows/GitHubDeliveryAuthority/StartupDiagnostics.cs", import.meta.url);
const xamlSelfTestUrl = new URL("../../authority-host/windows/GitHubDeliveryAuthority/ControlCenterXamlSelfTest.cs", import.meta.url);
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
  assert.match(program, /AppDomain\.CurrentDomain\.UnhandledException/);
  assert.match(program, /StartupDiagnostics\.Clear/);
  assert.match(program, /StartupDiagnostics\.Write/);
  assert.match(app, /UnhandledException/);
  assert.match(app, /StartupDiagnostics\.Write/);
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

test("Windows CI executes core and XAML smoke tests on the published self-contained Authority binary", () => {
  const ci = readFileSync(ciUrl, "utf8");
  assert.match(ci, /Run Windows authority host XAML smoke test[\s\S]*--xaml-self-test/);
  assert.match(ci, /Publish Windows authority host[\s\S]*GitHubDeliveryAuthority\.exe[\s\S]*--self-test[\s\S]*--xaml-self-test/);
});
