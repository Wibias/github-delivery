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
const approvalCoordinatorPath = new URL(
  "../../authority-host/windows/GitHubDeliveryAuthority/ApprovalCoordinator.cs",
  import.meta.url,
);
const stateStorePath = new URL(
  "../../authority-host/windows/GitHubDeliveryAuthority/StateStore.cs",
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

test("approval window keeps a fixed shell and scrolls only proposed action content", async () => {
  const xaml = await read(approvalWindowPath);

  assert.match(xaml, /x:Name="RootLayout"/);
  assert.doesNotMatch(xaml, /x:Name="ApprovalBodyScrollViewer"/);
  assert.match(
    xaml,
    /<Grid.RowDefinitions>\s*<RowDefinition Height="Auto"\s*\/>\s*<RowDefinition Height="Auto"\s*\/>\s*<RowDefinition Height="Auto"\s*\/>\s*<RowDefinition Height="\*"\s*\/>\s*<RowDefinition Height="Auto"\s*\/>\s*<RowDefinition Height="Auto"\s*\/>\s*<RowDefinition Height="Auto"\s*\/>\s*<\/Grid.RowDefinitions>/,
  );
  assert.match(
    xaml,
    /x:Name="ActionScrollViewer"[^>]*MinHeight="110"[^>]*VerticalScrollBarVisibility="Auto"/,
  );
  assert.doesNotMatch(xaml, /x:Name="ActionScrollViewer"[^>]*MaxHeight=/);

  const actionStart = xaml.indexOf('x:Name="ActionScrollViewer"');
  const actionEnd = xaml.indexOf("</ScrollViewer>", actionStart);
  const securityStart = xaml.indexOf('Text="Security"');
  const branchStart = xaml.indexOf('Text="Only this branch"');
  const footerStart = xaml.indexOf('x:Name="ApproveButton"');
  assert.ok(actionStart >= 0 && actionEnd > actionStart);
  assert.ok(securityStart > actionEnd);
  assert.ok(branchStart > actionEnd);
  assert.ok(footerStart > actionEnd);
});

test("approval window enforces the fixed-shell minimum size", async () => {
  const source = await read(approvalWindowCodePath);

  assert.match(source, /TrySetMinimumWindowSize\(560,\s*640\)/);
});

test("branch lease controls are vertically aligned and offer one through ten minutes", async () => {
  const xaml = await read(approvalWindowPath);

  assert.match(xaml, /x:Name="BranchGrantDuration"[^>]*SelectedIndex="0"[^>]*VerticalAlignment="Center"/);
  assert.match(xaml, /x:Name="BranchGrantToggle"[^>]*VerticalAlignment="Center"/);
  for (let minute = 1; minute <= 10; minute += 1) {
    assert.match(xaml, new RegExp(`Content="${minute} min"\\s+Tag="${minute}"`));
  }
  assert.doesNotMatch(xaml, /Content="11 min"/);
});

test("branch lease validation accepts ten minutes at every host boundary", async () => {
  const window = await read(approvalWindowCodePath);
  const coordinator = await read(approvalCoordinatorPath);
  const store = await read(stateStorePath);

  assert.match(window, /minutes is >= 1 and <= 10/);
  assert.match(coordinator, /minutes < 1 \|\| minutes > 10/);
  assert.match(store, /minutes is < 1 or > 10/);
  assert.doesNotMatch(window, /minutes is >= 1 and <= 5/);
  assert.doesNotMatch(coordinator, /minutes < 1 \|\| minutes > 5/);
  assert.doesNotMatch(store, /minutes is < 1 or > 5/);
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
