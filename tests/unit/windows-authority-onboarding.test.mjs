import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Windows authority installers enforce supported platform and guided setup", () => {
  const installer = read("authority-host/windows/install.ps1");
  const releaseInstaller = read("authority-host/windows/install-release.ps1");
  const program = read("authority-host/windows/GitHubDeliveryAuthority/Program.cs");
  const appHost = read("authority-host/windows/GitHubDeliveryAuthority/AuthorityAppHost.cs");

  assert.match(installer, /22000/);
  assert.match(installer, /--list-sdks/);
  assert.match(installer, /8\./);
  assert.match(installer, /install-release\.ps1/);
  assert.match(installer, /PIN/i);

  assert.match(releaseInstaller, /Get-Process/);
  assert.match(releaseInstaller, /Start-Process \$installedExe/);

  assert.match(program, /args\.Contains\("--setup",\s*StringComparer\.Ordinal\)/);
  assert.match(appHost, /ShouldShowSetup\(_forceSetup,\s*_store\.ListAllowedRepositories\(\)\.Count\)/);
  assert.match(appHost, /forceSetup\s*\|\|\s*allowedRepositoryCount\s*==\s*0/);
});

test("Windows authority documentation explains Hello setup and recovery", () => {
  const windowsReadme = read("authority-host/windows/README.md");
  const installGuide = read("INSTALL.md");

  assert.match(windowsReadme, /Windows Hello PIN/i);
  assert.match(windowsReadme, /Settings\s*>\s*Accounts\s*>\s*Sign-in options/i);
  assert.match(windowsReadme, /DeviceNotPresent/);
  assert.match(windowsReadme, /NotConfiguredForUser/);
  assert.match(windowsReadme, /DisabledByPolicy/);
  assert.match(windowsReadme, /DeviceBusy/);
  assert.match(windowsReadme, /--setup|first-run setup/i);

  assert.match(installGuide, /guided setup/i);
  assert.match(installGuide, /Windows Hello PIN/i);
  assert.match(installGuide, /biometric hardware is not required/i);
});

test("release installer does not persist authority overrides in the user environment", () => {
  const releaseInstaller = read("authority-host/windows/install-release.ps1");

  assert.doesNotMatch(releaseInstaller, /SetEnvironmentVariable\(/);
});
