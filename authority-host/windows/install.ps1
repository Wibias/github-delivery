[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'GitHubDeliveryAuthority'),
    [string]$PipeName = 'github-delivery-authority-v1'
)

$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'GitHubDeliveryAuthority\GitHubDeliveryAuthority.csproj'
$publish = Join-Path $env:TEMP ('github-delivery-authority-publish-' + [guid]::NewGuid().ToString('N'))

try {
    dotnet publish $project -c Release -r win-x64 --self-contained false -o $publish
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
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

    Start-Process $exe
    Write-Host "Installed GitHub Delivery Authority to $InstallDir"
    Write-Host 'Open the tray icon and add each repository you want to allow. Allowlist changes require Windows Hello.'
    Write-Host 'Strict trusted-authority mode was NOT enabled automatically.'
}
finally {
    Remove-Item $publish -Recurse -Force -ErrorAction SilentlyContinue
}
