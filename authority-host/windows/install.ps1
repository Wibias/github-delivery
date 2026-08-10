[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'GitHubDeliveryAuthority'),
    [string]$PipeName = 'github-delivery-authority-v1'
)

$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'GitHubDeliveryAuthority\GitHubDeliveryAuthority.csproj'
$publish = Join-Path $env:TEMP ('github-delivery-authority-publish-' + [guid]::NewGuid().ToString('N'))

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'GitHub Delivery Authority can only be installed on Windows 11.'
}

$windowsBuild = [Environment]::OSVersion.Version.Build
if ($windowsBuild -lt 22000) {
    throw "Windows 11 build 22000 or newer is required. Current build: $windowsBuild."
}

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
    throw 'The .NET 8 SDK is required. Install the .NET 8 SDK, then run this installer again.'
}

$installedSdks = @(& $dotnet.Source --list-sdks)
if (-not ($installedSdks | Where-Object { $_ -match '^8\.' })) {
    throw 'The .NET 8 SDK is required. Install an 8.x SDK, then run this installer again.'
}

try {
    & $dotnet.Source publish $project -c Release -r win-x64 --self-contained false -o $publish
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish failed with exit code $LASTEXITCODE."
    }

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    $installRoot = [IO.Path]::GetFullPath($InstallDir).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

    $installedProcesses = Get-Process -Name 'GitHubDeliveryAuthority' -ErrorAction SilentlyContinue | Where-Object {
        try {
            $processPath = $_.Path
            if (-not $processPath) { return $false }
            [IO.Path]::GetFullPath($processPath).StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase)
        }
        catch {
            $false
        }
    }

    foreach ($process in $installedProcesses) {
        Stop-Process -Id $process.Id -Force
        Wait-Process -Id $process.Id -ErrorAction SilentlyContinue
    }

    Copy-Item (Join-Path $publish '*') $InstallDir -Recurse -Force

    $exe = Join-Path $InstallDir 'GitHubDeliveryAuthority.exe'
    $startup = [Environment]::GetFolderPath('Startup')
    $shortcutPath = Join-Path $startup 'GitHub Delivery Authority.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = $InstallDir
    $shortcut.Save()

    [Environment]::SetEnvironmentVariable(
        'GITHUB_DELIVERY_AUTHORITY_TRUST_STORE',
        (Join-Path $InstallDir 'trust-store.json'),
        'User')
    [Environment]::SetEnvironmentVariable('GITHUB_DELIVERY_AUTHORITY_PIPE', $PipeName, 'User')
    $env:GITHUB_DELIVERY_AUTHORITY_TRUST_STORE = Join-Path $InstallDir 'trust-store.json'
    $env:GITHUB_DELIVERY_AUTHORITY_PIPE = $PipeName

    Start-Process $exe -ArgumentList '--setup'
    Write-Host "Installed GitHub Delivery Authority to $InstallDir"
    Write-Host 'The setup window will check Windows Hello, test it, and guide you through the first repository.'
    Write-Host 'A Windows Hello PIN is sufficient; fingerprint or face hardware is not required.'
    Write-Host 'Strict trusted-authority mode was NOT enabled automatically.'
}
finally {
    Remove-Item $publish -Recurse -Force -ErrorAction SilentlyContinue
}
