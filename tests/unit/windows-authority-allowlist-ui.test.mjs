import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const root = "authority-host/windows/GitHubDeliveryAuthority";

test("Control Center exposes only functional allowlist actions", () => {
  const window = read(`${root}/ControlCenterWindow.xaml`);

  assert.doesNotMatch(window, /Content="View full activity"/);
  assert.match(window, /x:Name="AddRepositoryButton"[\s\S]*?Content="\+ Add repository"[\s\S]*?Click="AddRepository_Click"/);
  const addButton = window.match(/<Button x:Name="AddRepositoryButton"[\s\S]*?\/>/)?.[0];
  assert.ok(addButton, "Add repository button must be present");
  assert.doesNotMatch(addButton, /IsEnabled="False"/);
  assert.match(window, /x:Name="RemoveRepositoryButton"[\s\S]*?Content="Remove selected"[\s\S]*?IsEnabled="False"[\s\S]*?Click="RemoveRepository_Click"/);
  assert.match(window, /x:Name="AllowlistList"[\s\S]*?SelectionChanged="AllowlistList_SelectionChanged"/);
});

test("allowlist rows do not repeat an Allowed status label", () => {
  const code = read(`${root}/ControlCenterWindow.xaml.cs`);

  assert.doesNotMatch(code, /repositories\.Select\([^\n]*Allowed/);
  assert.doesNotMatch(code, /\{repo\}[^\n]*Allowed/);
});

test("Control Center add and remove repository actions preserve Windows Hello authorization", () => {
  const code = read(`${root}/ControlCenterWindow.xaml.cs`);

  assert.match(code, /private async void AddRepository_Click\(/);
  assert.match(code, /new ContentDialog[\s\S]*?Title\s*=\s*"Add repository"/);
  assert.match(code, /PlaceholderText\s*=\s*"owner\/repo"/i);
  assert.match(code, /await VerifyHelloAsync\([^\n]*trusted grants/);
  assert.match(code, /_store\.SetRepositoryAllowed\(repo, true,/);

  assert.match(code, /private async void RemoveRepository_Click\(/);
  assert.match(code, /await VerifyHelloAsync\([^\n]*allowlist/);
  assert.match(code, /_store\.SetRepositoryAllowed\(repo, false,/);
  assert.match(code, /private async Task<bool> VerifyHelloAsync\(/);
  assert.match(code, /HelloVerifier\.VerifyAsync\(/);
});
