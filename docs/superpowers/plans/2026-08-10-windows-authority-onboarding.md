# Windows Authority Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guided, fail-closed Windows authority installation and first-run flow that checks Windows Hello readiness, helps the user repair setup, verifies Hello, and adds the first allowlisted repository.

**Architecture:** Keep Windows Hello policy in `HelloVerifier`, add a focused `SetupDialog` for first-run/readiness UI, add a tiny `WindowsSettings` launcher for recovery, and have `AuthorityHostContext` decide whether setup or the existing allowlist should open. The installer performs only platform/tooling/lifecycle preflight, then launches the host with `--setup`; it never treats installer-side checks as authorization.

**Tech Stack:** .NET 8, WinForms, Windows.Security.Credentials.UI, PowerShell, Node.js 22/24 tests, GitHub Actions Windows matrix.

## Global Constraints

- Windows 11 build 22000 or newer.
- A Windows Hello PIN is sufficient; biometric hardware is not required.
- `UserConsentVerifier.CheckAvailabilityAsync()` is readiness only; `RequestVerificationForWindowAsync` remains the authorization gate.
- Repository access remains default-deny.
- Every allowlist mutation still requires a fresh successful Windows Hello verification.
- No fallback authentication path may be introduced.
- Strict trusted-authority mode must remain opt-in and must not be enabled by installation.

---

### Task 1: Windows Hello readiness model and regression tests

**Files:**
- Modify: `authority-host/windows/GitHubDeliveryAuthority/SelfTest.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/HelloVerifier.cs`

**Interfaces:**
- Produces: `HelloVerifier.Readiness(bool Available, UserConsentVerifierAvailability? Availability, string Message, bool CanOpenSignInOptions)`
- Produces: `Task<HelloVerifier.Readiness> HelloVerifier.CheckReadinessAsync()`
- Produces: `HelloVerifier.DescribeAvailability(UserConsentVerifierAvailability)`

- [ ] **Step 1: Write failing self-test coverage**

Add assertions before production code exists:

```csharp
var configured = HelloVerifier.DescribeAvailability(UserConsentVerifierAvailability.NotConfiguredForUser);
Assert(!configured.Available, "unconfigured Hello must not be ready");
Assert(configured.CanOpenSignInOptions, "unconfigured Hello must offer sign-in settings");
Assert(configured.Message.Contains("PIN", StringComparison.OrdinalIgnoreCase), "setup guidance must say a PIN is sufficient");

var absent = HelloVerifier.DescribeAvailability(UserConsentVerifierAvailability.DeviceNotPresent);
Assert(!absent.Available, "missing verifier must not be ready");
Assert(absent.CanOpenSignInOptions, "missing verifier must offer sign-in settings");
Assert(absent.Message.Contains("PIN", StringComparison.OrdinalIgnoreCase), "missing-verifier guidance must mention PIN");

var available = HelloVerifier.DescribeAvailability(UserConsentVerifierAvailability.Available);
Assert(available.Available, "available Hello must be ready");
```

Also update the existing `UserConsentVerificationResult.DeviceNotPresent` message assertion so the mutation failure text tells the user that a PIN is sufficient and points to sign-in options.

- [ ] **Step 2: Run Windows authority self-test and confirm RED**

Run on Windows CI:

```powershell
dotnet run --project authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj -c Release -- --self-test
```

Expected: compile failure because `DescribeAvailability` / `Readiness` do not exist yet.

- [ ] **Step 3: Implement minimal readiness API**

In `HelloVerifier.cs`, add:

```csharp
internal readonly record struct Readiness(
    bool Available,
    UserConsentVerifierAvailability? Availability,
    string Message,
    bool CanOpenSignInOptions);

public static async Task<Readiness> CheckReadinessAsync()
{
    if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
    {
        return new Readiness(false, null, "Windows 11 build 22000 or newer is required.", false);
    }

    try
    {
        return DescribeAvailability(await UserConsentVerifier.CheckAvailabilityAsync());
    }
    catch (Exception error)
    {
        return new Readiness(false, null, $"Windows Hello readiness check failed (0x{error.HResult:X8}): {error.Message}", false);
    }
}
```

Map `Available`, `DeviceNotPresent`, `NotConfiguredForUser`, `DisabledByPolicy`, and `DeviceBusy` explicitly. `DeviceNotPresent` and `NotConfiguredForUser` must state that a Windows Hello PIN is sufficient and that no fingerprint reader/camera is required.

