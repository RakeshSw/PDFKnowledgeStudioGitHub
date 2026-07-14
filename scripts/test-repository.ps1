param(
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ExtensionRoot = Join-Path $Root "extension"

Write-Host ""
Write-Host "PDF Knowledge Studio - Repository Test" -ForegroundColor Cyan
Write-Host "============================================================"

Write-Host ""
Write-Host "1. Publication scan" -ForegroundColor Yellow
& (Join-Path $PSScriptRoot "scan-publication.ps1") -Root $Root
if ($LASTEXITCODE -ne 0) { throw "Publication scan failed." }

Write-Host ""
Write-Host "2. Knowledge validation" -ForegroundColor Yellow
$Knowledge = Join-Path $ExtensionRoot "media\knowledge\knowledge.jsonl"
$ManifestPath = Join-Path $ExtensionRoot "media\knowledge\manifest.json"

$count = 0
Get-Content $Knowledge -Encoding UTF8 | ForEach-Object {
    if ($_.Trim()) {
        $null = $_ | ConvertFrom-Json
        $count++
    }
}

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
if ([int]$manifest.recordCount -ne $count) {
    throw "Knowledge count mismatch. JSONL=$count Manifest=$($manifest.recordCount)"
}

$sha = (Get-FileHash $Knowledge -Algorithm SHA256).Hash.ToLowerInvariant()
if ($manifest.sha256 -and $manifest.sha256.ToLowerInvariant() -ne $sha) {
    throw "Knowledge SHA256 mismatch."
}

Write-Host "   Records: $count"
Write-Host "   SHA256 : $sha"

Write-Host ""
Write-Host "3. Dependencies" -ForegroundColor Yellow
Push-Location $ExtensionRoot
try {
    if (-not $SkipNpmInstall) {
        npm.cmd install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
    }

    Write-Host ""
    Write-Host "4. Compile" -ForegroundColor Yellow
    npm.cmd run compile
    if ($LASTEXITCODE -ne 0) { throw "Compilation failed." }
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "5. Build VSIX" -ForegroundColor Yellow
& (Join-Path $PSScriptRoot "build-vsix.ps1") `
    -TargetRoot $ExtensionRoot `
    -OutputFolder (Join-Path $Root "artifacts")

Write-Host ""
Write-Host "SUCCESS: repository validation completed." -ForegroundColor Green
