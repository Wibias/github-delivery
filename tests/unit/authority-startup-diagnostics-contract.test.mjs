import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const programUrl = new URL("../../authority-host/windows/GitHubDeliveryAuthority/Program.cs", import.meta.url);
const appUrl = new URL("../../authority-host/windows/GitHubDeliveryAuthority/App.xaml.cs", import.meta.url);
const diagnosticsUrl = new URL("../../authority-host/windows/GitHubDeliveryAuthority/StartupDiagnostics.cs", import.meta.url);
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

test("Windows CI executes the published self-contained Authority binary", () => {
  const ci = readFileSync(ciUrl, "utf8");
  assert.match(ci, /Publish Windows authority host[\s\S]*GitHubDeliveryAuthority\.exe[\s\S]*--self-test/);
});
