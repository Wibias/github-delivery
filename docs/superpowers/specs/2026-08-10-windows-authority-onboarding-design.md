# Windows authority onboarding design

## Goal

Make the optional Windows authority host installable and diagnosable by a normal Windows user without requiring them to understand `UserConsentVerifier` result codes or discover Windows Hello setup steps independently.

The security boundary does not change: Windows Hello remains mandatory wherever the authority host currently requires it, repository access remains default-deny, and no fallback authorization path is added.

## Current problem

The merged hotfix for PR #176 makes Windows Hello failures visible, but the user can still complete installation with an unusable Hello configuration and discover the problem only after pressing **Add** in the repository allowlist.

The current installer publishes and starts the host without checking Windows Hello readiness. The current host opens directly as a tray application and has no first-run readiness flow. The README lists requirements but does not guide the user through fixing a failed prerequisite.

## Approaches considered

### 1. Installer-only preflight

The PowerShell installer could check Windows version, .NET, and Windows Hello before publishing.

This catches problems early but does not help later if Hello becomes unavailable, policy changes, or a user launches an already-installed host on a different configuration. It also makes the PowerShell installer responsible for reproducing application-level Windows Runtime behavior.

### 2. Host-only first-run wizard

The application could perform all readiness checks after installation.

This gives the best interactive repair experience but still allows the installer to report success before the authority host is usable. It also provides weak command-line feedback for scripted installs.

### 3. Combined installer preflight plus host onboarding

Use lightweight installer checks for platform/tooling and let the host own the authoritative Windows Hello availability and verification checks. The installer starts the host in setup mode after publish. The host presents a first-run setup dialog until the prerequisites and first repository allowlist step succeed.

This is the selected approach because it catches failures before the user assumes installation is complete while keeping Windows Hello behavior in one C# implementation.

## Design

### Hello readiness API

Extend `HelloVerifier` with a non-mutating readiness check based on `UserConsentVerifier.CheckAvailabilityAsync()`.

Return a structured result containing:

- whether Hello is available;
- a stable availability state for tests and UI decisions;
- an actionable user-facing explanation;
- whether opening Windows sign-in settings is a useful recovery action.

Availability mappings:

- `Available`: ready for a verification attempt;
- `NotConfiguredForUser`: explain that a Windows Hello PIN is sufficient and offer Windows sign-in settings;
- `DeviceNotPresent`: explain that Windows cannot currently expose a supported Hello verifier, that a PIN is sufficient, and offer Windows sign-in settings;
- `DisabledByPolicy`: explain that policy blocks the feature and that an administrator may need to change it;
- `DeviceBusy`: explain that Hello is temporarily busy and provide retry guidance;
- exception or unsupported Windows version: show the concrete failure and do not claim readiness.

`VerifyAsync` remains the authoritative consent gate for protected actions. Availability checking never substitutes for successful verification.

### Settings recovery action

Add a small Windows settings launcher that opens `ms-settings:signinoptions` using shell execution. Use it only as a recovery action. Failure to launch Settings is reported to the user and never changes authorization state.

### First-run setup dialog

Add a dedicated setup dialog shown automatically when the authority host starts with an empty allowlist.

The dialog contains three stages in one compact window:

1. **Windows Hello readiness**
   - Run the availability check automatically.
   - Show ready/not-ready state and actionable text.
   - When relevant, provide **Open Windows sign-in options**.
   - Provide **Check again**.

2. **Windows Hello verification test**
   - Enable **Verify Windows Hello** only after readiness is available.
   - Require a real successful `RequestVerificationForWindowAsync` result before repository setup is enabled.
   - A canceled or failed test keeps the setup incomplete.

3. **Repository allowlist**
   - Accept `OWNER/REPO`.
   - Reuse the existing `StateStore.SetRepositoryAllowed` validation and persistence.
   - Require a fresh Windows Hello verification for the actual allowlist mutation, even if the setup verification test just passed. The test proves readiness; it is not authorization for the mutation.
   - On success, show a clear ready state and allow the dialog to close.

Closing the wizard without completing setup leaves the tray host running but with an empty default-deny allowlist. The tray menu remains available so setup can be retried.

### Existing allowlist dialog

Keep the existing allowlist workflow, but improve failure messages so `DeviceNotPresent` and `NotConfiguredForUser` include the concrete recovery path and make it clear that a PIN is enough. Add an **Open Windows sign-in options** action for recoverable Hello failures instead of requiring the user to navigate manually.

### Tray behavior

Add a **Setup / readiness** tray action so users can rerun diagnostics after first run. Double-click behavior may continue to open the allowlist after setup is complete. When the allowlist is empty, double-click should open setup instead.

### Installer

Update `install.ps1` to:

- fail clearly on non-Windows-11-build-22000 environments before publish;
- check that `dotnet` exists and that an 8.x SDK is installed before publish;
- publish/copy as today;
- terminate an already-running per-user authority-host process from the same install path before replacing/restarting the executable, so upgrades do not leave the old single-instance process active;
- start the installed host with a `--setup` argument so the guided setup opens immediately;
- print that a Windows Hello PIN is sufficient and that the GUI will validate Hello readiness;
- never enable strict authority mode automatically.

The installer does not attempt to authorize repositories itself and does not treat a PowerShell-side heuristic as proof that Windows Hello verification will work.

### Command-line setup switch

Teach `Program` / `AuthorityHostContext` to accept a setup request at launch. The normal single-instance rule remains. For a newly started host, `--setup` opens the setup dialog immediately after the tray context is initialized.

If an existing instance already owns the mutex, this PR does not add cross-process activation. The installer therefore stops the installed instance before launching the replacement binary during upgrades.

## Error handling

All prerequisite failures must be visible and actionable. Do not silently return from setup actions.

No error path may:

- add a repository without a successful Hello verification;
- mark setup complete merely because availability is `Available`;
- create an authentication fallback;
- enable strict authority mode automatically.

## Testing

Extend the Windows authority self-test with pure mapping fixtures for Hello availability and recovery metadata.

Add unit-testable helpers for installer prerequisite decisions where practical, and add repository tests that inspect `install.ps1` for the required preflight/setup behavior if the existing test suite uses script contract tests.

CI acceptance:

- locked .NET restore succeeds;
- Release build succeeds on the Windows matrix;
- Windows authority self-test passes;
- repository Node test suite passes;
- CodeQL and dependency review remain green.

## Documentation

Update `authority-host/windows/README.md` with:

- a guided prerequisite checklist;
- explicit statement that a Windows Hello PIN is sufficient and a biometric sensor is not required;
- the automatic first-run setup flow;
- recovery steps for `NotConfiguredForUser`, `DeviceNotPresent`, `DisabledByPolicy`, and `DeviceBusy`;
- the exact Settings path and the in-app button;
- upgrade behavior;
- a short manual readiness troubleshooting section.

Update `INSTALL.md` so the optional Windows authority section describes the guided setup instead of only linking to the sub-README.
