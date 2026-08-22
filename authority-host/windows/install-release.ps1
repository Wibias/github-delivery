[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDir,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedVersion,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedSourceCommit,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'GitHubDeliveryAuthority'),
    [string]$PipeName = 'github-delivery-authority-v1',
    [switch]$SkipStart
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'GitHub Delivery Authority can only be installed on Windows.'
}
if ([Environment]::OSVersion.Version.Build -lt 22000) {
    throw 'Windows 11 build 22000 or newer is required.'
}
if ($ExpectedVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw 'ExpectedVersion must be semantic x.y.z.'
}
if ($ExpectedSourceCommit -notmatch '^[0-9a-fA-F]{40}$') {
    throw 'ExpectedSourceCommit must be a 40-character commit SHA.'
}

$SourceDir = [IO.Path]::GetFullPath($SourceDir)
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$versionPath = Join-Path $SourceDir 'authority-host-version.json'
$exe = Join-Path $SourceDir 'GitHubDeliveryAuthority.exe'
if (-not (Test-Path $SourceDir -PathType Container)) { throw 'Verified Authority source directory is missing.' }
if (-not (Test-Path $versionPath -PathType Leaf)) { throw 'Verified Authority version metadata is missing.' }
if (-not (Test-Path $exe -PathType Leaf)) { throw 'Verified Authority executable is missing.' }

$versionInfo = Get-Content $versionPath -Raw | ConvertFrom-Json
if ($versionInfo.schemaVersion -ne 1 -or $versionInfo.kind -ne 'github-delivery/authority-host-version') {
    throw 'Authority version metadata is invalid.'
}
if ($versionInfo.version -ne $ExpectedVersion) { throw 'Authority version metadata does not match the expected version.' }
if ($versionInfo.sourceCommit.ToLowerInvariant() -ne $ExpectedSourceCommit.ToLowerInvariant()) {
    throw 'Authority source commit does not match the expected commit.'
}
if ($versionInfo.platform -ne 'win32' -or $versionInfo.arch -ne 'x64') {
    throw 'Authority platform metadata is invalid.'
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$appRoot = Join-Path $InstallDir 'app'
New-Item -ItemType Directory -Force -Path $appRoot | Out-Null
$targetDir = Join-Path $appRoot ('v' + $ExpectedVersion)
$stagingDir = Join-Path $appRoot ('.staging-' + [guid]::NewGuid().ToString('N'))

$installRootPrefix = $InstallDir.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$recordPath = Join-Path $InstallDir 'authority-host-install.json'
$previousExe = $null
if (Test-Path $recordPath -PathType Leaf) {
    try {
        $previousRecord = Get-Content $recordPath -Raw | ConvertFrom-Json
        if ($previousRecord.appDir) {
            $candidate = [IO.Path]::Combine(
                $InstallDir,
                ($previousRecord.appDir -replace '/', [string][char][IO.Path]::DirectorySeparatorChar),
                'GitHubDeliveryAuthority.exe'
            )
            if (Test-Path $candidate -PathType Leaf) { $previousExe = $candidate }
        }
    }
    catch { }
}
if (-not $previousExe) {
    $legacyExe = Join-Path $InstallDir 'GitHubDeliveryAuthority.exe'
    if (Test-Path $legacyExe -PathType Leaf) { $previousExe = $legacyExe }
}

$stoppedBroker = $false
try {
    New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
    Copy-Item (Join-Path $SourceDir '*') $stagingDir -Recurse -Force
    $stagedExe = Join-Path $stagingDir 'GitHubDeliveryAuthority.exe'
    if (-not (Test-Path $stagedExe -PathType Leaf)) { throw 'Staged Authority executable is missing.' }

    $installedProcesses = Get-Process -Name 'GitHubDeliveryAuthority' -ErrorAction SilentlyContinue | Where-Object {
        try {
            $processPath = $_.Path
            if (-not $processPath) { return $false }
            [IO.Path]::GetFullPath($processPath).StartsWith($installRootPrefix, [StringComparison]::OrdinalIgnoreCase)
        }
        catch { $false }
    }
    foreach ($process in $installedProcesses) {
        Stop-Process -Id $process.Id -Force
        Wait-Process -Id $process.Id -ErrorAction SilentlyContinue
        $stoppedBroker = $true
    }

    if (Test-Path $targetDir) {
        Remove-Item $targetDir -Recurse -Force
    }
    Move-Item $stagingDir $targetDir

    $installedExe = Join-Path $targetDir 'GitHubDeliveryAuthority.exe'
    $startup = [Environment]::GetFolderPath('Startup')
    $shortcutPath = Join-Path $startup 'GitHub Delivery Authority.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $installedExe
    $shortcut.WorkingDirectory = $targetDir
    $shortcut.Save()

    $installRecord = [ordered]@{
        schemaVersion = 1
        kind = 'github-delivery/authority-host-install'
        version = $ExpectedVersion
        sourceCommit = $ExpectedSourceCommit.ToLowerInvariant()
        appDir = ('app/v' + $ExpectedVersion)
        installedAt = [DateTimeOffset]::UtcNow.ToString('o')
    }
    $recordTemp = $recordPath + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    $recordJson = ($installRecord | ConvertTo-Json) + [Environment]::NewLine
    [IO.File]::WriteAllText($recordTemp, $recordJson, $utf8NoBom)
    Move-Item -Force $recordTemp $recordPath

    # Remove only the obsolete root-level launcher from the legacy layout. State
    # (`authority.db`, trust-store.json) and unknown user files are deliberately preserved.
    $legacyExe = Join-Path $InstallDir 'GitHubDeliveryAuthority.exe'
    if (Test-Path $legacyExe -PathType Leaf) { Remove-Item $legacyExe -Force }

    if (-not $SkipStart) {
        Start-Process $installedExe
    }
    Write-Host "Installed GitHub Delivery Authority $ExpectedVersion to $targetDir"
}
catch {
    if ($stoppedBroker -and -not $SkipStart -and $previousExe -and (Test-Path $previousExe -PathType Leaf)) {
        Start-Process $previousExe
    }
    throw
}
finally {
    if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force -ErrorAction SilentlyContinue }
}
