[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDir,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedVersion,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedSourceCommit,
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

$ErrorActionPreference = 'Stop'

# Exercise the real release installer under Windows, not a mock of Remove-Item.
$installer = Join-Path $PSScriptRoot '..\..\authority-host\windows\install-release.ps1'
$appRoot = Join-Path $InstallDir 'app'
$obsoleteDir = Join-Path $appRoot 'v0.0.1'
$lockedDll = Join-Path $obsoleteDir 'clrjit.dll'
$legacyExe = Join-Path $InstallDir 'GitHubDeliveryAuthority.exe'
$unknownDir = Join-Path $appRoot 'operator-data'
$stateFile = Join-Path $InstallDir 'authority.db'
$trustFile = Join-Path $InstallDir 'trust-store.json'

New-Item -ItemType Directory -Force -Path $obsoleteDir | Out-Null
New-Item -ItemType Directory -Force -Path $unknownDir | Out-Null
[IO.File]::WriteAllText($lockedDll, 'locked obsolete runtime')
[IO.File]::WriteAllText($legacyExe, 'locked legacy launcher')
[IO.File]::WriteAllText($stateFile, 'persistent state')
[IO.File]::WriteAllText($trustFile, 'persistent trust')

$lockedRuntime = $null
$lockedLauncher = $null
try {
    $lockedRuntime = [IO.File]::Open($lockedDll, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    $lockedLauncher = [IO.File]::Open($legacyExe, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)

    # The updater invokes Windows PowerShell 5.1; match that boundary.
    $output = & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
        -File $installer `
        -SourceDir $SourceDir `
        -ExpectedVersion $ExpectedVersion `
        -ExpectedSourceCommit $ExpectedSourceCommit `
        -InstallDir $InstallDir `
        -SkipStart 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Authority installer failed on locked obsolete files: $($output | Out-String)"
    }

    $record = Get-Content (Join-Path $InstallDir 'authority-host-install.json') -Raw | ConvertFrom-Json
    if ($record.version -ne $ExpectedVersion -or $record.sourceCommit -ne $ExpectedSourceCommit.ToLowerInvariant()) {
        throw 'Authority install record was not committed to the new release.'
    }
    if (-not (Test-Path (Join-Path $appRoot "v$ExpectedVersion\GitHubDeliveryAuthority.exe") -PathType Leaf)) {
        throw 'Authority new-version executable is missing.'
    }
    if (-not (Test-Path $lockedDll -PathType Leaf) -or -not (Test-Path $legacyExe -PathType Leaf)) {
        throw 'Locked obsolete files were unexpectedly removed during installation.'
    }
    if (($output | Out-String) -notmatch 'deferred cleanup') {
        throw 'Authority installer did not surface the deferred cleanup warning.'
    }
} finally {
    if ($lockedLauncher) { $lockedLauncher.Dispose() }
    if ($lockedRuntime) { $lockedRuntime.Dispose() }
}

# Later reinstallation must retry cleanup rather than permanently suppress it.
$output = & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $installer `
    -SourceDir $SourceDir `
    -ExpectedVersion $ExpectedVersion `
    -ExpectedSourceCommit $ExpectedSourceCommit `
    -InstallDir $InstallDir `
    -SkipStart 2>&1
if ($LASTEXITCODE -ne 0) { throw "Authority cleanup retry failed: $($output | Out-String)" }
if (Test-Path $obsoleteDir) { throw 'Obsolete runtime was not removed after its lock cleared.' }
if (Test-Path $legacyExe) { throw 'Obsolete legacy launcher was not removed after its lock cleared.' }
if (-not (Test-Path $unknownDir -PathType Container)) { throw 'Unknown application data was deleted.' }
if (([IO.File]::ReadAllText($stateFile)) -ne 'persistent state') { throw 'Authority state was changed.' }
if (([IO.File]::ReadAllText($trustFile)) -ne 'persistent trust') { throw 'Authority trust state was changed.' }
Write-Host 'Authority obsolete-file cleanup regression: PASS'
