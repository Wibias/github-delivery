import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const approvalWindowPath = new URL(
  "../../authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml",
  import.meta.url,
);
const approvalWindowCodePath = new URL(
  "../../authority-host/windows/GitHubDeliveryAuthority/ApprovalWindow.xaml.cs",
  import.meta.url,
);
const authorityServicePath = new URL(
  "../../authority-host/windows/GitHubDeliveryAuthority/AuthorityService.cs",
  import.meta.url,
);
const helloVerifierPath = new URL(
  "../../authority-host/windows/GitHubDeliveryAuthority/HelloVerifier.cs",
  import.meta.url,
);

async function read(path) {
  return readFile(path, "utf8");
}

test("approval window keeps a fixed footer and scrollable content", async () => {
  const xaml = await read(approvalWindowPath);

  assert.match(xaml, /x:Name="RootLayout"/);
  assert.match(xaml, /<RowDefinition Height="Auto"\s*\/?>[\s\S]*<RowDefinition Height="\*"\s*\/?>[\s\S]*<RowDefinition Height="Auto"\s*\/?>/);
  assert.match(xaml, /x:Name="ApprovalBodyScrollViewer"[\s\S]*VerticalScrollBarVisibility="Auto"/);
  assert.match(xaml, /x:Name="ActionScrollViewer"[\s\S]*VerticalScrollBarVisibility="Auto"/);
});

test("branch lease controls are vertically aligned", async () => {
  const xaml = await read(approvalWindowPath);

  assert.match(xaml, /x:Name="BranchGrantDuration"[^>]*VerticalAlignment="Center"/);
  assert.match(xaml, /x:Name="BranchGrantToggle"[^>]*VerticalAlignment="Center"/);
});

test("approval summary shows the exact branch-driving fields", async () => {
  const source = await read(authorityServicePath);

  assert.match(source, /operation\.TryGetProperty\("branch"/);
  assert.match(source, /operation\.TryGetProperty\("head"/);
  assert.match(source, /operation\.TryGetProperty\("base"/);
});

test("Windows Hello TPM parameter failures are classified and retryable", async () => {
  const verifier = await read(helloVerifierPath);
  const window = await read(approvalWindowCodePath);

  assert.match(verifier, /0x80284002/);
  assert.match(verifier, /TBS_E_BAD_PARAMETER/);
  assert.match(verifier, /CanRetry:\s*true/);
  assert.match(window, /PrimaryButtonText = verification\.CanRetry/);
  assert.match(window, /WindowsSettings\.OpenSignInOptions\(\)/);
});
