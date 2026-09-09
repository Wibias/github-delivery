[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$project = Join-Path $repoRoot 'authority-host\windows\GitHubDeliveryAuthority\GitHubDeliveryAuthority.csproj'
$installer = Join-Path $repoRoot 'authority-host\windows\install-release.ps1'
$workspace = Join-Path $env:RUNNER_TEMP ('authority-retention-' + [guid]::NewGuid().ToString('N'))
$publish = Join-Path $workspace 'publish'
$installDir = Join-Path $workspace 'install'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

try {
    New-Item -ItemType Directory -Force -Path $workspace | Out-Null

    & dotnet restore $project --locked-mode
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & dotnet publish $project --configuration Release --runtime win-x64 --self-contained true --no-restore --output $publish
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $version = [string](Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
    $sourceCommit = (& git -C $repoRoot rev-parse HEAD | Select-Object -First 1).Trim().ToLowerInvariant()
    if ($sourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'Could not resolve source commit for installer retention test.' }

    $versionInfo = [ordered]@{
        schemaVersion = 1
        kind = 'github-delivery/authority-host-version'
        version = $version
        sourceCommit = $sourceCommit
        platform = 'win32'
        arch = 'x64'
    }
    [IO.File]::WriteAllText(
        (Join-Path $publish 'authority-host-version.json'),
        (($versionInfo | ConvertTo-Json) + [Environment]::NewLine),
        $utf8NoBom
    )

    $appRoot = Join-Path $installDir 'app'
    $oldA = Join-Path $appRoot 'v0.0.1'
    $oldB = Join-Path $appRoot 'v0.0.2'
    New-Item -ItemType Directory -Force -Path $oldA | Out-Null
    New-Item -ItemType Directory -Force -Path $oldB | Out-Null
    [IO.File]::WriteAllText((Join-Path $oldA 'old-a.bin'), 'old-a', $utf8NoBom)
    [IO.File]::WriteAllText((Join-Path $oldB 'old-b.bin'), 'old-b', $utf8NoBom)

    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    $dbPath = Join-Path $installDir 'authority.db'
    $trustPath = Join-Path $installDir 'trust-store.json'
    [IO.File]::WriteAllText($dbPath, 'persistent-db', $utf8NoBom)
    [IO.File]::WriteAllText($trustPath, '{"persistent":true}', $utf8NoBom)

    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
        -File $installer `
        -SourceDir $publish `
        -ExpectedVersion $version `
        -ExpectedSourceCommit $sourceCommit `
        -InstallDir $installDir `
        -SkipStart
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $targetName = 'v' + $version
    $releaseDirs = @(
        Get-ChildItem $appRoot -Directory | Where-Object { $_.Name -match '^v\d+\.\d+\.\d+$' }
    )
    if ($releaseDirs.Count -ne 1 -or $releaseDirs[0].Name -ne $targetName) {
        $found = ($releaseDirs | ForEach-Object Name) -join ', '
        throw "Expected only $targetName under app after update, found: $found"
    }
    if ((Get-Content $dbPath -Raw) -ne 'persistent-db') { throw 'authority.db was not preserved.' }
    if ((Get-Content $trustPath -Raw) -ne '{"persistent":true}') { throw 'trust-store.json was not preserved.' }
}
finally {
    Remove-Item $workspace -Recurse -Force -ErrorAction SilentlyContinue
}
