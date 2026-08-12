[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'GitHubDeliveryAuthority'),
    [string]$PipeName = 'github-delivery-authority-v1'
)

$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'GitHubDeliveryAuthority\GitHubDeliveryAuthority.csproj'
$publish = Join-Path $env:TEMP ('github-delivery-authority-publish-' + [guid]::NewGuid().ToString('N'))
$releaseInstaller = Join-Path $PSScriptRoot 'install-release.ps1'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'GitHub Delivery Authority can only be installed on Windows 11.'
}

$windowsBuild = [Environment]::OSVersion.Version.Build
if ($windowsBuild -lt 22000) {
    throw "Windows 11 build 22000 or newer is required. Current build: $windowsBuild."
}

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
    throw 'The .NET 8 SDK is required only when installing the Authority host from source. Stable npx install/update uses the prebuilt verified release component.'
}

$installedSdks = @(& $dotnet.Source --list-sdks)
if (-not ($installedSdks | Where-Object { $_ -match '^8\.' })) {
    throw 'The .NET 8 SDK is required when installing the Authority host from source. Install an 8.x SDK, then run this installer again.'
}

try {
    & $dotnet.Source publish $project -c Release -r win-x64 --self-contained true -o $publish
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish failed with exit code $LASTEXITCODE."
    }

    $package = Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
    $version = [string]$package.version
    if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Repository package version is invalid.' }

    $sourceCommit = $null
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        $candidate = (& $git.Source -C $repoRoot rev-parse HEAD 2>$null | Select-Object -First 1)
        if ($candidate -match '^[0-9a-fA-F]{40}$') { $sourceCommit = $candidate.ToLowerInvariant() }
    }
    if (-not $sourceCommit) {
        throw 'A git source commit is required to install the Authority host from source.'
    }

    $versionInfo = [ordered]@{
        schemaVersion = 1
        kind = 'github-delivery/authority-host-version'
        version = $version
        sourceCommit = $sourceCommit
        platform = 'win32'
        arch = 'x64'
    }
    $versionInfo | ConvertTo-Json | Set-Content -Path (Join-Path $publish 'authority-host-version.json') -Encoding UTF8

    & $releaseInstaller -SourceDir $publish -ExpectedVersion $version -ExpectedSourceCommit $sourceCommit -InstallDir $InstallDir -PipeName $PipeName
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host 'The Authority host was built from source and installed through the same state-preserving deployment boundary used by verified releases.'
    Write-Host 'A Windows Hello PIN is sufficient; fingerprint or face hardware is not required.'
    Write-Host 'The user-selected github-delivery protection mode was NOT changed.'
}
finally {
    Remove-Item $publish -Recurse -Force -ErrorAction SilentlyContinue
}