Update `DescribeFailure(UserConsentVerificationResult.DeviceNotPresent)` and `NotConfiguredForUser` with the same actionable guidance.

- [ ] **Step 4: Run self-test and confirm GREEN**

Expected: Release build and self-test pass on Windows.

- [ ] **Step 5: Commit**

Commit message:

```text
Add Windows Hello readiness diagnostics
```

---

### Task 2: Guided first-run setup and recovery UI

**Files:**
- Create: `authority-host/windows/GitHubDeliveryAuthority/WindowsSettings.cs`
- Create: `authority-host/windows/GitHubDeliveryAuthority/SetupDialog.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/AllowlistDialog.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/AuthorityHostContext.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/Program.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/SelfTest.cs`

**Interfaces:**
- Produces: `WindowsSettings.OpenSignInOptions()` returning `(bool Opened, string? Error)` through a small result record.
- Produces: `SetupDialog(StateStore store)`.
- `AuthorityHostContext(bool forceSetup)` receives the `--setup` intent from `Program`.

- [ ] **Step 1: Add pure setup-policy regression assertions**

Add a helper in `AuthorityHostContext` or a separate tiny policy helper that can be tested without showing WinForms:

```csharp
internal static bool ShouldShowSetup(bool forceSetup, int allowedRepositoryCount)
    => forceSetup || allowedRepositoryCount == 0;
```

Self-test:

```csharp
Assert(AuthorityHostContext.ShouldShowSetup(false, 0), "empty allowlist must trigger first-run setup");
Assert(AuthorityHostContext.ShouldShowSetup(true, 1), "--setup must force setup");
Assert(!AuthorityHostContext.ShouldShowSetup(false, 1), "configured host must not force setup");
```

Run and confirm RED before production implementation.

- [ ] **Step 2: Add `WindowsSettings` recovery launcher**

Use shell execution of the documented URI:

```csharp
Process.Start(new ProcessStartInfo("ms-settings:signinoptions") { UseShellExecute = true });
```

Catch exceptions and return an error string. This helper never changes authority state.

- [ ] **Step 3: Build `SetupDialog`**

The dialog must:

- run `HelloVerifier.CheckReadinessAsync()` automatically on first show;
- display a readiness status label and the returned message;
- show **Open Windows sign-in options** only when `CanOpenSignInOptions` is true;
- expose **Check again**;
- enable **Verify Windows Hello** only when readiness is available;
- call `HelloVerifier.VerifyAsync(Handle, "Verify Windows Hello for GitHub Delivery Authority setup")` for the test;
- enable repository entry only after that verification succeeds;
- accept `OWNER/REPO` and call `HelloVerifier.VerifyAsync` again for the actual allowlist mutation;
- call `StateStore.SetRepositoryAllowed(repo, true, now)` only after the second successful verification;
- show `AuthorityException.Code` on invalid repository input;
- show a clear success state and close/finish button after the repository is stored.

The setup verification and allowlist authorization are intentionally separate. A successful setup test must not be reused as mutation authorization.

- [ ] **Step 4: Integrate tray and startup behavior**

`Program.Main`:

```csharp
var forceSetup = args.Contains("--setup", StringComparer.Ordinal);
Application.Run(new AuthorityHostContext(forceSetup));
```

`AuthorityHostContext`:

- add **Setup / readiness** to the tray menu;
- schedule setup after the message loop starts when `ShouldShowSetup(forceSetup, _store.ListAllowedRepositories().Count)` is true;
- on tray double-click, open setup when allowlist is empty, otherwise open the allowlist;
- preserve all existing pipe/key initialization.

- [ ] **Step 5: Improve the existing allowlist recovery path**

When verification fails in `AllowlistDialog`, keep the failure message and, for recovery-capable states, offer to open Windows sign-in options. Do not auto-open Settings without user intent.

To support this, extend `HelloVerifier.Verification` with `bool CanOpenSignInOptions` or derive recovery eligibility from the failure result in a pure helper.

- [ ] **Step 6: Run Release build and self-test**

Expected: Windows Release build and all self-tests pass.

- [ ] **Step 7: Commit**

Commit message:

```text
Add guided Windows authority setup
```

---

### Task 3: Installer preflight, upgrade lifecycle, and contract test

**Files:**
- Modify: `authority-host/windows/install.ps1`
- Create: `tests/unit/windows-authority-onboarding.test.mjs`

**Interfaces:**
- Installer continues to accept `-InstallDir` and `-PipeName`.
- Installer launches `GitHubDeliveryAuthority.exe --setup` after publish/copy.

- [ ] **Step 1: Add a failing Node contract test**

Read the installer and assert these contracts:

```js
assert.match(installer, /Build.*22000|22000/);
assert.match(installer, /dotnet.*--list-sdks|--list-sdks.*dotnet/s);
assert.match(installer, /8\./);
assert.match(installer, /--setup/);
assert.match(installer, /Get-Process|Stop-Process/);
assert.match(installer, /PIN/i);
```

Also read `Program.cs` and assert that it recognizes `--setup`.

Run:

```bash
node --test tests/unit/windows-authority-onboarding.test.mjs
```

Expected: FAIL against the current installer.

- [ ] **Step 2: Add platform and SDK preflight**

Before publish:

- require Windows NT version build >= 22000 using `[Environment]::OSVersion.Version.Build`;
- resolve `dotnet` with `Get-Command dotnet -ErrorAction SilentlyContinue`;
- run `dotnet --list-sdks` and require at least one line beginning with `8.`;
- fail with a specific remediation message when a prerequisite is missing.

- [ ] **Step 3: Make upgrades restart the installed binary cleanly**

Before copying replacement files, find running `GitHubDeliveryAuthority` processes whose executable path resolves under `$InstallDir` and stop only those matching instances. Do not terminate unrelated processes by name alone.

After environment/shortcut setup, launch:

```powershell
Start-Process $exe -ArgumentList '--setup'
```

Print that the GUI will check Windows Hello and that a PIN is sufficient; do not claim installation is fully ready until the guided setup completes.

- [ ] **Step 4: Run Node test and PowerShell parse check**

Run:

```bash
node --test tests/unit/windows-authority-onboarding.test.mjs
```

And on Windows:

```powershell
[void][scriptblock]::Create((Get-Content authority-host/windows/install.ps1 -Raw))
```

Expected: both pass.

- [ ] **Step 5: Commit**

Commit message:

```text
Guide Windows authority installation
```

---

### Task 4: README and install-guide update

**Files:**
- Modify: `authority-host/windows/README.md`
- Modify: `INSTALL.md`
- Modify: `tests/unit/windows-authority-onboarding.test.mjs`

**Interfaces:**
- Documentation must match the shipped UI labels and installer behavior exactly.

- [ ] **Step 1: Extend the contract test with documentation assertions**

Require the Windows README to include:

- `Windows Hello PIN`;
- `Settings > Accounts > Sign-in options`;
- `DeviceNotPresent`;
- `NotConfiguredForUser`;
- `DisabledByPolicy`;
- `DeviceBusy`;
- `--setup` or first-run setup wording.

Require `INSTALL.md` to state that the optional host opens guided setup and that biometric hardware is not required when a Hello PIN is available.

Run the single test and confirm RED.

- [ ] **Step 2: Update Windows README**

Document:

1. prerequisites;
2. install command;
3. what the installer checks;
4. first-run sequence: readiness -> real Hello test -> repository -> fresh Hello confirmation -> ready;
5. recovery table for each relevant availability state;
6. exact manual path `Settings > Accounts > Sign-in options` and in-app button;
7. upgrade behavior;
8. strict mode remains disabled unless the operator opts in.

- [ ] **Step 3: Update top-level INSTALL.md**

Replace the minimal optional-host paragraph with the guided install summary and link to the detailed README.

- [ ] **Step 4: Run documentation contract test**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message:

```text
Document Windows authority onboarding
```

---

### Task 5: Full verification and pull request

**Files:**
- No new production files.

- [ ] **Step 1: Run repository checks**

```bash
npm run check
```

Expected: PASS on Node 22 and 24 CI matrix.

- [ ] **Step 2: Run Windows authority checks**

```powershell
dotnet restore authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj --locked-mode
dotnet build authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj -c Release --no-restore
dotnet run --project authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj -c Release --no-build -- --self-test
```

Expected: PASS on Windows Node 22 and 24 jobs.

- [ ] **Step 3: Review exact branch diff against `main`**

Confirm no authentication bypass, no unrelated changes, and no accidental enabling of `GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY`.

- [ ] **Step 4: Open/update draft PR**

PR title:

```text
Guide Windows authority setup and Hello recovery
```

PR body must include root cause, UX/security behavior, installer changes, docs changes, TDD red/green evidence, and exact-head CI results.

- [ ] **Step 5: Verify exact PR head**

After all branch updates, fetch workflow runs for the exact current head and require CI, CodeQL, and Dependency Review to be green before calling the PR ready.
